use crate::text::clean_text;
use crate::types::ListingCandidateData;
use crate::updates::extract_date_score;
use std::collections::HashSet;

pub struct ListingAnchorData {
  pub href: String,
  pub raw_text: String,
}

pub struct RankedListingCandidate {
  pub href: String,
  pub text: String,
}

pub fn score_listing_candidate(href: &str, text: &str, keywords: &[String]) -> u32 {
  if keywords.is_empty() {
    return 0;
  }
  let mut haystack = String::with_capacity(href.len() + text.len() + 1);
  haystack.push_str(href);
  haystack.push(' ');
  haystack.push_str(text);
  let haystack_lc = haystack.to_lowercase();
  let mut score: u32 = 0;
  for keyword in keywords {
    if keyword.is_empty() {
      continue;
    }
    let kw_lc = keyword.to_lowercase();
    if haystack_lc.contains(&kw_lc) {
      score += 1;
    }
  }
  score
}

pub fn extract_and_rank_listing_candidates(
  anchors: &[ListingAnchorData],
  keywords: &[String],
  max_results: usize,
) -> Vec<RankedListingCandidate> {
  let has_keywords = !keywords.is_empty();
  struct Scored {
    href: String,
    text: String,
    score: u32,
    date: f64,
    position: usize,
  }
  let mut seen: HashSet<String> = HashSet::new();
  let mut scored: Vec<Scored> = Vec::new();
  let mut position: usize = 0;
  for anchor in anchors {
    if anchor.href.is_empty() {
      continue;
    }
    let text = clean_text(&anchor.raw_text);
    let score = if has_keywords {
      score_listing_candidate(&anchor.href, &text, keywords)
    } else {
      0
    };
    if has_keywords && score == 0 {
      continue;
    }
    let current = position;
    position += 1;
    if !seen.insert(anchor.href.clone()) {
      continue;
    }
    let date = extract_date_score(&anchor.href);
    scored.push(Scored {
      href: anchor.href.clone(),
      text,
      score,
      date,
      position: current,
    });
  }
  scored.sort_by(|a, b| {
    b.score
      .cmp(&a.score)
      .then_with(|| b.date.partial_cmp(&a.date).unwrap_or(std::cmp::Ordering::Equal))
      .then_with(|| a.position.cmp(&b.position))
  });
  let limit = if max_results == 0 { scored.len() } else { max_results };
  scored
    .into_iter()
    .take(limit)
    .map(|entry| RankedListingCandidate { href: entry.href, text: entry.text })
    .collect()
}

pub fn rank_listing_candidates(candidates: &[ListingCandidateData], keywords: &[String]) -> Vec<u32> {
  let has_keywords = !keywords.is_empty();
  let scores: Vec<(u32, f64)> = candidates
    .iter()
    .map(|candidate| {
      let score = if has_keywords {
        score_listing_candidate(&candidate.href, &candidate.text, keywords)
      } else {
        0
      };
      (score, extract_date_score(&candidate.href))
    })
    .collect();
  let mut order: Vec<u32> = (0..candidates.len() as u32).collect();
  order.sort_by(|&a, &b| {
    let (ai, bi) = (a as usize, b as usize);
    scores[bi]
      .0
      .cmp(&scores[ai].0)
      .then_with(|| scores[bi].1.partial_cmp(&scores[ai].1).unwrap_or(std::cmp::Ordering::Equal))
      .then_with(|| candidates[ai].position.cmp(&candidates[bi].position))
  });
  order
}
