use discord_patch_bot_logic as logic;
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

#[napi(object)]
pub struct AutocompleteChoice {
  pub name: String,
  pub value: String,
}

#[napi(object)]
pub struct ListingCandidate {
  pub href: String,
  pub text: String,
  pub position: i32,
}

#[napi(object)]
pub struct ListingAnchor {
  pub href: String,
  pub raw_text: String,
}

#[napi(object)]
pub struct RankedListingResult {
  pub href: String,
  pub text: String,
}

#[napi(object)]
pub struct SteamNewsItem {
  pub title: String,
  pub url: String,
  pub contents: String,
  pub tags: Vec<String>,
  pub feed_type: f64,
  pub feedname: String,
  pub date: f64,
}

#[napi(object)]
pub struct SteamMatchItem {
  pub name: String,
  pub item_type: String,
}

#[napi(object)]
pub struct DealCandidate {
  pub title: String,
  pub popularity_score: f64,
  pub fallback_id: String,
}

pub fn to_game_data(games: Vec<GameCandidate>) -> Vec<logic::GameCandidateData> {
  games
    .into_iter()
    .map(|game| logic::GameCandidateData { key: game.key, name: game.name, aliases: game.aliases })
    .collect()
}
