pub struct MsiCustomAction {
  pub action: String,
  pub action_type: i32,
  pub source: String,
  pub target: String,
}

pub struct MsiDatabaseReport {
  pub custom_actions: Vec<MsiCustomAction>,
  pub tables: Vec<String>,
  pub indicators: Vec<String>,
}

pub enum MsiDatabaseOutcome {
  Unavailable(String),
  NotMsi,
  Failed(String),
  Read(MsiDatabaseReport),
}

pub struct MsiLimits {
  pub max_rows: usize,
  pub max_text_bytes: usize,
  pub max_tables: usize,
}

impl Default for MsiLimits {
  fn default() -> Self {
    Self { max_rows: 256, max_text_bytes: 512, max_tables: 64 }
  }
}

pub fn msi_database_available() -> bool {
  cfg!(feature = "msi")
}

const CUSTOM_ACTION_BASE_MASK: i32 = 0x3f;
const CUSTOM_ACTION_IN_SCRIPT: i32 = 0x400;
const CUSTOM_ACTION_NO_IMPERSONATE: i32 = 0x800;

fn base_type_meaning(action_type: i32) -> Option<&'static str> {
  match action_type & CUSTOM_ACTION_BASE_MASK {
    1 => Some("DLL stocata in tabelul Binary"),
    2 => Some("EXE stocat in tabelul Binary"),
    5 => Some("cod JScript"),
    6 => Some("cod VBScript"),
    17 => Some("DLL instalata cu pachetul"),
    18 => Some("EXE instalat cu pachetul"),
    21 => Some("JScript instalat cu pachetul"),
    22 => Some("VBScript instalat cu pachetul"),
    34 => Some("EXE dintr-un director existent"),
    37 => Some("JScript dintr-o proprietate"),
    38 => Some("VBScript dintr-o proprietate"),
    50 => Some("EXE dintr-o proprietate"),
    53 => Some("JScript dintr-o proprietate de instalare"),
    54 => Some("VBScript dintr-o proprietate de instalare"),
    _ => None,
  }
}

fn truncate_text(value: &str, max_bytes: usize) -> String {
  let mut out = String::new();
  for character in value.chars() {
    if out.len() + character.len_utf8() > max_bytes {
      out.push('…');
      break;
    }
    out.push(character);
  }
  out
}

const RISKY_TARGET_MARKERS: &[(&str, &str)] = &[
  ("powershell", "actiunea lanseaza PowerShell"),
  ("-enc", "actiunea lanseaza o comanda codificata base64"),
  ("-encodedcommand", "actiunea lanseaza o comanda codificata base64"),
  ("cmd.exe", "actiunea lanseaza interpretorul de comenzi"),
  ("wscript", "actiunea lanseaza Windows Script Host"),
  ("cscript", "actiunea lanseaza Windows Script Host"),
  ("rundll32", "actiunea lanseaza rundll32"),
  ("mshta", "actiunea lanseaza mshta"),
  ("regsvr32", "actiunea inregistreaza o componenta prin regsvr32"),
  ("bitsadmin", "actiunea foloseste bitsadmin pentru transfer"),
  ("certutil", "actiunea foloseste certutil, folosit frecvent pentru descarcare sau decodare"),
  ("http://", "actiunea contine un URL"),
  ("https://", "actiunea contine un URL"),
  ("invoke-webrequest", "actiunea descarca prin Invoke-WebRequest"),
  ("downloadstring", "actiunea descarca prin DownloadString"),
  ("frombase64string", "actiunea decodeaza base64 in memorie"),
];

fn describe_custom_action(entry: &MsiCustomAction) -> Vec<String> {
  let mut indicators = Vec::new();
  let haystack = format!("{} {}", entry.source, entry.target).to_lowercase();
  let mut seen: Vec<&str> = Vec::new();
  for (needle, message) in RISKY_TARGET_MARKERS {
    if haystack.contains(needle) && !seen.contains(message) {
      seen.push(message);
      indicators.push(format!("{} ({}: {})", message, entry.action, truncate_text(&entry.target, 160)));
    }
  }
  if let Some(meaning) = base_type_meaning(entry.action_type) {
    if entry.action_type & CUSTOM_ACTION_BASE_MASK != 1 && entry.action_type & CUSTOM_ACTION_BASE_MASK != 17 {
      indicators.push(format!("actiune personalizata care executa {} ({})", meaning, entry.action));
    }
  }
  if entry.action_type & CUSTOM_ACTION_NO_IMPERSONATE != 0 && entry.action_type & CUSTOM_ACTION_IN_SCRIPT != 0 {
    indicators.push(format!("actiunea {} ruleaza cu privilegii ridicate, fara impersonarea utilizatorului", entry.action));
  }
  indicators
}

#[cfg(feature = "msi")]
pub fn read_msi_database(bytes: &[u8], limits: &MsiLimits) -> MsiDatabaseOutcome {
  use std::io::Cursor;

  if !super::inspection::is_compound_file_binary(bytes) {
    return MsiDatabaseOutcome::NotMsi;
  }

  let mut package = match msi::Package::open(Cursor::new(bytes)) {
    Ok(package) => package,
    Err(error) => return MsiDatabaseOutcome::Failed(format!("baza MSI nu a putut fi deschisa: {}", error)),
  };

  let tables: Vec<String> = package.tables().map(|table| table.name().to_string()).take(limits.max_tables).collect();
  if !tables.iter().any(|name| name == "CustomAction") {
    return MsiDatabaseOutcome::Read(MsiDatabaseReport {
      custom_actions: Vec::new(),
      tables,
      indicators: Vec::new(),
    });
  }

  let query = msi::Select::table("CustomAction");
  let rows = match package.select_rows(query) {
    Ok(rows) => rows,
    Err(error) => return MsiDatabaseOutcome::Failed(format!("tabelul CustomAction nu a putut fi citit: {}", error)),
  };

  let mut custom_actions = Vec::new();
  for row in rows.take(limits.max_rows) {
    if row.len() < 4 {
      continue;
    }
    let text = |value: &msi::Value| match value {
      msi::Value::Str(inner) => truncate_text(inner, limits.max_text_bytes),
      msi::Value::Int(inner) => inner.to_string(),
      _ => String::new(),
    };
    let action_type = match &row[1] {
      msi::Value::Int(inner) => *inner,
      _ => 0,
    };
    custom_actions.push(MsiCustomAction {
      action: text(&row[0]),
      action_type,
      source: text(&row[2]),
      target: text(&row[3]),
    });
  }

  let mut indicators = Vec::new();
  for entry in &custom_actions {
    for indicator in describe_custom_action(entry) {
      if !indicators.contains(&indicator) {
        indicators.push(indicator);
      }
    }
  }

  MsiDatabaseOutcome::Read(MsiDatabaseReport { custom_actions, tables, indicators })
}

#[cfg(not(feature = "msi"))]
pub fn read_msi_database(_bytes: &[u8], _limits: &MsiLimits) -> MsiDatabaseOutcome {
  MsiDatabaseOutcome::Unavailable("cititorul de baze MSI nu este compilat in aceasta versiune".to_string())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn action(action: &str, action_type: i32, source: &str, target: &str) -> MsiCustomAction {
    MsiCustomAction {
      action: action.to_string(),
      action_type,
      source: source.to_string(),
      target: target.to_string(),
    }
  }

  #[test]
  fn tipul_actiunii_este_tradus_in_ce_executa_efectiv() {
    assert_eq!(base_type_meaning(2), Some("EXE stocat in tabelul Binary"));
    assert_eq!(base_type_meaning(6), Some("cod VBScript"));
    assert_eq!(base_type_meaning(3106 & CUSTOM_ACTION_BASE_MASK), Some("EXE dintr-un director existent"));
    assert_eq!(base_type_meaning(0x3f), None, "un tip necunoscut nu e inventat");
  }

  #[test]
  fn comanda_reala_a_actiunii_produce_indicatori_cu_numele_actiunii() {
    let entry = action("RunPS", 3106, "SystemFolder", "powershell.exe -enc SQBFAFgAKABOAGUAdwA=");
    let indicators = describe_custom_action(&entry);
    assert!(indicators.iter().any(|value| value.contains("PowerShell")), "{:?}", indicators);
    assert!(indicators.iter().any(|value| value.contains("codificata base64")), "{:?}", indicators);
    assert!(indicators.iter().all(|value| value.contains("RunPS") || value.contains("EXE")), "indicatorii spun CARE actiune: {:?}", indicators);
  }

  #[test]
  fn o_actiune_obisnuita_nu_produce_indicatori_de_lansare() {
    let entry = action("InstallLegit", 1, "BinaryData", "setup_helper");
    let indicators = describe_custom_action(&entry);
    assert!(
      indicators.is_empty(),
      "o DLL din tabelul Binary, fara interpretoare in tinta, nu e semnalata: {:?}",
      indicators
    );
  }

  #[test]
  fn privilegiile_ridicate_fara_impersonare_sunt_semnalate_separat() {
    let elevated = action("Elevated", 1 | CUSTOM_ACTION_IN_SCRIPT | CUSTOM_ACTION_NO_IMPERSONATE, "Bin", "helper");
    assert!(
      describe_custom_action(&elevated).iter().any(|value| value.contains("privilegii ridicate")),
      "combinatia in-script + no-impersonate inseamna executie ca SYSTEM"
    );
    let plain = action("Plain", 1, "Bin", "helper");
    assert!(!describe_custom_action(&plain).iter().any(|value| value.contains("privilegii ridicate")));
  }

  #[test]
  fn textele_lungi_sunt_plafonate_ca_sa_nu_intre_intregi_in_raport() {
    let long = "A".repeat(1000);
    let truncated = truncate_text(&long, 64);
    assert!(truncated.len() <= 67, "plafonul e respectat: {}", truncated.len());
    assert!(truncated.ends_with('…'), "trunchierea e vizibila in raport");
  }

  #[cfg(feature = "msi")]
  fn build_msi_with_custom_actions() -> Vec<u8> {
    use msi::{Column, Insert, Value};
    let cursor = std::io::Cursor::new(Vec::new());
    let mut package = msi::Package::create(msi::PackageType::Installer, cursor).expect("pachetul MSI se creeaza in memorie");
    package
      .create_table(
        "CustomAction",
        vec![
          Column::build("Action").primary_key().id_string(72),
          Column::build("Type").int16(),
          Column::build("Source").nullable().id_string(72),
          Column::build("Target").nullable().text_string(255),
        ],
      )
      .expect("tabelul CustomAction se creeaza");
    package
      .insert_rows(
        Insert::into("CustomAction")
          .row(vec![
            Value::Str("RunPS".to_string()),
            Value::Int(3106),
            Value::Str("SystemFolder".to_string()),
            Value::Str("powershell.exe -enc SQBFAFgAKABOAGUAdwAtAE8AYgBqAGUAYwB0AA==".to_string()),
          ])
          .row(vec![
            Value::Str("InstallLegit".to_string()),
            Value::Int(1),
            Value::Str("BinaryData".to_string()),
            Value::Str("setup_helper".to_string()),
          ]),
      )
      .expect("randurile se insereaza");
    package.into_inner().expect("pachetul se finalizeaza").into_inner()
  }

  #[cfg(feature = "msi")]
  #[test]
  fn randurile_reale_ale_tabelului_custom_action_sunt_citite_din_memorie() {
    let bytes = build_msi_with_custom_actions();
    let report = match read_msi_database(&bytes, &MsiLimits::default()) {
      MsiDatabaseOutcome::Read(report) => report,
      MsiDatabaseOutcome::Failed(detail) => panic!("citirea a esuat: {}", detail),
      _ => panic!("un MSI construit corect trebuie citit"),
    };

    assert_eq!(report.custom_actions.len(), 2, "ambele randuri sunt citite");
    let malicious = report.custom_actions.iter().find(|entry| entry.action == "RunPS").expect("actiunea RunPS exista");
    assert_eq!(malicious.action_type, 3106, "tipul numeric vine din rand, nu din ghicit");
    assert!(malicious.target.contains("powershell.exe -enc"), "comanda completa e disponibila: {}", malicious.target);

    let benign = report.custom_actions.iter().find(|entry| entry.action == "InstallLegit").expect("actiunea legitima exista");
    assert_eq!(benign.action_type, 1);

    assert!(
      report.indicators.iter().any(|value| value.contains("PowerShell") && value.contains("RunPS")),
      "indicatorul spune exact CARE actiune lanseaza PowerShell, nu doar ca fisierul contine cuvantul: {:?}",
      report.indicators
    );
    assert!(
      !report.indicators.iter().any(|value| value.contains("InstallLegit")),
      "actiunea legitima nu e semnalata: {:?}",
      report.indicators
    );
  }

  #[test]
  fn continutul_care_nu_e_compound_file_nu_e_tratat_ca_msi() {
    assert!(matches!(read_msi_database(b"%PDF-1.7 nu e MSI", &MsiLimits::default()), MsiDatabaseOutcome::NotMsi));
  }
}
