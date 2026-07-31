use discord_patch_bot_logic as logic;
use napi_derive::napi;

use crate::shapes::{to_game_data, AutocompleteChoice, FuzzyMatchResult, GameCandidate};

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
  logic::build_autocomplete_choices(
    &to_game_data(games),
    &input,
    use_name_as_value,
    min_relevant_score,
    max_choices as usize,
    max_name_len as usize,
    max_value_len as usize,
  )
  .into_iter()
  .map(|choice| AutocompleteChoice { name: choice.name, value: choice.value })
  .collect()
}

#[napi]
pub fn find_game_keys(text: String, games: Vec<GameCandidate>, max_input: u32) -> FuzzyMatchResult {
  let result = logic::find_game_keys(&text, &to_game_data(games), max_input as usize);
  FuzzyMatchResult { game_key: result.game_key, suggestion_key: result.suggestion_key }
}
