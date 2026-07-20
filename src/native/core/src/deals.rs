use crate::text::normalize_title_for_dedupe;
use std::collections::HashMap;

pub struct DealCandidateData {
  pub title: String,
  pub popularity_score: f64,
  pub fallback_id: String,
}

pub fn dedupe_and_rank_deals(candidates: &[DealCandidateData], max_deals: usize) -> Vec<u32> {
  struct Kept {
    original_index: usize,
    score: f64,
  }
  let mut kept: Vec<Kept> = Vec::new();
  let mut slot_by_key: HashMap<String, usize> = HashMap::new();
  for (index, candidate) in candidates.iter().enumerate() {
    let normalized = normalize_title_for_dedupe(&candidate.title);
    if normalized.is_empty() {
      let key = candidate.fallback_id.clone();
      match slot_by_key.get(&key) {
        Some(&slot) => kept[slot] = Kept { original_index: index, score: candidate.popularity_score },
        None => {
          slot_by_key.insert(key, kept.len());
          kept.push(Kept { original_index: index, score: candidate.popularity_score });
        }
      }
      continue;
    }
    match slot_by_key.get(&normalized) {
      Some(&slot) => {
        if candidate.popularity_score > kept[slot].score {
          kept[slot] = Kept { original_index: index, score: candidate.popularity_score };
        }
      }
      None => {
        slot_by_key.insert(normalized, kept.len());
        kept.push(Kept { original_index: index, score: candidate.popularity_score });
      }
    }
  }
  let mut order: Vec<usize> = (0..kept.len()).collect();
  order.sort_by(|&a, &b| kept[b].score.partial_cmp(&kept[a].score).unwrap_or(std::cmp::Ordering::Equal));
  let limit = if max_deals == 0 { order.len() } else { max_deals.min(order.len()) };
  order.into_iter().take(limit).map(|slot| kept[slot].original_index as u32).collect()
}

#[allow(clippy::too_many_arguments)]
pub fn deal_passes_filters(
  sale_price_num: f64,
  savings_num: f64,
  store: &str,
  min_discount_percent: f64,
  include_free_games: bool,
  include_paid_discounts: bool,
  max_absolute_price: f64,
  enabled_stores: &[String],
) -> bool {
  let is_free = sale_price_num == 0.0;
  if is_free && !include_free_games {
    return false;
  }
  if !is_free && !include_paid_discounts {
    return false;
  }
  if !is_free && (!savings_num.is_finite() || savings_num < min_discount_percent) {
    return false;
  }
  if !is_free
    && max_absolute_price > 0.0
    && sale_price_num.is_finite()
    && sale_price_num > max_absolute_price
  {
    return false;
  }
  if !enabled_stores.is_empty() && !enabled_stores.iter().any(|candidate| candidate == store) {
    return false;
  }
  true
}
