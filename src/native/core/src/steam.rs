use crate::updates::{classify_patch_note, is_good_steam_article_url};

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
