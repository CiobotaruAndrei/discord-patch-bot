use napi_derive::napi;

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
