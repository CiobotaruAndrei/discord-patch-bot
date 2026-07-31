use discord_patch_bot_logic as logic;
use napi_derive::napi;

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
