use discord_patch_bot_logic as logic;
use napi::bindgen_prelude::{AsyncTask, Buffer, Env, Task};
use napi_derive::napi;

#[napi(object)]
pub struct InspectionInput {
  pub bytes: Buffer,
  pub filename: String,
  pub mime: String,
  pub mode: String,
  pub max_depth: u32,
  pub max_entries: u32,
  pub max_expanded_bytes: f64,
  pub max_compression_ratio: f64,
  pub timeout_ms: f64,
}

#[napi(object)]
pub struct InspectionReportJs {
  pub status: String,
  pub indicators: Vec<String>,
  pub reason: String,
  pub entries_inspected: u32,
  pub expanded_bytes: f64,
  pub elapsed_ms: f64,
  pub uninspectable_format: Option<String>,
  pub analysis_blind_spots: Vec<String>,
}

pub struct InspectContentTask {
  bytes: Vec<u8>,
  filename: String,
  mime: String,
  mode: String,
  max_depth: u32,
  max_entries: u32,
  max_expanded_bytes: u64,
  max_compression_ratio: f64,
  timeout_ms: u64,
}

impl Task for InspectContentTask {
  type Output = logic::InspectionReport;
  type JsValue = InspectionReportJs;

  fn compute(&mut self) -> napi::Result<Self::Output> {
    Ok(logic::inspect_untrusted_content(
      &self.bytes,
      &self.filename,
      &self.mime,
      &self.mode,
      logic::InspectionLimits {
        max_depth: self.max_depth,
        max_entries: self.max_entries,
        max_expanded_bytes: self.max_expanded_bytes,
        max_compression_ratio: self.max_compression_ratio,
        timeout_ms: self.timeout_ms,
      },
    ))
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
    Ok(InspectionReportJs {
      status: output.status,
      indicators: output.indicators,
      reason: output.reason,
      entries_inspected: output.entries_inspected,
      expanded_bytes: output.expanded_bytes as f64,
      elapsed_ms: output.elapsed_ms,
      uninspectable_format: output.uninspectable_format,
      analysis_blind_spots: output.analysis_blind_spots,
    })
  }
}

#[napi(ts_return_type = "Promise<InspectionReportJs>")]
pub fn inspect_untrusted_content(input: InspectionInput) -> AsyncTask<InspectContentTask> {
  let defaults = logic::InspectionLimits::default();
  AsyncTask::new(InspectContentTask {
    bytes: input.bytes.to_vec(),
    filename: input.filename,
    mime: input.mime,
    mode: input.mode,
    max_depth: if input.max_depth > 0 { input.max_depth } else { defaults.max_depth },
    max_entries: if input.max_entries > 0 { input.max_entries } else { defaults.max_entries },
    max_expanded_bytes: if input.max_expanded_bytes > 0.0 { input.max_expanded_bytes as u64 } else { defaults.max_expanded_bytes },
    max_compression_ratio: if input.max_compression_ratio > 0.0 { input.max_compression_ratio } else { defaults.max_compression_ratio },
    timeout_ms: if input.timeout_ms > 0.0 { input.timeout_ms as u64 } else { defaults.timeout_ms },
  })
}

#[napi(object)]
pub struct MagicReportJs {
  pub mime: String,
  pub description: String,
  pub encoding: String,
  pub kind: String,
  pub extension_mime: String,
  pub declared_mime: String,
  pub mismatch_flags: u32,
}

#[napi]
pub fn inspect_magic(bytes: Buffer, filename: String, declared_mime: String) -> MagicReportJs {
  let report = logic::inspect_magic(&bytes, &filename, &declared_mime);
  MagicReportJs {
    mime: report.mime,
    description: report.description,
    encoding: report.encoding,
    kind: report.kind,
    extension_mime: report.extension_mime,
    declared_mime: report.declared_mime,
    mismatch_flags: report.mismatch_flags,
  }
}

#[napi(object)]
pub struct YaraMatchJs {
  pub rule: String,
  pub namespace: String,
  pub tags: Vec<String>,
  pub severity: String,
  pub description: String,
}

#[napi(object)]
pub struct YaraScanReportJs {
  pub status: String,
  pub reason: String,
  pub ruleset_id: String,
  pub matches: Vec<YaraMatchJs>,
  pub truncated: bool,
}

#[napi(object)]
pub struct YaraRulesetInfoJs {
  pub ruleset_id: String,
  pub rule_count: u32,
  pub loaded: bool,
  pub available: bool,
}

#[napi]
pub fn load_yara_rules(source: String) -> napi::Result<YaraRulesetInfoJs> {
  match logic::load_yara_rules(&source) {
    Ok(info) => Ok(YaraRulesetInfoJs {
      ruleset_id: info.ruleset_id,
      rule_count: info.rule_count,
      loaded: info.loaded,
      available: logic::yara_available(),
    }),
    Err(error) => Err(napi::Error::from_reason(error)),
  }
}

#[napi]
pub fn yara_ruleset_info() -> YaraRulesetInfoJs {
  let info = logic::yara_ruleset_info();
  YaraRulesetInfoJs {
    ruleset_id: info.ruleset_id,
    rule_count: info.rule_count,
    loaded: info.loaded,
    available: logic::yara_available(),
  }
}

#[napi(object)]
pub struct SuffixListInfoJs {
  pub list_id: String,
  pub rule_count: u32,
  pub loaded: bool,
  pub available: bool,
}

#[napi(object)]
pub struct UrlIdentityReportJs {
  pub host_unicode: String,
  pub host_punycode: String,
  pub registrable_domain: String,
  pub public_suffix: String,
  pub skeleton: String,
  pub scripts: String,
  pub restriction_level: String,
  pub brand_match: String,
  pub indicators: Vec<String>,
  pub suffix_list_id: String,
  pub unicode_version: String,
}

#[napi]
pub fn load_public_suffix_list(source: String) -> napi::Result<SuffixListInfoJs> {
  match logic::load_public_suffix_list(source.as_bytes()) {
    Ok(info) => Ok(SuffixListInfoJs {
      list_id: info.list_id,
      rule_count: info.rule_count,
      loaded: info.loaded,
      available: logic::url_identity_available(),
    }),
    Err(error) => Err(napi::Error::from_reason(error)),
  }
}

#[napi]
pub fn public_suffix_info() -> SuffixListInfoJs {
  let info = logic::public_suffix_info();
  SuffixListInfoJs {
    list_id: info.list_id,
    rule_count: info.rule_count,
    loaded: info.loaded,
    available: logic::url_identity_available(),
  }
}

#[napi]
pub fn analyze_url_host(host: String, brands: Vec<String>) -> UrlIdentityReportJs {
  let report = logic::analyze_url_host(&host, &brands);
  UrlIdentityReportJs {
    host_unicode: report.host_unicode,
    host_punycode: report.host_punycode,
    registrable_domain: report.registrable_domain,
    public_suffix: report.public_suffix,
    skeleton: report.skeleton,
    scripts: report.scripts,
    restriction_level: report.restriction_level,
    brand_match: report.brand_match,
    indicators: report.indicators,
    suffix_list_id: report.suffix_list_id,
    unicode_version: report.unicode_version,
  }
}

pub struct ScanYaraTask {
  bytes: Vec<u8>,
  timeout_ms: u32,
  max_matches: u32,
}

impl Task for ScanYaraTask {
  type Output = logic::YaraScanReport;
  type JsValue = YaraScanReportJs;

  fn compute(&mut self) -> napi::Result<Self::Output> {
    Ok(logic::scan_yara(&self.bytes, self.timeout_ms, self.max_matches))
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
    Ok(YaraScanReportJs {
      status: output.status,
      reason: output.reason,
      ruleset_id: output.ruleset_id,
      matches: output
        .matches
        .into_iter()
        .map(|found| YaraMatchJs {
          rule: found.rule,
          namespace: found.namespace,
          tags: found.tags,
          severity: found.severity,
          description: found.description,
        })
        .collect(),
      truncated: output.truncated,
    })
  }
}

#[napi(ts_return_type = "Promise<YaraScanReportJs>")]
pub fn scan_yara(bytes: Buffer, timeout_ms: u32, max_matches: u32) -> AsyncTask<ScanYaraTask> {
  AsyncTask::new(ScanYaraTask { bytes: bytes.to_vec(), timeout_ms, max_matches })
}

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

fn to_game_data(games: Vec<GameCandidate>) -> Vec<logic::GameCandidateData> {
  games
    .into_iter()
    .map(|game| logic::GameCandidateData { key: game.key, name: game.name, aliases: game.aliases })
    .collect()
}

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

#[napi]
pub fn build_autocomplete_choices(
  games: Vec<GameCandidate>,
  input: String,
  use_name_as_value: bool,
  min_relevant_score: i32,
  max_choices: u32,
  max_name_len: u32,
  max_value_len: u32,
) -> Vec<AutocompleteChoice> {
  logic::build_autocomplete_choices(
    &to_game_data(games),
    &input,
    use_name_as_value,
    min_relevant_score,
    max_choices as usize,
    max_name_len as usize,
    max_value_len as usize,
  )
  .into_iter()
  .map(|choice| AutocompleteChoice { name: choice.name, value: choice.value })
  .collect()
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

#[napi]
pub fn find_game_keys(text: String, games: Vec<GameCandidate>, max_input: u32) -> FuzzyMatchResult {
  let result = logic::find_game_keys(&text, &to_game_data(games), max_input as usize);
  FuzzyMatchResult { game_key: result.game_key, suggestion_key: result.suggestion_key }
}
