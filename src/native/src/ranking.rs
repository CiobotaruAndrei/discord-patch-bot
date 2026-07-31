use discord_patch_bot_logic as logic;
use napi_derive::napi;

use crate::shapes::{DealCandidate, ListingAnchor, ListingCandidate, RankedListingResult, SteamMatchItem, SteamNewsItem};

#[napi]
pub fn rank_listing_candidates(candidates: Vec<ListingCandidate>, keywords: Vec<String>) -> Vec<u32> {
  let data: Vec<logic::ListingCandidateData> = candidates
    .into_iter()
    .map(|candidate| logic::ListingCandidateData {
      href: candidate.href,
      text: candidate.text,
      position: candidate.position,
    })
    .collect();
  logic::rank_listing_candidates(&data, &keywords)
}

#[napi]
pub fn extract_and_rank_listing_candidates(
  anchors: Vec<ListingAnchor>,
  keywords: Vec<String>,
  max_results: u32,
) -> Vec<RankedListingResult> {
  let data: Vec<logic::ListingAnchorData> = anchors
    .into_iter()
    .map(|anchor| logic::ListingAnchorData { href: anchor.href, raw_text: anchor.raw_text })
    .collect();
  logic::extract_and_rank_listing_candidates(&data, &keywords, max_results as usize)
    .into_iter()
    .map(|candidate| RankedListingResult { href: candidate.href, text: candidate.text })
    .collect()
}

#[napi]
pub fn select_latest_steam_patch_note(items: Vec<SteamNewsItem>) -> Option<u32> {
  let data: Vec<logic::SteamNewsItemData> = items
    .into_iter()
    .map(|item| logic::SteamNewsItemData {
      title: item.title,
      url: item.url,
      contents: item.contents,
      tags: item.tags,
      feed_type: item.feed_type,
      feedname: item.feedname,
      date: item.date,
    })
    .collect();
  logic::select_latest_steam_patch_note(&data)
}

#[napi]
pub fn choose_best_steam_match(items: Vec<SteamMatchItem>, query: String, force_game_only: bool) -> Option<u32> {
  let data: Vec<logic::SteamMatchItemData> = items
    .into_iter()
    .map(|item| logic::SteamMatchItemData { name: item.name, item_type: item.item_type })
    .collect();
  logic::choose_best_steam_match(&data, &query, force_game_only)
}

#[napi]
pub fn dedupe_and_rank_deals(candidates: Vec<DealCandidate>, max_deals: u32) -> Vec<u32> {
  let data: Vec<logic::DealCandidateData> = candidates
    .into_iter()
    .map(|candidate| logic::DealCandidateData {
      title: candidate.title,
      popularity_score: candidate.popularity_score,
      fallback_id: candidate.fallback_id,
    })
    .collect();
  logic::dedupe_and_rank_deals(&data, max_deals as usize)
}
