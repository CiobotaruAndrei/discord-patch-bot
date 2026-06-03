use napi_derive::napi;
use sha2::{Digest, Sha256};

#[napi(object)]
pub struct GameCandidate {
  pub key: String,
  pub name: String,
  pub aliases: Option<Vec<String>>,
}

#[napi(object)]
pub struct FuzzyMatchResult {
  pub game_key: Option<String>,
  pub suggestion_key: Option<String>,
}

#[napi(object)]
pub struct AutocompleteChoice {
  pub name: String,
  pub value: String,
}

struct CandidateScore<'a> {
  game: &'a GameCandidate,
  dist: usize,
  is_starts_with: bool,
  is_includes: bool,
  index: usize,
}

#[napi]
pub fn levenshtein(a: String, b: String) -> u32 {
  levenshtein_impl(&a, &b) as u32
}

#[napi]
pub fn normalize_title_for_dedupe(value: String) -> String {
  normalize_title_for_dedupe_impl(&value)
}

#[napi]
pub fn clean_text(text: String) -> String {
  clean_text_impl(&text)
}

#[napi]
pub fn is_good_steam_article_url(url: String) -> bool {
  let v = url.trim().to_lowercase();
  if v.is_empty() { return false; }
  if !v.starts_with("http") { return false; }
  if v.contains("steamstatic") { return false; }
  if v.contains("steamcdn") { return false; }
  true
}

#[napi]
pub fn extract_date_score(url: String) -> f64 {
  extract_date_score_impl(&url)
}

fn extract_date_score_impl(url: &str) -> f64 {
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

#[napi]
pub fn classify_patch_note(title: String, contents: String, tags: Vec<String>) -> bool {
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

#[napi]
pub fn score_listing_candidate(href: String, text: String, keywords: Vec<String>) -> u32 {
  if keywords.is_empty() {
    return 0;
  }
  let mut haystack = String::with_capacity(href.len() + text.len() + 1);
  haystack.push_str(&href);
  haystack.push(' ');
  haystack.push_str(&text);
  let haystack_lc = haystack.to_lowercase();
  let mut score: u32 = 0;
  for keyword in &keywords {
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

#[napi]
pub fn build_autocomplete_choices(
  games: Vec<GameCandidate>,
  input: String,
  use_name_as_value: bool,
  min_relevant_score: i32,
  max_choices: u32,
  max_name_len: u32,
  max_value_len: u32,
) -> Vec<AutocompleteChoice> {
  let normalized_input = input.to_lowercase().trim().to_string();
  let mut candidates: Vec<(&GameCandidate, i32)> = Vec::with_capacity(games.len());

  for game in &games {
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
    .take(max_choices as usize)
    .map(|(game, _score)| {
      let name = truncate_chars(&format!("{} ({})", game.name, game.key), max_name_len as usize);
      let raw_value = if use_name_as_value { &game.name } else { &game.key };
      AutocompleteChoice {
        name,
        value: truncate_chars(raw_value, max_value_len as usize),
      }
    })
    .collect()
}

#[napi]
pub fn stable_update_id(title: String, link: String) -> String {
  let base = format!("{}|{}", title, link);
  let mut hasher = Sha256::new();
  hasher.update(base.as_bytes());

  hex_encode(&hasher.finalize()[..8])
}

#[napi]
pub fn normalize_deal_state(sale_price: String, normal_price: String, savings: String) -> String {
  normalize_deal_state_impl(&sale_price, &normal_price, &savings)
}

#[napi]
#[allow(clippy::too_many_arguments)]
pub fn deal_passes_filters(
  sale_price_num: f64,
  savings_num: f64,
  store: String,
  min_discount_percent: f64,
  include_free_games: bool,
  include_paid_discounts: bool,
  max_absolute_price: f64,
  enabled_stores: Vec<String>,
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
  if !enabled_stores.is_empty() && !enabled_stores.iter().any(|candidate| candidate == &store) {
    return false;
  }
  true
}

#[napi]
pub fn deal_hash(
  store: String,
  steam_app_id: String,
  id: String,
  title: String,
  sale_price: String,
  normal_price: String,
  savings: String,
) -> String {
  let state = normalize_deal_state_impl(&sale_price, &normal_price, &savings);
  let stable_key = if store == "Steam" && !steam_app_id.is_empty() {
    format!("steam:{}:{}", steam_app_id, state)
  } else if store == "Epic Games" && !id.is_empty() {
    let raw_id = id.strip_prefix("epic_").unwrap_or(&id);
    format!("epic:{}:{}", raw_id, state)
  } else {
    format!("{}:{}:{}", store, normalize_title_for_dedupe_impl(&title), state)
  };

  sha256_hex(&stable_key)
}

#[napi]
pub fn find_game_keys(text: String, games: Vec<GameCandidate>, max_input: u32) -> FuzzyMatchResult {
  let mut search = normalize_command_text(&text);
  let max_len = max_input as usize;
  if max_len > 0 && search.chars().count() > max_len {
    search = search.chars().take(max_len).collect();
  }

  if search.chars().count() < 2 {
    let exact = games
      .iter()
      .find(|game| game.key.to_lowercase() == search)
      .map(|game| game.key.clone());
    return FuzzyMatchResult { game_key: exact, suggestion_key: None };
  }

  let mut candidates: Vec<CandidateScore> = Vec::with_capacity(games.len());
  for (index, game) in games.iter().enumerate() {
    let identifiers = game_identifiers(game);
    if identifiers.iter().any(|value| value == &search) {
      return FuzzyMatchResult { game_key: Some(game.key.clone()), suggestion_key: None };
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
      best_dist = best_dist.min(levenshtein_impl(&search, &value));
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
    return FuzzyMatchResult { game_key: None, suggestion_key: None };
  };

  let dynamic_threshold = std::cmp::max(1, (search.chars().count() as f64 * 0.3).floor() as usize);
  if best.dist <= 1 {
    return FuzzyMatchResult { game_key: Some(best.game.key.clone()), suggestion_key: None };
  }
  if best.dist <= dynamic_threshold || best.is_starts_with || best.is_includes {
    return FuzzyMatchResult { game_key: None, suggestion_key: Some(best.game.key.clone()) };
  }

  FuzzyMatchResult { game_key: None, suggestion_key: None }
}

fn game_identifiers(game: &GameCandidate) -> Vec<String> {
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

fn score_autocomplete_game(game: &GameCandidate, input: &str) -> i32 {
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

fn normalize_title_for_dedupe_impl(value: &str) -> String {
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

fn normalize_deal_state_impl(sale_price: &str, normal_price: &str, savings: &str) -> String {
  [sale_price, normal_price, savings]
    .map(|value| value.trim().to_lowercase())
    .join(":")
}

fn clean_text_impl(input: &str) -> String {
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

fn levenshtein_impl(a: &str, b: &str) -> usize {
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

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn levenshtein_known_distances() {
    assert_eq!(levenshtein("abc".to_string(), "abc".to_string()), 0);
    assert_eq!(levenshtein("kitten".to_string(), "sitting".to_string()), 3);
    assert_eq!(levenshtein("".to_string(), "abc".to_string()), 3);
  }

  #[test]
  fn stable_update_id_is_deterministic_and_distinct() {
    let a = stable_update_id("Patch 1".to_string(), "https://example.com/1".to_string());
    let b = stable_update_id("Patch 1".to_string(), "https://example.com/1".to_string());
    let c = stable_update_id("Patch 2".to_string(), "https://example.com/2".to_string());
    assert_eq!(a, b);
    assert_ne!(a, c);
    assert!(!a.is_empty());
  }

  #[test]
  fn deal_hash_is_deterministic_and_distinct() {
    let a = deal_hash("Steam".to_string(), "570".to_string(), String::new(), "Dota".to_string(), "0".to_string(), "20".to_string(), "100".to_string());
    let b = deal_hash("Steam".to_string(), "570".to_string(), String::new(), "Dota".to_string(), "0".to_string(), "20".to_string(), "100".to_string());
    let c = deal_hash("Steam".to_string(), "730".to_string(), String::new(), "CS".to_string(), "0".to_string(), "20".to_string(), "100".to_string());
    assert_eq!(a, b);
    assert_ne!(a, c);
    assert!(!a.is_empty());
  }

  #[test]
  fn deal_passes_filters_core_cases() {
    assert!(deal_passes_filters(0.0, 0.0, "Steam".to_string(), 50.0, true, true, 0.0, vec![]));
    assert!(!deal_passes_filters(0.0, 0.0, "Steam".to_string(), 50.0, false, true, 0.0, vec![]));
    assert!(!deal_passes_filters(10.0, 5.0, "Steam".to_string(), 20.0, true, true, 0.0, vec![]));
    assert!(deal_passes_filters(10.0, 50.0, "Steam".to_string(), 20.0, true, true, 0.0, vec!["Steam".to_string()]));
    assert!(!deal_passes_filters(10.0, 50.0, "Steam".to_string(), 20.0, true, true, 0.0, vec!["Epic Games".to_string()]));
  }
}
