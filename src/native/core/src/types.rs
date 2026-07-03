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
