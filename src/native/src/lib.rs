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
