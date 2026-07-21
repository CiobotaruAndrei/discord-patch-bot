pub struct UrlIdentityReport {
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

pub struct SuffixListInfo {
  pub list_id: String,
  pub rule_count: u32,
  pub loaded: bool,
  pub available: bool,
}

pub fn url_identity_available() -> bool {
  cfg!(feature = "url-identity")
}

#[cfg(feature = "url-identity")]
mod engine {
  use super::*;
  use publicsuffix::{List, Psl};
  use std::sync::RwLock;
  use unicode_security::mixed_script::AugmentedScriptSet;
  use unicode_security::{skeleton, MixedScript, RestrictionLevel, RestrictionLevelDetection, UNICODE_VERSION};

  struct LoadedList {
    list: List,
    list_id: String,
    rule_count: u32,
  }

  static SUFFIX_LIST: RwLock<Option<LoadedList>> = RwLock::new(None);

  pub fn load_list(bytes: &[u8]) -> Result<SuffixListInfo, String> {
    let list = List::from_bytes(bytes).map_err(|error| format!("lista de sufixe publice nu e valida: {error}"))?;
    if list.is_empty() {
      return Err("lista de sufixe publice este goala".to_string());
    }
    let rule_count = bytes
      .split(|byte| *byte == b'\n')
      .filter(|line| !line.is_empty() && !line.starts_with(b"//"))
      .count() as u32;
    let list_id = crate::hashing::sha256_hex(&String::from_utf8_lossy(bytes))[..16].to_string();
    let loaded = LoadedList { list, list_id: list_id.clone(), rule_count };
    let mut guard = SUFFIX_LIST.write().map_err(|_| "starea listei de sufixe este corupta".to_string())?;
    *guard = Some(loaded);
    Ok(SuffixListInfo { list_id, rule_count, loaded: true, available: true })
  }

  pub fn list_info() -> SuffixListInfo {
    match SUFFIX_LIST.read() {
      Ok(guard) => match guard.as_ref() {
        Some(loaded) => SuffixListInfo {
          list_id: loaded.list_id.clone(),
          rule_count: loaded.rule_count,
          loaded: true,
          available: true,
        },
        None => SuffixListInfo { list_id: String::new(), rule_count: 0, loaded: false, available: true },
      },
      Err(_) => SuffixListInfo { list_id: String::new(), rule_count: 0, loaded: false, available: true },
    }
  }

  fn describe_level(level: RestrictionLevel) -> &'static str {
    match level {
      RestrictionLevel::ASCIIOnly => "doar ASCII",
      RestrictionLevel::SingleScript => "un singur alfabet",
      RestrictionLevel::HighlyRestrictive => "restrictiv",
      RestrictionLevel::ModeratelyRestrictive => "moderat restrictiv",
      RestrictionLevel::MinimallyRestrictive => "minim restrictiv",
      RestrictionLevel::Unrestricted => "nerestrictionat",
    }
  }

  fn split_suffix(host: &str) -> (String, String) {
    let guard = match SUFFIX_LIST.read() {
      Ok(guard) => guard,
      Err(_) => return (String::new(), String::new()),
    };
    let Some(loaded) = guard.as_ref() else {
      return (String::new(), String::new());
    };
    let bytes = host.as_bytes();
    let suffix = loaded.list.suffix(bytes).map(|value| String::from_utf8_lossy(value.as_bytes()).into_owned());
    let domain = loaded
      .list
      .domain(bytes)
      .map(|value| String::from_utf8_lossy(value.as_bytes()).into_owned());
    (domain.unwrap_or_default(), suffix.unwrap_or_default())
  }

  pub fn analyze(host: &str, brands: &[String]) -> UrlIdentityReport {
    let trimmed = host.trim().trim_end_matches('.').to_lowercase();
    let (unicode_host, _) = idna::domain_to_unicode(&trimmed);
    let punycode_host = idna::domain_to_ascii(&trimmed).unwrap_or_else(|_| trimmed.clone());

    let mut indicators: Vec<String> = Vec::new();
    let scripts = AugmentedScriptSet::from(unicode_host.as_str());
    let level = unicode_host.detect_restriction_level();
    let host_skeleton = skeleton(&unicode_host).collect::<String>();

    if punycode_host.contains("xn--") {
      indicators.push("domeniu scris cu caractere non-ASCII (Punycode)".to_string());
    }
    if !unicode_host.is_single_script() && !unicode_host.is_ascii() {
      indicators.push(format!("domeniul amesteca mai multe alfabete ({scripts})"));
    }
    if level > RestrictionLevel::ModeratelyRestrictive {
      indicators.push(format!("domeniul are un nivel de restrictie Unicode slab ({})", describe_level(level)));
    }

    let (registrable_domain, public_suffix) = split_suffix(&punycode_host);

    let mut brand_match = String::new();
    for brand in brands {
      let brand_lower = brand.to_lowercase();
      let brand_skeleton = skeleton(&brand_lower).collect::<String>();
      let registrable_label = registrable_domain
        .split('.')
        .next()
        .unwrap_or_default()
        .to_string();
      let label_skeleton = skeleton(&registrable_label).collect::<String>();

      if !registrable_label.is_empty() && label_skeleton == brand_skeleton && registrable_label != brand_lower {
        brand_match = brand.clone();
        indicators.push(format!(
          "domeniul arata identic cu {brand} dar nu este {brand} (caractere confuzabile)"
        ));
      }
      if host_skeleton.contains(&brand_skeleton) && !registrable_domain.starts_with(&brand_lower) && !registrable_domain.is_empty() {
        if brand_match.is_empty() {
          brand_match = brand.clone();
        }
        indicators.push(format!(
          "numele {brand} apare intr-un subdomeniu, dar domeniul inregistrat este {registrable_domain}"
        ));
      }
    }

    let mut deduped: Vec<String> = Vec::new();
    for indicator in indicators {
      if !deduped.contains(&indicator) {
        deduped.push(indicator);
      }
    }

    let info = list_info();
    UrlIdentityReport {
      host_unicode: unicode_host,
      host_punycode: punycode_host,
      registrable_domain,
      public_suffix,
      skeleton: host_skeleton,
      scripts: scripts.to_string(),
      restriction_level: describe_level(level).to_string(),
      brand_match,
      indicators: deduped,
      suffix_list_id: info.list_id,
      unicode_version: format!("{}.{}.{}", UNICODE_VERSION.0, UNICODE_VERSION.1, UNICODE_VERSION.2),
    }
  }
}

#[cfg(not(feature = "url-identity"))]
mod engine {
  use super::*;

  pub fn load_list(_bytes: &[u8]) -> Result<SuffixListInfo, String> {
    Err("analiza de identitate a domeniului nu este compilata in acest build".to_string())
  }

  pub fn list_info() -> SuffixListInfo {
    SuffixListInfo { list_id: String::new(), rule_count: 0, loaded: false, available: false }
  }

  pub fn analyze(host: &str, _brands: &[String]) -> UrlIdentityReport {
    UrlIdentityReport {
      host_unicode: host.to_string(),
      host_punycode: host.to_string(),
      registrable_domain: String::new(),
      public_suffix: String::new(),
      skeleton: String::new(),
      scripts: String::new(),
      restriction_level: String::new(),
      brand_match: String::new(),
      indicators: Vec::new(),
      suffix_list_id: String::new(),
      unicode_version: String::new(),
    }
  }
}

pub fn load_public_suffix_list(bytes: &[u8]) -> Result<SuffixListInfo, String> {
  engine::load_list(bytes)
}

pub fn public_suffix_info() -> SuffixListInfo {
  engine::list_info()
}

pub fn analyze_url_host(host: &str, brands: &[String]) -> UrlIdentityReport {
  engine::analyze(host, brands)
}

#[cfg(all(test, feature = "url-identity"))]
mod tests {
  use super::*;

  const LIST: &[u8] = b"// ===BEGIN ICANN DOMAINS===\ncom\nnet\norg\nuk\nco.uk\n// ===END ICANN DOMAINS===\n";

  fn brands() -> Vec<String> {
    vec!["discord".to_string(), "steam".to_string()]
  }

  fn load() -> SuffixListInfo {
    load_public_suffix_list(LIST).expect("lista de test se incarca")
  }

  #[test]
  fn lista_de_sufixe_se_incarca_si_isi_raporteaza_identitatea() {
    let info = load();
    assert!(info.loaded);
    assert!(info.rule_count > 0);
    assert!(!info.list_id.is_empty(), "identitatea listei intra in cheia de cache");
    assert_eq!(public_suffix_info().list_id, info.list_id);
  }

  #[test]
  fn o_lista_invalida_este_respinsa_explicit() {
    assert!(load_public_suffix_list(b"").is_err(), "o lista goala nu poate trece drept incarcata");
  }

  #[test]
  fn domeniul_inregistrat_nu_se_confunda_cu_un_subdomeniu_inselator() {
    load();
    let report = analyze_url_host("login.discord.example.com", &brands());
    assert_eq!(report.registrable_domain, "example.com");
    assert_eq!(report.public_suffix, "com");
    assert!(
      report.indicators.iter().any(|entry| entry.contains("subdomeniu")),
      "numele brandului intr-un subdomeniu e semnalat: {:?}",
      report.indicators
    );
  }

  #[test]
  fn un_domeniu_legitim_al_brandului_nu_produce_indicatori() {
    load();
    let report = analyze_url_host("cdn.discord.com", &brands());
    assert_eq!(report.registrable_domain, "discord.com");
    assert!(report.indicators.is_empty(), "propriul domeniu al brandului e curat: {:?}", report.indicators);
  }

  #[test]
  fn un_homograf_cu_caractere_chirilice_este_semnalat_si_pastreaza_ambele_forme() {
    load();
    let report = analyze_url_host("dis\u{0441}ord.com", &brands());
    assert!(report.host_punycode.contains("xn--"), "forma Punycode e pastrata: {}", report.host_punycode);
    assert_ne!(report.host_unicode, report.host_punycode, "ambele forme sunt raportate, nu doar una");
    assert!(
      report.indicators.iter().any(|entry| entry.contains("Punycode")),
      "{:?}",
      report.indicators
    );
    assert!(
      report.indicators.iter().any(|entry| entry.contains("confuzabile") || entry.contains("alfabete")),
      "amestecul de alfabete sau confuzabilitatea e semnalata: {:?}",
      report.indicators
    );
  }

  #[test]
  fn raportul_poarta_versiunile_care_intra_in_cheia_de_cache() {
    load();
    let report = analyze_url_host("example.com", &brands());
    assert!(!report.unicode_version.is_empty(), "versiunea Unicode e raportata");
    assert!(!report.suffix_list_id.is_empty(), "identitatea listei de sufixe e raportata");
  }

  #[test]
  fn un_domeniu_ascii_obisnuit_are_nivel_de_restrictie_curat_si_niciun_indicator() {
    load();
    let report = analyze_url_host("store.steampowered.com", &brands());
    assert_eq!(report.restriction_level, "doar ASCII");
    assert!(report.indicators.is_empty(), "{:?}", report.indicators);
  }
}
