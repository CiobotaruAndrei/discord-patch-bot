use napi_derive::napi;
use sha1::{Digest, Sha1};

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

// Keyword sets are static so we never reallocate them across calls. fetchSteamUpdate
// runs classify_patch_note up to 50 times per game per cron tick — the JS version
// called String.includes per keyword and burnt time on the JS<->native bridge for
// every single comparison via .some(). Running the whole classification in one
// native call removes that overhead.
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

// scoreCandidate is called per <a> tag inside fetchListingBasedUpdate's listing
// scrape. With per-guild require_keywords lists of ~3-8 words and listings of
// 50-200 anchors, the JS version does N*M String.includes calls per fetch.
// Lowercasing the haystack once and looping in native keeps the hot loop in
// one place.
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
pub fn stable_update_id(title: String, link: String) -> String {
  let base = format!("{}|{}", title, link);
  let mut hasher = Sha1::new();
  hasher.update(base.as_bytes());
  // We only need the first 16 hex chars (8 bytes). The previous version did
  // `sha1_hex(...).chars().take(16).collect()` — formatting all 40 hex chars
  // then walking the string to keep the first 16. Going direct from the
  // digest bytes avoids that intermediate 40-char String allocation.
  hex_encode(&hasher.finalize()[..8])
}

#[napi]
pub fn normalize_deal_state(sale_price: String, normal_price: String, savings: String) -> String {
  normalize_deal_state_impl(&sale_price, &normal_price, &savings)
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

  sha1_hex(&stable_key)
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

// Mirror of the JS CLEAN_REGEX = /<[^>]+>|&(nbsp|amp|quot|#39|apos|lt|gt);|\s+/gi
// pipeline, hand-rolled to avoid pulling in the regex crate (~1MB binary).
// Strips HTML tags (replaced with space), decodes a small set of named entities,
// collapses whitespace runs, and trims. Behavior matches the JS implementation
// in src/infra/http/client.ts byte-for-byte for the entities and pages we see.
fn clean_text_impl(input: &str) -> String {
  if input.is_empty() {
    return String::new();
  }
  let bytes = input.as_bytes();
  let mut out = String::with_capacity(input.len());
  let mut i = 0usize;
  let mut prev_was_space = true; // treat start-of-input as space so leading whitespace collapses

  while i < bytes.len() {
    let b = bytes[i];

    // HTML tag: <...>
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

    // Named entity: &(nbsp|amp|quot|#39|apos|lt|gt);
    if b == b'&' {
      let max = std::cmp::min(bytes.len(), i + 8);
      let mut j = i + 1;
      while j < max && bytes[j] != b';' {
        j += 1;
      }
      if j < bytes.len() && bytes[j] == b';' {
        let entity_bytes = &bytes[i + 1..j];
        // entity names are ASCII; safe to compare bytes after lowercasing.
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
        // Unknown entity: JS keeps the original match. Mirror that.
        out.push_str(&input[i..=j]);
        prev_was_space = false;
        i = j + 1;
        continue;
      }
      // Stray '&' with no closing ';' — keep as-is.
      out.push('&');
      prev_was_space = false;
      i += 1;
      continue;
    }

    // ASCII whitespace -> collapse runs to a single space.
    if b.is_ascii_whitespace() {
      if !prev_was_space {
        out.push(' ');
        prev_was_space = true;
      }
      i += 1;
      continue;
    }

    // Regular byte. For ASCII this is a 1-byte char; for multibyte UTF-8 we
    // need to copy the whole codepoint to keep the string valid.
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

  // Strip trailing space if we emitted one. Match JS `.trim()` semantics.
  while out.ends_with(' ') {
    out.pop();
  }
  out
}

fn sha1_hex(value: &str) -> String {
  let mut hasher = Sha1::new();
  hasher.update(value.as_bytes());
  hex_encode(&hasher.finalize())
}

// Lowercase-hex encoder. Faster than `format!("{:x}", ..)` per byte because we
// allocate exactly the right capacity once and write directly into the buffer
// instead of going through the Display/Write traits.
fn hex_encode(bytes: &[u8]) -> String {
  const HEX: &[u8; 16] = b"0123456789abcdef";
  let mut out = vec![0u8; bytes.len() * 2];
  for (i, &b) in bytes.iter().enumerate() {
    out[i * 2] = HEX[(b >> 4) as usize];
    out[i * 2 + 1] = HEX[(b & 0x0f) as usize];
  }
  // SAFETY: every byte written is an ASCII hex digit, so the buffer is valid UTF-8.
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
