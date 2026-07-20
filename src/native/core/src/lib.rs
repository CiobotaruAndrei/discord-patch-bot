mod autocomplete;
mod deals;
mod fuzzy;
mod hashing;
mod listing_rank;
mod steam;
mod text;
mod types;
mod updates;

pub use autocomplete::build_autocomplete_choices;
pub use deals::{deal_passes_filters, dedupe_and_rank_deals, DealCandidateData};
pub use fuzzy::find_game_keys;
pub use hashing::{deal_hash, normalize_deal_state, stable_update_id};
pub use listing_rank::{
  extract_and_rank_listing_candidates, rank_listing_candidates, score_listing_candidate,
  ListingAnchorData, RankedListingCandidate,
};
pub use steam::{
  choose_best_steam_match, select_latest_steam_patch_note, SteamMatchItemData, SteamNewsItemData,
};
pub use text::{clean_text, levenshtein, normalize_title_for_dedupe};
pub use types::{AutocompleteChoiceData, FuzzyMatch, GameCandidateData, ListingCandidateData};
pub use updates::{classify_patch_note, extract_date_score, is_good_steam_article_url};

#[cfg(test)]
mod tests {
  use super::*;

  fn game(key: &str, name: &str, aliases: &[&str]) -> GameCandidateData {
    GameCandidateData {
      key: key.to_string(),
      name: name.to_string(),
      aliases: if aliases.is_empty() {
        None
      } else {
        Some(aliases.iter().map(|a| a.to_string()).collect())
      },
    }
  }

  #[test]
  fn levenshtein_known_distances() {
    assert_eq!(levenshtein("abc", "abc"), 0);
    assert_eq!(levenshtein("kitten", "sitting"), 3);
    assert_eq!(levenshtein("", "abc"), 3);
  }

  #[test]
  fn stable_update_id_is_deterministic_and_distinct() {
    let a = stable_update_id("Patch 1", "https://example.com/1");
    let b = stable_update_id("Patch 1", "https://example.com/1");
    let c = stable_update_id("Patch 2", "https://example.com/2");
    assert_eq!(a, b);
    assert_ne!(a, c);
    assert!(!a.is_empty());
  }

  #[test]
  fn deal_hash_is_deterministic_and_distinct() {
    let a = deal_hash("Steam", "570", "", "Dota", "0", "20", "100");
    let b = deal_hash("Steam", "570", "", "Dota", "0", "20", "100");
    let c = deal_hash("Steam", "730", "", "CS", "0", "20", "100");
    assert_eq!(a, b);
    assert_ne!(a, c);
    assert!(!a.is_empty());
  }

  #[test]
  fn deal_hash_epic_strips_prefix_and_fallback_uses_normalized_title() {
    let with_prefix = deal_hash("Epic Games", "", "epic_abc", "Game", "0", "20", "100");
    let without_prefix = deal_hash("Epic Games", "", "abc", "Game", "0", "20", "100");
    assert_eq!(with_prefix, without_prefix);
    let fallback_a = deal_hash("GOG", "", "", "Game\u{2122} Deluxe", "0", "20", "100");
    let fallback_b = deal_hash("GOG", "", "", "game   deluxe", "0", "20", "100");
    assert_eq!(fallback_a, fallback_b);
  }

  #[test]
  fn deal_passes_filters_core_cases() {
    assert!(deal_passes_filters(0.0, 0.0, "Steam", 50.0, true, true, 0.0, &[]));
    assert!(!deal_passes_filters(0.0, 0.0, "Steam", 50.0, false, true, 0.0, &[]));
    assert!(!deal_passes_filters(10.0, 5.0, "Steam", 20.0, true, true, 0.0, &[]));
    assert!(deal_passes_filters(10.0, 50.0, "Steam", 20.0, true, true, 0.0, &["Steam".to_string()]));
    assert!(!deal_passes_filters(10.0, 50.0, "Steam", 20.0, true, true, 0.0, &["Epic Games".to_string()]));
    assert!(!deal_passes_filters(10.0, 50.0, "Steam", 20.0, true, true, 5.0, &[]));
  }

  #[test]
  fn clean_text_strips_tags_entities_and_whitespace() {
    assert_eq!(clean_text("<p>Hello&nbsp;world</p>"), "Hello world");
    assert_eq!(clean_text("a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;"), "a & b <c> \"d\" 'e'");
    assert_eq!(clean_text("  spatii \t multiple \n aici  "), "spatii multiple aici");
    assert_eq!(clean_text("diacritice șț rămân"), "diacritice șț rămân");
    assert_eq!(clean_text(""), "");
  }

  #[test]
  fn normalize_title_for_dedupe_drops_marks_and_punctuation() {
    assert_eq!(normalize_title_for_dedupe("Game\u{2122}: Deluxe \u{00ae} Edition!"), "game deluxe edition");
    assert_eq!(normalize_title_for_dedupe("  Spaced   Out  "), "spaced out");
  }

  #[test]
  fn extract_date_score_finds_leftmost_valid_date() {
    let leftmost = extract_date_score("https://x.com/2024-03-15/alt/2025-01-01");
    let single = extract_date_score("https://x.com/2024-03-15/");
    assert_eq!(leftmost, single);
    assert!(single > 0.0);
    assert_eq!(extract_date_score("https://x.com/2024-13-15/"), 0.0);
    assert_eq!(extract_date_score("https://x.com/2023-02-29/"), 0.0);
    assert!(extract_date_score("https://x.com/2024-02-29/") > 0.0);
    assert_eq!(extract_date_score("https://x.com/fara-data/"), 0.0);
  }

  #[test]
  fn classify_patch_note_rules() {
    assert!(classify_patch_note("Patch 1.2 notes", "", &[]));
    assert!(!classify_patch_note("Summer Sale", "patch", &[]));
    assert!(classify_patch_note("Ceva", "", &["PatchNotes".to_string()]));
    assert!(classify_patch_note("Ceva", "contine update inauntru", &[]));
    assert!(!classify_patch_note("Ceva", "nimic relevant", &[]));
  }

  #[test]
  fn is_good_steam_article_url_rules() {
    assert!(is_good_steam_article_url("https://store.steampowered.com/news/1"));
    assert!(!is_good_steam_article_url(""));
    assert!(!is_good_steam_article_url("ftp://x"));
    assert!(!is_good_steam_article_url("https://cdn.steamstatic.com/img.png"));
    assert!(!is_good_steam_article_url("https://steamcdn-a.net/img.png"));
  }

  #[test]
  fn score_listing_candidate_counts_keywords_once_each() {
    let keywords = vec!["patch".to_string(), "notes".to_string(), "".to_string()];
    assert_eq!(score_listing_candidate("https://x.com/patch", "Patch notes", &keywords), 2);
    assert_eq!(score_listing_candidate("https://x.com", "nimic", &keywords), 0);
    assert_eq!(score_listing_candidate("https://x.com/patch", "patch", &[]), 0);
  }

  #[test]
  fn rank_listing_candidates_orders_by_score_then_date_then_position() {
    let candidates = vec![
      ListingCandidateData { href: "https://x.com/old".to_string(), text: "nimic".to_string(), position: 0 },
      ListingCandidateData { href: "https://x.com/2024-05-01/patch".to_string(), text: "patch".to_string(), position: 1 },
      ListingCandidateData { href: "https://x.com/2024-06-01/patch".to_string(), text: "patch".to_string(), position: 2 },
    ];
    let order = rank_listing_candidates(&candidates, &["patch".to_string()]);
    assert_eq!(order, vec![2, 1, 0]);
    let no_keywords = rank_listing_candidates(&candidates, &[]);
    assert_eq!(no_keywords, vec![2, 1, 0]);
  }

  fn anchor(href: &str, raw_text: &str) -> ListingAnchorData {
    ListingAnchorData { href: href.to_string(), raw_text: raw_text.to_string() }
  }

  #[test]
  fn extract_and_rank_batch_cleans_dedupes_filters_and_ranks() {
    let anchors = vec![
      anchor("https://x.com/old", "<b>Community</b> article"),
      anchor("https://x.com/2024-05-01/patch", "  Patch   notes  "),
      anchor("https://x.com/2024-05-01/patch", "duplicate of the same href"),
      anchor("https://x.com/2024-06-01/patch", "Latest patch"),
    ];
    let ranked = extract_and_rank_listing_candidates(&anchors, &["patch".to_string()], 0);
    let order: Vec<&str> = ranked.iter().map(|c| c.href.as_str()).collect();
    assert_eq!(order, vec!["https://x.com/2024-06-01/patch", "https://x.com/2024-05-01/patch"]);
    assert_eq!(ranked[1].text, "Patch notes", "textul e curatat inainte de returnare");
  }

  #[test]
  fn extract_and_rank_batch_without_keywords_keeps_all_by_date_then_position() {
    let anchors = vec![
      anchor("https://x.com/no-date", "prima"),
      anchor("https://x.com/2024-06-01/a", "a doua"),
      anchor("https://x.com/2024-07-01/b", "a treia"),
    ];
    let ranked = extract_and_rank_listing_candidates(&anchors, &[], 0);
    let order: Vec<&str> = ranked.iter().map(|c| c.href.as_str()).collect();
    assert_eq!(order, vec!["https://x.com/2024-07-01/b", "https://x.com/2024-06-01/a", "https://x.com/no-date"]);
  }

  #[test]
  fn extract_and_rank_batch_respects_max_results() {
    let anchors = vec![
      anchor("https://x.com/2024-01-01/patch", "patch one"),
      anchor("https://x.com/2024-02-01/patch", "patch two"),
      anchor("https://x.com/2024-03-01/patch", "patch three"),
    ];
    let ranked = extract_and_rank_listing_candidates(&anchors, &["patch".to_string()], 2);
    assert_eq!(ranked.len(), 2, "returneaza doar cei mai buni max_results candidati");
    assert_eq!(ranked[0].href, "https://x.com/2024-03-01/patch");
  }

  #[test]
  fn extract_and_rank_batch_drops_zero_score_when_keywords_present() {
    let anchors = vec![
      anchor("https://x.com/irrelevant", "nimic relevant"),
      anchor("https://x.com/patch", "patch notes"),
    ];
    let ranked = extract_and_rank_listing_candidates(&anchors, &["patch".to_string()], 0);
    assert_eq!(ranked.len(), 1);
    assert_eq!(ranked[0].href, "https://x.com/patch");
  }

  fn news(title: &str, url: &str, feed_type: f64, feedname: &str, date: f64) -> SteamNewsItemData {
    SteamNewsItemData {
      title: title.to_string(),
      url: url.to_string(),
      contents: String::new(),
      tags: Vec::new(),
      feed_type,
      feedname: feedname.to_string(),
      date,
    }
  }

  #[test]
  fn select_latest_steam_patch_note_picks_newest_valid() {
    let items = vec![
      news("Summer Sale", "https://store.steampowered.com/news/1", 1.0, "", 300.0),
      news("Patch 1.2 notes", "https://store.steampowered.com/news/2", 1.0, "", 100.0),
      news("Hotfix build", "https://store.steampowered.com/news/3", 1.0, "", 200.0),
    ];
    assert_eq!(select_latest_steam_patch_note(&items), Some(2), "cel mai nou patch note valid (sale-ul e respins de clasificare)");
  }

  #[test]
  fn select_latest_steam_patch_note_requires_feed_and_url() {
    let items = vec![
      news("Patch notes", "https://cdn.steamstatic.com/img.png", 1.0, "", 100.0),
      news("Patch notes", "https://store.steampowered.com/news/2", 7.0, "other_feed", 200.0),
      news("Patch notes", "https://store.steampowered.com/news/3", 7.0, "steam_community_announcements", 150.0),
    ];
    assert_eq!(select_latest_steam_patch_note(&items), Some(2), "URL CDN respins; feed_type gresit fara feedname respins; ramane anuntul comunitatii");
  }

  #[test]
  fn select_latest_steam_patch_note_ties_keep_first_occurrence() {
    let items = vec![
      news("Patch A", "https://store.steampowered.com/news/a", 1.0, "", 500.0),
      news("Patch B", "https://store.steampowered.com/news/b", 1.0, "", 500.0),
    ];
    assert_eq!(select_latest_steam_patch_note(&items), Some(0), "la data egala se pastreaza prima aparitie (sort stabil desc + [0])");
  }

  #[test]
  fn select_latest_steam_patch_note_none_when_no_valid() {
    let items = vec![news("Community giveaway", "https://store.steampowered.com/news/1", 1.0, "", 100.0)];
    assert_eq!(select_latest_steam_patch_note(&items), None);
    assert_eq!(select_latest_steam_patch_note(&[]), None);
  }

  fn match_item(name: &str, item_type: &str) -> SteamMatchItemData {
    SteamMatchItemData { name: name.to_string(), item_type: item_type.to_string() }
  }

  #[test]
  fn choose_best_steam_match_prefers_exact_then_prefix() {
    let items = vec![
      match_item("The Witcher 3: Wild Hunt", "game"),
      match_item("The Witcher 3: Wild Hunt - Hearts of Stone", "dlc"),
      match_item("Cyberpunk 2077", "game"),
    ];
    assert_eq!(choose_best_steam_match(&items, "The Witcher 3: Wild Hunt", false), Some(0), "potrivirea exacta castiga (bonus -100)");
    assert_eq!(choose_best_steam_match(&items, "witcher 3", false), Some(0), "prefix/includere pe joc bate DLC-ul");
  }

  #[test]
  fn choose_best_steam_match_force_game_only_filters_dlc() {
    let items = vec![
      match_item("Elden Ring - Shadow of the Erdtree", "dlc"),
      match_item("Elden Ring", "game"),
    ];
    assert_eq!(choose_best_steam_match(&items, "elden ring", true), Some(1), "force_game_only elimina DLC-ul cand nu se cere explicit");
    assert_eq!(choose_best_steam_match(&items, "Elden Ring Shadow of the Erdtree dlc", true), Some(0), "cuvantul cheie DLC in interogare sare peste filtru, iar DLC-ul potriveste cel mai bine");
  }

  #[test]
  fn choose_best_steam_match_penalizes_extra_types() {
    let items = vec![
      match_item("Hades Soundtrack", "music"),
      match_item("Hades", "game"),
    ];
    assert_eq!(choose_best_steam_match(&items, "hades", false), Some(1), "penalizarea +50 pe music/dlc/demo lasa jocul sa castige");
  }

  #[test]
  fn choose_best_steam_match_empty_is_none() {
    assert_eq!(choose_best_steam_match(&[], "anything", false), None);
  }

  fn deal(title: &str, popularity_score: f64, fallback_id: &str) -> DealCandidateData {
    DealCandidateData { title: title.to_string(), popularity_score, fallback_id: fallback_id.to_string() }
  }

  #[test]
  fn dedupe_and_rank_deals_keeps_higher_popularity_and_sorts_desc() {
    let deals = vec![
      deal("Hades", 30.0, "a"),
      deal("Celeste", 80.0, "b"),
      deal("Hades\u{2122}", 90.0, "c"),
      deal("Stardew Valley", 50.0, "d"),
    ];
    let order = dedupe_and_rank_deals(&deals, 0);
    assert_eq!(order, vec![2, 1, 3], "Hades dedus la scorul mai mare (index 2), apoi sort desc: 90,80,50");
  }

  #[test]
  fn dedupe_and_rank_deals_tie_keeps_first_seen_and_respects_max() {
    let deals = vec![
      deal("Hades", 50.0, "a"),
      deal("Hades", 50.0, "b"),
      deal("Celeste", 70.0, "c"),
    ];
    let order = dedupe_and_rank_deals(&deals, 2);
    assert_eq!(order, vec![2, 0], "la scor egal se pastreaza prima aparitie (index 0), max_deals taie la 2");
  }

  #[test]
  fn dedupe_and_rank_deals_empty_title_uses_fallback_id() {
    let deals = vec![
      deal("!!!", 10.0, "id-1"),
      deal("@@@", 20.0, "id-2"),
      deal("###", 5.0, "id-1"),
    ];
    let order = dedupe_and_rank_deals(&deals, 0);
    assert_eq!(order, vec![1, 2], "titluri care se normalizeaza la gol -> cheie = fallback_id; id-1 suprascris de ultima aparitie (index 2), sort desc pe scor: 20, 5");
  }

  #[test]
  fn dedupe_and_rank_deals_empty_input() {
    assert_eq!(dedupe_and_rank_deals(&[], 5), Vec::<u32>::new());
  }

  #[test]
  fn build_autocomplete_choices_filters_sorts_and_truncates() {
    let games = vec![
      game("cs2", "Counter-Strike 2", &["csgo"]),
      game("fortnite", "Fortnite", &[]),
      game("dota2", "Dota 2", &[]),
    ];
    let choices = build_autocomplete_choices(&games, "fort", false, 20, 25, 100, 100);
    assert_eq!(choices.len(), 1);
    assert_eq!(choices[0].value, "fortnite");
    assert_eq!(choices[0].name, "Fortnite (fortnite)");

    let all = build_autocomplete_choices(&games, "", false, 20, 2, 100, 100);
    assert_eq!(all.len(), 2);
    assert_eq!(all[0].name, "Counter-Strike 2 (cs2)");

    let truncated = build_autocomplete_choices(&games, "fort", true, 20, 25, 4, 4);
    assert_eq!(truncated[0].name, "Fort");
    assert_eq!(truncated[0].value, "Fort");
  }

  #[test]
  fn find_game_keys_exact_fuzzy_and_suggestion() {
    let games = vec![
      game("cs2", "Counter-Strike 2", &["csgo"]),
      game("fortnite", "Fortnite", &[]),
    ];
    assert_eq!(find_game_keys("fortnite", &games, 100).game_key.as_deref(), Some("fortnite"));
    assert_eq!(find_game_keys("CSGO", &games, 100).game_key.as_deref(), Some("cs2"));
    assert_eq!(find_game_keys("fortnitr", &games, 100).game_key.as_deref(), Some("fortnite"));
    let suggestion = find_game_keys("fortni", &games, 100);
    assert!(suggestion.game_key.is_some() || suggestion.suggestion_key.is_some());
    let none = find_game_keys("xyzqwv", &games, 100);
    assert_eq!(none.game_key, None);
    assert_eq!(none.suggestion_key, None);
  }

  #[test]
  fn normalize_deal_state_trims_and_lowercases() {
    assert_eq!(normalize_deal_state(" 10.00 ", "20.00", " 50 "), "10.00:20.00:50");
    assert_eq!(normalize_deal_state("Free", "0", "0"), "free:0:0");
  }
}
