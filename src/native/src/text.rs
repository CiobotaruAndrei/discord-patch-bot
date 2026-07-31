use discord_patch_bot_logic as logic;
use napi_derive::napi;

#[napi]
pub fn levenshtein(a: String, b: String) -> u32 {
  logic::levenshtein(&a, &b) as u32
}

#[napi]
pub fn normalize_title_for_dedupe(value: String) -> String {
  logic::normalize_title_for_dedupe(&value)
}

#[napi]
pub fn clean_text(text: String) -> String {
  logic::clean_text(&text)
}

#[napi]
pub fn is_good_steam_article_url(url: String) -> bool {
  logic::is_good_steam_article_url(&url)
}

#[napi]
pub fn extract_date_score(url: String) -> f64 {
  logic::extract_date_score(&url)
}

#[napi]
pub fn classify_patch_note(title: String, contents: String, tags: Vec<String>) -> bool {
  logic::classify_patch_note(&title, &contents, &tags)
}

#[napi]
pub fn score_listing_candidate(href: String, text: String, keywords: Vec<String>) -> u32 {
  logic::score_listing_candidate(&href, &text, &keywords)
}

#[napi]
pub fn stable_update_id(title: String, link: String) -> String {
  logic::stable_update_id(&title, &link)
}

#[napi]
pub fn normalize_deal_state(sale_price: String, normal_price: String, savings: String) -> String {
  logic::normalize_deal_state(&sale_price, &normal_price, &savings)
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
  logic::deal_passes_filters(
    sale_price_num,
    savings_num,
    &store,
    min_discount_percent,
    include_free_games,
    include_paid_discounts,
    max_absolute_price,
    &enabled_stores,
  )
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
  logic::deal_hash(&store, &steam_app_id, &id, &title, &sale_price, &normal_price, &savings)
}
