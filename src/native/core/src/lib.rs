use sha2::{Digest, Sha256};

pub struct GameCandidateData {
  pub key: String,
  pub name: String,
  pub aliases: Option<Vec<String>>,
}

pub struct FuzzyMatch {
  pub game_key: Option<String>,
  pub suggestion_key: Option<String>,
}

pub struct AutocompleteChoiceData {
  pub name: String,
  pub value: String,
}

pub struct ListingCandidateData {
  pub href: String,
  pub text: String,
  pub position: i32,
}

struct CandidateScore<'a> {
  game: &'a GameCandidateData,
  dist: usize,
  is_starts_with: bool,
  is_includes: bool,
  index: usize,
}

pub fn levenshtein(a: &str, b: &str) -> usize {
  if a.is_empty() {
    return b.chars().count();
  }
  if b.is_empty() {
    return a.chars().count();
  }

  let a_chars: Vec<char> = a.chars().collect();
  let b_chars: Vec<char> = b.chars().collect();
  let mut row: Vec<usize> = (0..=b_chars.len()).collect();

  for (i, a_char) in a_chars.iter().enumerate() {
    let mut prev_diag = row[0];
    row[0] = i + 1;
    for (j, b_char) in b_chars.iter().enumerate() {
      let prev_above = row[j + 1];
      let insertion = row[j] + 1;
      let deletion = prev_above + 1;
      let substitution = prev_diag + usize::from(a_char != b_char);
      row[j + 1] = insertion.min(deletion).min(substitution);
      prev_diag = prev_above;
    }
  }

  row[b_chars.len()]
}

pub fn normalize_title_for_dedupe(value: &str) -> String {
  let mut normalized = String::with_capacity(value.len());
  let mut previous_was_space = false;

  for ch in value.to_lowercase().chars() {
    if matches!(ch, '\u{00ae}' | '\u{00a9}' | '\u{2122}') {
      continue;
    }
    if ch.is_ascii_alphanumeric() {
      normalized.push(ch);
      previous_was_space = false;
    } else if !previous_was_space {
      normalized.push(' ');
      previous_was_space = true;
    }
  }

  normalized.trim().to_string()
}

pub fn clean_text(input: &str) -> String {
  if input.is_empty() {
    return String::new();
  }
  let bytes = input.as_bytes();
  let mut out = String::with_capacity(input.len());
  let mut i = 0usize;
  let mut prev_was_space = true;

  while i < bytes.len() {
    let b = bytes[i];

    if b == b'<' {
      let mut j = i + 1;
      while j < bytes.len() && bytes[j] != b'>' {
        j += 1;
      }
      i = if j < bytes.len() { j + 1 } else { j };
      if !prev_was_space {
        out.push(' ');
        prev_was_space = true;
      }
      continue;
    }

    if b == b'&' {
      let max = std::cmp::min(bytes.len(), i + 8);
      let mut j = i + 1;
      while j < max && bytes[j] != b';' {
        j += 1;
      }
      if j < bytes.len() && bytes[j] == b';' {
        let entity_bytes = &bytes[i + 1..j];

        let replacement: Option<&str> = match entity_bytes {
          b if b.eq_ignore_ascii_case(b"nbsp") => Some(" "),
          b if b.eq_ignore_ascii_case(b"amp") => Some("&"),
          b if b.eq_ignore_ascii_case(b"quot") => Some("\""),
          b if b.eq_ignore_ascii_case(b"#39") || b.eq_ignore_ascii_case(b"apos") => Some("'"),
          b if b.eq_ignore_ascii_case(b"lt") => Some("<"),
          b if b.eq_ignore_ascii_case(b"gt") => Some(">"),
          _ => None,
        };
        if let Some(repl) = replacement {
          if repl == " " {
            if !prev_was_space {
              out.push(' ');
              prev_was_space = true;
            }
          } else {
            out.push_str(repl);
            prev_was_space = false;
          }
          i = j + 1;
          continue;
        }

        out.push_str(&input[i..=j]);
        prev_was_space = false;
        i = j + 1;
        continue;
      }

      out.push('&');
      prev_was_space = false;
      i += 1;
      continue;
    }

    if b.is_ascii_whitespace() {
      if !prev_was_space {
        out.push(' ');
        prev_was_space = true;
      }
      i += 1;
      continue;
    }

    if b < 0x80 {
      out.push(b as char);
      prev_was_space = false;
      i += 1;
    } else {
      let char_len = if b & 0xE0 == 0xC0 { 2 }
                     else if b & 0xF0 == 0xE0 { 3 }
                     else if b & 0xF8 == 0xF0 { 4 }
                     else { 1 };
      let end = std::cmp::min(bytes.len(), i + char_len);
      if let Ok(s) = std::str::from_utf8(&bytes[i..end]) {
        out.push_str(s);
      }
      prev_was_space = false;
      i = end;
    }
  }

  while out.ends_with(' ') {
    out.pop();
  }
  out
}

pub fn is_good_steam_article_url(url: &str) -> bool {
  let v = url.trim().to_lowercase();
  if v.is_empty() { return false; }
  if !v.starts_with("http") { return false; }
  if v.contains("steamstatic") { return false; }
  if v.contains("steamcdn") { return false; }
  true
}

pub fn extract_date_score(url: &str) -> f64 {
  let bytes = url.as_bytes();
  if bytes.len() < 10 { return 0.0; }
  let max_start = bytes.len() - 10;
  let mut i = 0usize;
  while i <= max_start {
    if !bytes[i].is_ascii_digit() {
      i += 1;
      continue;
    }
    if bytes[i + 1].is_ascii_digit()
      && bytes[i + 2].is_ascii_digit()
      && bytes[i + 3].is_ascii_digit()
      && (bytes[i + 4] == b'-' || bytes[i + 4] == b'/')
      && bytes[i + 5].is_ascii_digit()
      && bytes[i + 6].is_ascii_digit()
      && (bytes[i + 7] == b'-' || bytes[i + 7] == b'/')
      && bytes[i + 8].is_ascii_digit()
      && bytes[i + 9].is_ascii_digit()
    {
      let year  = (bytes[i]     - b'0') as i32 * 1000
                + (bytes[i + 1] - b'0') as i32 * 100
                + (bytes[i + 2] - b'0') as i32 * 10
                + (bytes[i + 3] - b'0') as i32;
      let month = (bytes[i + 5] - b'0') as i32 * 10
                + (bytes[i + 6] - b'0') as i32;
      let day   = (bytes[i + 8] - b'0') as i32 * 10
                + (bytes[i + 9] - b'0') as i32;
      if (2000..=2100).contains(&year)
        && (1..=12).contains(&month)
        && (1..=31).contains(&day)
      {
        if let Some(ts) = utc_ms_for_date(year, month as u32, day as u32) {
          return ts;
        }
      }
    }
    i += 1;
  }
  0.0
}

fn utc_ms_for_date(year: i32, month: u32, day: u32) -> Option<f64> {
  let max_day = match month {
    1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
    4 | 6 | 9 | 11 => 30,
    2 => if is_leap_year(year) { 29 } else { 28 },
    _ => return None,
  };
  if day == 0 || day > max_day { return None; }
  Some(days_from_civil(year, month, day) as f64 * 86_400_000.0)
}

fn is_leap_year(year: i32) -> bool {
  (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

fn days_from_civil(year: i32, month: u32, day: u32) -> i64 {
  let y = if month <= 2 { year - 1 } else { year } as i64;
  let era = (if y >= 0 { y } else { y - 399 }) / 400;
  let yoe = (y - era * 400) as u32;
  let m = month as i64;
  let doy = ((153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + day as i64 - 1) as u32;
  let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  era * 146_097 + doe as i64 - 719_468
}

const BAD_IN_TITLE: &[&str] = &[
  "community", "sale", "store", "merch", "tournament", "esports",
  "giveaway", "teaser", "trailer", "preview", "announce", "announcement",
];
const GOOD_WORDS: &[&str] = &[
  "update", "patch", "hotfix", "version", "release", "bugfix", "bug fix",
  "fixes", "fix", "notes", "patch notes", "changelog", "maintenance",
  "build", "client update", "title update", "release notes", "season",
  "chapter", "rework", "balance", "content update", "launch",
];

pub fn classify_patch_note(title: &str, contents: &str, tags: &[String]) -> bool {
  let title_lc = title.to_lowercase();
  if BAD_IN_TITLE.iter().any(|w| title_lc.contains(w)) {
    return false;
  }
  let has_patch_tag = tags.iter().any(|t| {
    let lc = t.to_lowercase();
    lc == "patchnotes" || lc == "update"
  });
  if has_patch_tag {
    return true;
  }
  let contents_lc = contents.to_lowercase();
  GOOD_WORDS.iter().any(|w| title_lc.contains(w) || contents_lc.contains(w))
}

pub fn score_listing_candidate(href: &str, text: &str, keywords: &[String]) -> u32 {
  if keywords.is_empty() {
    return 0;
  }
  let mut haystack = String::with_capacity(href.len() + text.len() + 1);
  haystack.push_str(href);
  haystack.push(' ');
  haystack.push_str(text);
  let haystack_lc = haystack.to_lowercase();
  let mut score: u32 = 0;
  for keyword in keywords {
    if keyword.is_empty() {
      continue;
    }
    let kw_lc = keyword.to_lowercase();
    if haystack_lc.contains(&kw_lc) {
      score += 1;
    }
  }
  score
}

pub fn rank_listing_candidates(candidates: &[ListingCandidateData], keywords: &[String]) -> Vec<u32> {
  let has_keywords = !keywords.is_empty();
  let scores: Vec<(u32, f64)> = candidates
    .iter()
    .map(|candidate| {
      let score = if has_keywords {
        score_listing_candidate(&candidate.href, &candidate.text, keywords)
      } else {
        0
      };
      (score, extract_date_score(&candidate.href))
    })
    .collect();
  let mut order: Vec<u32> = (0..candidates.len() as u32).collect();
  order.sort_by(|&a, &b| {
    let (ai, bi) = (a as usize, b as usize);
    scores[bi]
      .0
      .cmp(&scores[ai].0)
      .then_with(|| scores[bi].1.partial_cmp(&scores[ai].1).unwrap_or(std::cmp::Ordering::Equal))
      .then_with(|| candidates[ai].position.cmp(&candidates[bi].position))
  });
  order
}

#[allow(clippy::too_many_arguments)]
pub fn build_autocomplete_choices(
  games: &[GameCandidateData],
  input: &str,
  use_name_as_value: bool,
  min_relevant_score: i32,
  max_choices: usize,
  max_name_len: usize,
  max_value_len: usize,
) -> Vec<AutocompleteChoiceData> {
  let normalized_input = input.to_lowercase().trim().to_string();
  let mut candidates: Vec<(&GameCandidateData, i32)> = Vec::with_capacity(games.len());

  for game in games {
    let score = score_autocomplete_game(game, &normalized_input);
    if !normalized_input.is_empty() && score < min_relevant_score {
      continue;
    }
    candidates.push((game, score));
  }

  candidates.sort_by(|(game_a, score_a), (game_b, score_b)| {
    score_b
      .cmp(score_a)
      .then_with(|| game_a.name.cmp(&game_b.name))
  });

  candidates
    .into_iter()
    .take(max_choices)
    .map(|(game, _score)| {
      let name = truncate_chars(&format!("{} ({})", game.name, game.key), max_name_len);
      let raw_value = if use_name_as_value { &game.name } else { &game.key };
      AutocompleteChoiceData {
        name,
        value: truncate_chars(raw_value, max_value_len),
      }
    })
    .collect()
}

pub fn stable_update_id(title: &str, link: &str) -> String {
  let base = format!("{}|{}", title, link);
  let mut hasher = Sha256::new();
  hasher.update(base.as_bytes());

  hex_encode(&hasher.finalize()[..8])
}

pub fn normalize_deal_state(sale_price: &str, normal_price: &str, savings: &str) -> String {
  [sale_price, normal_price, savings]
    .map(|value| value.trim().to_lowercase())
    .join(":")
}

#[allow(clippy::too_many_arguments)]
pub fn deal_passes_filters(
  sale_price_num: f64,
  savings_num: f64,
  store: &str,
  min_discount_percent: f64,
  include_free_games: bool,
  include_paid_discounts: bool,
  max_absolute_price: f64,
  enabled_stores: &[String],
) -> bool {
  let is_free = sale_price_num == 0.0;
  if is_free && !include_free_games {
    return false;
  }
  if !is_free && !include_paid_discounts {
    return false;
  }
  if !is_free && (!savings_num.is_finite() || savings_num < min_discount_percent) {
    return false;
  }
  if !is_free
    && max_absolute_price > 0.0
    && sale_price_num.is_finite()
    && sale_price_num > max_absolute_price
  {
    return false;
  }
  if !enabled_stores.is_empty() && !enabled_stores.iter().any(|candidate| candidate == store) {
    return false;
  }
  true
}

#[allow(clippy::too_many_arguments)]
pub fn deal_hash(
  store: &str,
  steam_app_id: &str,
  id: &str,
  title: &str,
  sale_price: &str,
  normal_price: &str,
  savings: &str,
) -> String {
  let state = normalize_deal_state(sale_price, normal_price, savings);
  let stable_key = if store == "Steam" && !steam_app_id.is_empty() {
    format!("steam:{}:{}", steam_app_id, state)
  } else if store == "Epic Games" && !id.is_empty() {
    let raw_id = id.strip_prefix("epic_").unwrap_or(id);
    format!("epic:{}:{}", raw_id, state)
  } else {
    format!("{}:{}:{}", store, normalize_title_for_dedupe(title), state)
  };

  sha256_hex(&stable_key)
}

pub fn find_game_keys(text: &str, games: &[GameCandidateData], max_input: usize) -> FuzzyMatch {
  let mut search = normalize_command_text(text);
  if max_input > 0 && search.chars().count() > max_input {
    search = search.chars().take(max_input).collect();
  }

  if search.chars().count() < 2 {
    let exact = games
      .iter()
      .find(|game| game.key.to_lowercase() == search)
      .map(|game| game.key.clone());
    return FuzzyMatch { game_key: exact, suggestion_key: None };
  }

  let mut candidates: Vec<CandidateScore> = Vec::with_capacity(games.len());
  for (index, game) in games.iter().enumerate() {
    let identifiers = game_identifiers(game);
    if identifiers.iter().any(|value| value == &search) {
      return FuzzyMatch { game_key: Some(game.key.clone()), suggestion_key: None };
    }

    let mut best_dist = usize::MAX;
    let mut is_starts_with = false;
    let mut is_includes = false;
    for value in identifiers {
      if value.starts_with(&search) {
        is_starts_with = true;
      }
      if value.contains(&search) {
        is_includes = true;
      }
      best_dist = best_dist.min(levenshtein(&search, &value));
    }

    candidates.push(CandidateScore {
      game,
      dist: best_dist,
      is_starts_with,
      is_includes,
      index,
    });
  }

  candidates.sort_by(|a, b| {
    b.is_starts_with
      .cmp(&a.is_starts_with)
      .then_with(|| a.dist.cmp(&b.dist))
      .then_with(|| b.is_includes.cmp(&a.is_includes))
      .then_with(|| a.index.cmp(&b.index))
  });

  let Some(best) = candidates.first() else {
    return FuzzyMatch { game_key: None, suggestion_key: None };
  };

  let dynamic_threshold = std::cmp::max(1, (search.chars().count() as f64 * 0.3).floor() as usize);
  if best.dist <= 1 {
    return FuzzyMatch { game_key: Some(best.game.key.clone()), suggestion_key: None };
  }
  if best.dist <= dynamic_threshold || best.is_starts_with || best.is_includes {
    return FuzzyMatch { game_key: None, suggestion_key: Some(best.game.key.clone()) };
  }

  FuzzyMatch { game_key: None, suggestion_key: None }
}

fn game_identifiers(game: &GameCandidateData) -> Vec<String> {
  let mut identifiers = Vec::with_capacity(2 + game.aliases.as_ref().map_or(0, Vec::len));
  identifiers.push(normalize_command_text(&game.key));
  identifiers.push(normalize_command_text(&game.name));
  if let Some(aliases) = &game.aliases {
    identifiers.extend(aliases.iter().map(|alias| normalize_command_text(alias)));
  }
  identifiers
}

fn normalize_command_text(value: &str) -> String {
  value
    .to_lowercase()
    .chars()
    .map(|ch| if ch == '-' || ch == '_' { ' ' } else { ch })
    .collect::<String>()
    .trim()
    .to_string()
}

fn score_autocomplete_game(game: &GameCandidateData, input: &str) -> i32 {
  let mut score = -1;
  score = score_autocomplete_identifier(score, &game.name, input);
  score = score_autocomplete_identifier(score, &game.key, input);
  if let Some(aliases) = &game.aliases {
    for alias in aliases {
      score = score_autocomplete_identifier(score, alias, input);
    }
  }
  score
}

fn score_autocomplete_identifier(current: i32, value: &str, input: &str) -> i32 {
  let haystack = value.to_lowercase();
  if input.is_empty() {
    return current.max(0);
  }
  if haystack == input {
    return current.max(100);
  }
  if haystack.starts_with(input) {
    return current.max(50);
  }
  if haystack.contains(input) {
    return current.max(20);
  }
  current
}

fn truncate_chars(value: &str, max_len: usize) -> String {
  if value.chars().count() <= max_len {
    return value.to_string();
  }
  value.chars().take(max_len).collect()
}

fn sha256_hex(value: &str) -> String {
  let mut hasher = Sha256::new();
  hasher.update(value.as_bytes());
  hex_encode(&hasher.finalize())
}

fn hex_encode(bytes: &[u8]) -> String {
  const HEX: &[u8; 16] = b"0123456789abcdef";
  let mut out = vec![0u8; bytes.len() * 2];
  for (i, &b) in bytes.iter().enumerate() {
    out[i * 2] = HEX[(b >> 4) as usize];
    out[i * 2 + 1] = HEX[(b & 0x0f) as usize];
  }

  unsafe { String::from_utf8_unchecked(out) }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn game(key: &str, name: &str, aliases: &[&str]) -> GameCandidateData {
    GameCandidateData {
      key: key.to_string(),
      name: name.to_string(),
      aliases: if aliases.is_empty() {
        None
      } else {
        Some(aliases.iter().map(|a| a.to_string()).collect())
      },
    }
  }

  #[test]
  fn levenshtein_known_distances() {
    assert_eq!(levenshtein("abc", "abc"), 0);
    assert_eq!(levenshtein("kitten", "sitting"), 3);
    assert_eq!(levenshtein("", "abc"), 3);
  }

  #[test]
  fn stable_update_id_is_deterministic_and_distinct() {
    let a = stable_update_id("Patch 1", "https://example.com/1");
    let b = stable_update_id("Patch 1", "https://example.com/1");
    let c = stable_update_id("Patch 2", "https://example.com/2");
    assert_eq!(a, b);
    assert_ne!(a, c);
    assert!(!a.is_empty());
  }

  #[test]
  fn deal_hash_is_deterministic_and_distinct() {
    let a = deal_hash("Steam", "570", "", "Dota", "0", "20", "100");
    let b = deal_hash("Steam", "570", "", "Dota", "0", "20", "100");
    let c = deal_hash("Steam", "730", "", "CS", "0", "20", "100");
    assert_eq!(a, b);
    assert_ne!(a, c);
    assert!(!a.is_empty());
  }

  #[test]
  fn deal_hash_epic_strips_prefix_and_fallback_uses_normalized_title() {
    let with_prefix = deal_hash("Epic Games", "", "epic_abc", "Game", "0", "20", "100");
    let without_prefix = deal_hash("Epic Games", "", "abc", "Game", "0", "20", "100");
    assert_eq!(with_prefix, without_prefix);
    let fallback_a = deal_hash("GOG", "", "", "Game\u{2122} Deluxe", "0", "20", "100");
    let fallback_b = deal_hash("GOG", "", "", "game   deluxe", "0", "20", "100");
    assert_eq!(fallback_a, fallback_b);
  }

  #[test]
  fn deal_passes_filters_core_cases() {
    assert!(deal_passes_filters(0.0, 0.0, "Steam", 50.0, true, true, 0.0, &[]));
    assert!(!deal_passes_filters(0.0, 0.0, "Steam", 50.0, false, true, 0.0, &[]));
    assert!(!deal_passes_filters(10.0, 5.0, "Steam", 20.0, true, true, 0.0, &[]));
    assert!(deal_passes_filters(10.0, 50.0, "Steam", 20.0, true, true, 0.0, &["Steam".to_string()]));
    assert!(!deal_passes_filters(10.0, 50.0, "Steam", 20.0, true, true, 0.0, &["Epic Games".to_string()]));
    assert!(!deal_passes_filters(10.0, 50.0, "Steam", 20.0, true, true, 5.0, &[]));
  }

  #[test]
  fn clean_text_strips_tags_entities_and_whitespace() {
    assert_eq!(clean_text("<p>Hello&nbsp;world</p>"), "Hello world");
    assert_eq!(clean_text("a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;"), "a & b <c> \"d\" 'e'");
    assert_eq!(clean_text("  spatii \t multiple \n aici  "), "spatii multiple aici");
    assert_eq!(clean_text("diacritice șț rămân"), "diacritice șț rămân");
    assert_eq!(clean_text(""), "");
  }

  #[test]
  fn normalize_title_for_dedupe_drops_marks_and_punctuation() {
    assert_eq!(normalize_title_for_dedupe("Game\u{2122}: Deluxe \u{00ae} Edition!"), "game deluxe edition");
    assert_eq!(normalize_title_for_dedupe("  Spaced   Out  "), "spaced out");
  }

  #[test]
  fn extract_date_score_finds_leftmost_valid_date() {
    let leftmost = extract_date_score("https://x.com/2024-03-15/alt/2025-01-01");
    let single = extract_date_score("https://x.com/2024-03-15/");
    assert_eq!(leftmost, single);
    assert!(single > 0.0);
    assert_eq!(extract_date_score("https://x.com/2024-13-15/"), 0.0);
    assert_eq!(extract_date_score("https://x.com/2023-02-29/"), 0.0);
    assert!(extract_date_score("https://x.com/2024-02-29/") > 0.0);
    assert_eq!(extract_date_score("https://x.com/fara-data/"), 0.0);
  }

  #[test]
  fn classify_patch_note_rules() {
    assert!(classify_patch_note("Patch 1.2 notes", "", &[]));
    assert!(!classify_patch_note("Summer Sale", "patch", &[]));
    assert!(classify_patch_note("Ceva", "", &["PatchNotes".to_string()]));
    assert!(classify_patch_note("Ceva", "contine update inauntru", &[]));
    assert!(!classify_patch_note("Ceva", "nimic relevant", &[]));
  }

  #[test]
  fn is_good_steam_article_url_rules() {
    assert!(is_good_steam_article_url("https://store.steampowered.com/news/1"));
    assert!(!is_good_steam_article_url(""));
    assert!(!is_good_steam_article_url("ftp://x"));
    assert!(!is_good_steam_article_url("https://cdn.steamstatic.com/img.png"));
    assert!(!is_good_steam_article_url("https://steamcdn-a.net/img.png"));
  }

  #[test]
  fn score_listing_candidate_counts_keywords_once_each() {
    let keywords = vec!["patch".to_string(), "notes".to_string(), "".to_string()];
    assert_eq!(score_listing_candidate("https://x.com/patch", "Patch notes", &keywords), 2);
    assert_eq!(score_listing_candidate("https://x.com", "nimic", &keywords), 0);
    assert_eq!(score_listing_candidate("https://x.com/patch", "patch", &[]), 0);
  }

  #[test]
  fn rank_listing_candidates_orders_by_score_then_date_then_position() {
    let candidates = vec![
      ListingCandidateData { href: "https://x.com/old".to_string(), text: "nimic".to_string(), position: 0 },
      ListingCandidateData { href: "https://x.com/2024-05-01/patch".to_string(), text: "patch".to_string(), position: 1 },
      ListingCandidateData { href: "https://x.com/2024-06-01/patch".to_string(), text: "patch".to_string(), position: 2 },
    ];
    let order = rank_listing_candidates(&candidates, &["patch".to_string()]);
    assert_eq!(order, vec![2, 1, 0]);
    let no_keywords = rank_listing_candidates(&candidates, &[]);
    assert_eq!(no_keywords, vec![2, 1, 0]);
  }

  #[test]
  fn build_autocomplete_choices_filters_sorts_and_truncates() {
    let games = vec![
      game("cs2", "Counter-Strike 2", &["csgo"]),
      game("fortnite", "Fortnite", &[]),
      game("dota2", "Dota 2", &[]),
    ];
    let choices = build_autocomplete_choices(&games, "fort", false, 20, 25, 100, 100);
    assert_eq!(choices.len(), 1);
    assert_eq!(choices[0].value, "fortnite");
    assert_eq!(choices[0].name, "Fortnite (fortnite)");

    let all = build_autocomplete_choices(&games, "", false, 20, 2, 100, 100);
    assert_eq!(all.len(), 2);
    assert_eq!(all[0].name, "Counter-Strike 2 (cs2)");

    let truncated = build_autocomplete_choices(&games, "fort", true, 20, 25, 4, 4);
    assert_eq!(truncated[0].name, "Fort");
    assert_eq!(truncated[0].value, "Fort");
  }

  #[test]
  fn find_game_keys_exact_fuzzy_and_suggestion() {
    let games = vec![
      game("cs2", "Counter-Strike 2", &["csgo"]),
      game("fortnite", "Fortnite", &[]),
    ];
    assert_eq!(find_game_keys("fortnite", &games, 100).game_key.as_deref(), Some("fortnite"));
    assert_eq!(find_game_keys("CSGO", &games, 100).game_key.as_deref(), Some("cs2"));
    assert_eq!(find_game_keys("fortnitr", &games, 100).game_key.as_deref(), Some("fortnite"));
    let suggestion = find_game_keys("fortni", &games, 100);
    assert!(suggestion.game_key.is_some() || suggestion.suggestion_key.is_some());
    let none = find_game_keys("xyzqwv", &games, 100);
    assert_eq!(none.game_key, None);
    assert_eq!(none.suggestion_key, None);
  }

  #[test]
  fn normalize_deal_state_trims_and_lowercases() {
    assert_eq!(normalize_deal_state(" 10.00 ", "20.00", " 50 "), "10.00:20.00:50");
    assert_eq!(normalize_deal_state("Free", "0", "0"), "free:0:0");
  }
}
