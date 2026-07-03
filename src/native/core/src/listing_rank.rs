use crate::types::ListingCandidateData;
use crate::updates::extract_date_score;

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
