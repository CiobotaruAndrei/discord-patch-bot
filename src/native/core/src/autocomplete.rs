use crate::types::{AutocompleteChoiceData, GameCandidateData};
use crate::text::truncate_chars;

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
