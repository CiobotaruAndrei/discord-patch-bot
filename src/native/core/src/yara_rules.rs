use std::sync::{Arc, RwLock};

pub struct YaraMatch {
  pub rule: String,
  pub namespace: String,
  pub tags: Vec<String>,
  pub severity: String,
  pub description: String,
}

pub struct YaraScanReport {
  pub status: String,
  pub reason: String,
  pub ruleset_id: String,
  pub matches: Vec<YaraMatch>,
  pub truncated: bool,
}

#[derive(Debug)]
pub struct YaraRulesetInfo {
  pub ruleset_id: String,
  pub rule_count: u32,
  pub loaded: bool,
}

fn unavailable(reason: &str) -> YaraScanReport {
  YaraScanReport {
    status: "unavailable".to_string(),
    reason: reason.to_string(),
    ruleset_id: String::new(),
    matches: Vec::new(),
    truncated: false,
  }
}

#[cfg(feature = "yara")]
mod engine {
  use super::*;
  use yara::{Compiler, Rules};

  struct LoadedRuleset {
    rules: Arc<Rules>,
    ruleset_id: String,
    rule_count: u32,
  }

  static RULESET: RwLock<Option<LoadedRuleset>> = RwLock::new(None);

  fn digest(source: &str) -> String {
    let bytes = crate::hashing::sha256_hex(source);
    bytes[..16].to_string()
  }

  pub fn load_rules(source: &str) -> Result<YaraRulesetInfo, String> {
    let compiler = Compiler::new().map_err(|error| format!("compilatorul YARA nu a putut fi creat: {error}"))?;
    let compiler = compiler
      .add_rules_str(source)
      .map_err(|error| format!("regulile YARA nu sunt valide: {error}"))?;
    let rules = compiler
      .compile_rules()
      .map_err(|error| format!("regulile YARA nu au putut fi compilate: {error}"))?;
    let rule_count = rules.get_rules().len() as u32;
    let ruleset_id = digest(source);
    let loaded = LoadedRuleset { rules: Arc::new(rules), ruleset_id: ruleset_id.clone(), rule_count };
    let mut guard = RULESET.write().map_err(|_| "starea ruleset-ului YARA este corupta".to_string())?;
    *guard = Some(loaded);
    Ok(YaraRulesetInfo { ruleset_id, rule_count, loaded: true })
  }

  pub fn ruleset_info() -> YaraRulesetInfo {
    match RULESET.read() {
      Ok(guard) => match guard.as_ref() {
        Some(loaded) => YaraRulesetInfo {
          ruleset_id: loaded.ruleset_id.clone(),
          rule_count: loaded.rule_count,
          loaded: true,
        },
        None => YaraRulesetInfo { ruleset_id: String::new(), rule_count: 0, loaded: false },
      },
      Err(_) => YaraRulesetInfo { ruleset_id: String::new(), rule_count: 0, loaded: false },
    }
  }

  fn metadata_value(rule: &yara::Rule, key: &str) -> String {
    rule
      .metadatas
      .iter()
      .find(|entry| entry.identifier == key)
      .map(|entry| match &entry.value {
        yara::MetadataValue::String(value) => value.to_string(),
        yara::MetadataValue::Integer(value) => value.to_string(),
        yara::MetadataValue::Boolean(value) => value.to_string(),
      })
      .unwrap_or_default()
  }

  pub fn scan(bytes: &[u8], timeout_ms: u32, max_matches: usize) -> YaraScanReport {
    let snapshot = match RULESET.read() {
      Ok(guard) => guard.as_ref().map(|loaded| (Arc::clone(&loaded.rules), loaded.ruleset_id.clone())),
      Err(_) => None,
    };
    let Some((rules, ruleset_id)) = snapshot else {
      return unavailable("niciun ruleset YARA incarcat");
    };
    let timeout_seconds = timeout_ms.div_ceil(1000).max(1).min(i32::MAX as u32) as i32;
    let found = match rules.scan_mem(bytes, timeout_seconds) {
      Ok(found) => found,
      Err(error) => {
        return YaraScanReport {
          status: "error".to_string(),
          reason: format!("scanarea YARA a esuat: {error}"),
          ruleset_id,
          matches: Vec::new(),
          truncated: false,
        };
      }
    };
    let truncated = found.len() > max_matches;
    let matches: Vec<YaraMatch> = found
      .iter()
      .take(max_matches)
      .map(|rule| YaraMatch {
        rule: rule.identifier.to_string(),
        namespace: rule.namespace.to_string(),
        tags: rule.tags.iter().map(|tag| tag.to_string()).collect(),
        severity: metadata_value(rule, "severity"),
        description: metadata_value(rule, "description"),
      })
      .collect();
    let reason = if matches.is_empty() {
      "niciun tipar YARA nu s-a potrivit".to_string()
    } else {
      format!("{} tipare YARA s-au potrivit", matches.len())
    };
    YaraScanReport { status: "scanned".to_string(), reason, ruleset_id, matches, truncated }
  }
}

#[cfg(not(feature = "yara"))]
mod engine {
  use super::*;

  const DISABLED: &str = "motorul YARA nu este compilat in acest build (feature `yara` dezactivat)";

  pub fn load_rules(_source: &str) -> Result<YaraRulesetInfo, String> {
    Err(DISABLED.to_string())
  }

  pub fn ruleset_info() -> YaraRulesetInfo {
    YaraRulesetInfo { ruleset_id: String::new(), rule_count: 0, loaded: false }
  }

  pub fn scan(_bytes: &[u8], _timeout_ms: u32, _max_matches: usize) -> YaraScanReport {
    unavailable(DISABLED)
  }
}

pub fn load_yara_rules(source: &str) -> Result<YaraRulesetInfo, String> {
  engine::load_rules(source)
}

pub fn yara_ruleset_info() -> YaraRulesetInfo {
  engine::ruleset_info()
}

pub fn scan_yara(bytes: &[u8], timeout_ms: u32, max_matches: u32) -> YaraScanReport {
  engine::scan(bytes, timeout_ms, max_matches.max(1) as usize)
}

pub fn yara_available() -> bool {
  cfg!(feature = "yara")
}

#[cfg(all(test, feature = "yara"))]
mod tests {
  use super::*;

  const RULES: &str = r#"
rule executabil_suspect : packer {
  meta:
    severity = "high"
    description = "sablon de packer cunoscut"
  strings:
    $a = "UPX0"
  condition:
    $a
}

rule script_ofuscat {
  meta:
    severity = "medium"
    description = "script cu evaluare dinamica"
  strings:
    $a = "eval(base64_decode("
  condition:
    $a
}
"#;

  fn load() -> YaraRulesetInfo {
    load_yara_rules(RULES).expect("regulile de test se compileaza")
  }

  #[test]
  fn rules_compile_and_report_their_identity() {
    let info = load();
    assert!(info.loaded);
    assert_eq!(info.rule_count, 2);
    assert!(!info.ruleset_id.is_empty(), "ruleset-ul are un identificator stabil pentru audit si cache key");
    assert_eq!(yara_ruleset_info().ruleset_id, info.ruleset_id);
  }

  #[test]
  fn a_matching_payload_reports_rule_tags_and_metadata() {
    load();
    let report = scan_yara(b"stub cu UPX0 inauntru", 100, 16);
    assert_eq!(report.status, "scanned");
    assert_eq!(report.matches.len(), 1);
    assert_eq!(report.matches[0].rule, "executabil_suspect");
    assert_eq!(report.matches[0].tags, vec!["packer".to_string()]);
    assert_eq!(report.matches[0].severity, "high");
    assert_eq!(report.matches[0].description, "sablon de packer cunoscut");
  }

  #[test]
  fn a_clean_payload_produces_no_matches_but_still_reports_scanned() {
    load();
    let report = scan_yara(b"continut complet inofensiv", 100, 16);
    assert_eq!(report.status, "scanned");
    assert!(report.matches.is_empty());
    assert_eq!(report.reason, "niciun tipar YARA nu s-a potrivit");
  }

  #[test]
  fn the_match_cap_truncates_instead_of_growing_without_bound() {
    load();
    let report = scan_yara(b"UPX0 si eval(base64_decode( impreuna", 100, 1);
    assert_eq!(report.matches.len(), 1);
    assert!(report.truncated, "restul potrivirilor sunt raportate ca trunchiate, nu pierdute tacit");
  }

  #[test]
  fn invalid_rules_are_rejected_without_replacing_the_loaded_ruleset() {
    let before = load();
    let error = load_yara_rules("rule stricat { condition: ").expect_err("regulile invalide sunt respinse");
    assert!(error.contains("YARA"));
    assert_eq!(yara_ruleset_info().ruleset_id, before.ruleset_id, "ruleset-ul valid anterior ramane activ");
  }
}
