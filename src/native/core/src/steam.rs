use crate::text::levenshtein;
use crate::updates::{classify_patch_note, is_good_steam_article_url};

const STEAM_MATCH_DLC_KEYWORDS: &[&str] = &[
  "dlc", "soundtrack", "demo", "expansion", "deluxe upgrade", "season pass",
  "ost", "artbook", "collection", "remaster", "bundle", "definitive edition",
];

pub struct SteamMatchItemData {
  pub name: String,
  pub item_type: String,
}

fn normalize_steam_match(value: &str) -> String {
  let mapped: String = value
    .to_lowercase()
    .chars()
    .map(|c| if c.is_ascii_lowercase() || c.is_ascii_digit() || c.is_whitespace() { c } else { ' ' })
    .collect();
  mapped.split_whitespace().collect::<Vec<&str>>().join(" ")
}

pub fn choose_best_steam_match(items: &[SteamMatchItemData], query: &str, force_game_only: bool) -> Option<u32> {
  if items.is_empty() {
    return None;
  }
  let search_target = query.to_lowercase();
  let search_target = search_target.trim();
  let norm_target = normalize_steam_match(query);
  let wants_dlc = STEAM_MATCH_DLC_KEYWORDS.iter().any(|kw| search_target.contains(kw));

  let mut pool: Vec<usize> = (0..items.len()).collect();
  if force_game_only && !wants_dlc {
    let games_only: Vec<usize> = items
      .iter()
      .enumerate()
      .filter(|(_, item)| {
        let type_lc = item.item_type.to_lowercase();
        let name_lc = item.name.to_lowercase();
        let name_has_extra = STEAM_MATCH_DLC_KEYWORDS.iter().any(|kw| name_lc.contains(kw));
        if !type_lc.is_empty() && type_lc != "game" {
          return false;
        }
        if name_has_extra {
          return false;
        }
        true
      })
      .map(|(index, _)| index)
      .collect();
    if !games_only.is_empty() {
      pool = games_only;
    }
  }
  if pool.is_empty() {
    return None;
  }

  let mut best_index = pool[0];
  let mut best_score = i64::MAX;
  for &index in &pool {
    let item = &items[index];
    let item_name = item.name.to_lowercase();
    let norm_item = normalize_steam_match(&item.name);
    let mut score = levenshtein(&norm_target, &norm_item) as i64;
    if norm_item == norm_target {
      score -= 100;
    } else if norm_item.starts_with(&norm_target) {
      score -= 20;
    } else if norm_item.contains(&norm_target) {
      score -= 10;
    }
    if !wants_dlc {
      let is_extra_by_name = STEAM_MATCH_DLC_KEYWORDS.iter().any(|kw| item_name.contains(kw));
      let type_lc = item.item_type.to_lowercase();
      let is_extra_by_type = type_lc == "dlc" || type_lc == "demo" || type_lc == "music";
      if is_extra_by_name || is_extra_by_type {
        score += 50;
      }
    }
    if score < best_score {
      best_score = score;
      best_index = index;
    }
  }
  Some(best_index as u32)
}

pub struct SteamNewsItemData {
  pub title: String,
  pub url: String,
  pub contents: String,
  pub tags: Vec<String>,
  pub feed_type: f64,
  pub feedname: String,
  pub date: f64,
}

pub fn select_latest_steam_patch_note(items: &[SteamNewsItemData]) -> Option<u32> {
  let mut best: Option<(usize, f64)> = None;
  for (index, item) in items.iter().enumerate() {
    let passes = (item.feed_type == 1.0 || item.feedname == "steam_community_announcements")
      && is_good_steam_article_url(&item.url)
      && classify_patch_note(&item.title, &item.contents, &item.tags);
    if !passes {
      continue;
    }
    match best {
      None => best = Some((index, item.date)),
      Some((_, best_date)) => {
        if item.date > best_date {
          best = Some((index, item.date));
        }
      }
    }
  }
  best.map(|(index, _)| index as u32)
}
