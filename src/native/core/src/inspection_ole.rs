use crate::inspection_budgets::*;
use crate::mspack_container::{decode_ms_container, ContainerDecodeLimits, ContainerOutcome};
use crate::chm_listing::{list_chm_entries, ChmListingLimits};
use crate::inspection_verdict::*;
use crate::inspection_bytes::*;
use crate::inspection_indicators::*;

pub(crate) fn has_dde_field(haystack: &[u8]) -> bool {
  let needle = b"DDE";
  let mut offset = 0;
  while offset + needle.len() < haystack.len() {
    match find(&haystack[offset..], needle) {
      None => return false,
      Some(index) => {
        let start = offset + index;
        let end = start + needle.len();
        let leading_ok = start == 0 || !is_word_byte(haystack[start - 1]);
        if leading_ok && end < haystack.len() && haystack[end].is_ascii_whitespace() {
          return true;
        }
        offset = start + 1;
      }
    }
  }
  false
}

pub(crate) fn has_external_target_mode(haystack: &[u8]) -> bool {
  let needle = b"targetmode";
  let mut offset = 0;
  while offset + needle.len() <= haystack.len() {
    let window = &haystack[offset..];
    let position = window
      .windows(needle.len())
      .position(|candidate| candidate.iter().zip(needle.iter()).all(|(a, b)| a.to_ascii_lowercase() == *b));
    let Some(index) = position else { return false };
    let mut cursor = offset + index + needle.len();
    while cursor < haystack.len() && haystack[cursor].is_ascii_whitespace() {
      cursor += 1;
    }
    if cursor < haystack.len() && haystack[cursor] == b'=' {
      cursor += 1;
      while cursor < haystack.len() && haystack[cursor].is_ascii_whitespace() {
        cursor += 1;
      }
      if cursor < haystack.len() && (haystack[cursor] == b'"' || haystack[cursor] == b'\'') {
        let quote = haystack[cursor];
        cursor += 1;
        let external = b"external";
        if cursor + external.len() < haystack.len()
          && haystack[cursor..cursor + external.len()].iter().zip(external.iter()).all(|(a, b)| a.to_ascii_lowercase() == *b)
          && haystack[cursor + external.len()] == quote
        {
          return true;
        }
      }
    }
    offset = offset + index + 1;
  }
  false
}

pub(crate) const MSI_ALPHABET: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz._";

pub fn decode_msi_stream_name(name: &str) -> String {
  let mut out = String::new();
  for unit in name.encode_utf16() {
    if (0x3800..0x4800).contains(&unit) {
      let value = unit - 0x3800;
      out.push(MSI_ALPHABET[(value & 0x3f) as usize] as char);
      out.push(MSI_ALPHABET[((value >> 6) & 0x3f) as usize] as char);
    } else if (0x4800..0x4840).contains(&unit) {
      out.push(MSI_ALPHABET[(unit - 0x4800) as usize] as char);
    } else if unit == 0x4840 {
      out.push('!');
    } else {
      out.push(char::from_u32(u32::from(unit)).unwrap_or('?'));
    }
  }
  out
}

pub(crate) const MSI_TABLES: &[(&str, &str)] = &[
  ("CustomAction", "instalatorul MSI declara actiuni personalizate, care pot executa cod la instalare"),
  ("Binary", "instalatorul MSI poarta payload-uri binare incorporate"),
  ("ServiceInstall", "instalatorul MSI inregistreaza un serviciu de sistem"),
  ("ServiceControl", "instalatorul MSI porneste sau opreste servicii"),
  ("Registry", "instalatorul MSI scrie in registrul Windows"),
  ("LaunchCondition", "instalatorul MSI are conditii de lansare"),
  ("InstallExecuteSequence", "instalatorul MSI are o secventa de executie proprie"),
];

const MSI_SCRIPT_MARKERS: &[(&[u8], &str)] = &[
  (b"powershell", "referinta la PowerShell in instalatorul MSI"),
  (b"cmd.exe", "referinta la interpretorul de comenzi in instalatorul MSI"),
  (b"wscript", "referinta la Windows Script Host in instalatorul MSI"),
  (b"cscript", "referinta la Windows Script Host in instalatorul MSI"),
  (b"rundll32", "referinta la rundll32 in instalatorul MSI"),
  (b"mshta", "referinta la mshta in instalatorul MSI"),
  (b"regsvr32", "referinta la regsvr32 in instalatorul MSI"),
];

pub(crate) fn msi_indicators(bytes: &[u8], decoded_names: &[String]) -> Vec<String> {
  if !decoded_names.iter().any(|name| name.starts_with('!')) {
    return Vec::new();
  }
  let mut indicators: Vec<String> = vec!["instalator MSI (baza de date interna, parser structural)".to_string()];
  for name in decoded_names {
    let table = name.trim_start_matches('!');
    for (needle, message) in MSI_TABLES {
      if table == *needle {
        indicators.push((*message).to_string());
      }
    }
  }
  let window = scan_window(bytes);
  let lower: Vec<u8> = window.iter().map(|byte| byte.to_ascii_lowercase()).collect();
  for (needle, message) in MSI_SCRIPT_MARKERS {
    if contains(&lower, needle) {
      indicators.push((*message).to_string());
    }
  }
  indicators
}

pub fn inspect_compound_file_binary(bytes: &[u8]) -> Vec<String> {
  if !is_compound_file_binary(bytes) {
    return Vec::new();
  }
  let mut indicators: Vec<String> = Vec::new();
  let mut decoded_names: Vec<String> = Vec::new();
  let Some(sector_shift) = read_u16_le(bytes, 30) else { return indicators };
  if sector_shift != 9 && sector_shift != 12 {
    return indicators;
  }
  let sector_size = 1usize << sector_shift;
  let sector_offset = |sector: u32| -> usize { 512 + sector as usize * sector_size };
  let entries_per_fat_sector = sector_size / 4;
  let mut fat: Vec<u32> = Vec::new();
  let declared_fat_sectors = read_u32_le(bytes, 44).unwrap_or(0) as usize;
  let fat_sector_count = declared_fat_sectors.min(109).min(CFB_MAX_FAT_SECTORS);
  for i in 0..fat_sector_count {
    let Some(fat_sector) = read_u32_le(bytes, 76 + i * 4) else { break };
    if fat_sector == CFB_FREE_SECT || fat_sector == CFB_END_OF_CHAIN {
      break;
    }
    let base = sector_offset(fat_sector);
    if base + sector_size > bytes.len() {
      break;
    }
    for j in 0..entries_per_fat_sector {
      if let Some(entry) = read_u32_le(bytes, base + j * 4) {
        fat.push(entry);
      }
    }
  }
  let entries_per_dir_sector = sector_size / 128;
  let mut visited: Vec<u32> = Vec::new();
  let mut sector = read_u32_le(bytes, 48).unwrap_or(CFB_END_OF_CHAIN);
  let mut inspected_entries = 0usize;
  while sector != CFB_END_OF_CHAIN
    && sector != CFB_FREE_SECT
    && !visited.contains(&sector)
    && inspected_entries < CFB_MAX_DIR_ENTRIES
  {
    visited.push(sector);
    let base = sector_offset(sector);
    if base + sector_size > bytes.len() {
      break;
    }
    for entry_index in 0..entries_per_dir_sector {
      if inspected_entries >= CFB_MAX_DIR_ENTRIES {
        break;
      }
      let entry_offset = base + entry_index * 128;
      inspected_entries += 1;
      if entry_offset + 67 > bytes.len() {
        break;
      }
      let object_type = bytes[entry_offset + 66];
      if object_type != 1 && object_type != 2 && object_type != 5 {
        continue;
      }
      let Some(name_length) = read_u16_le(bytes, entry_offset + 64) else { continue };
      if !(4..=64).contains(&name_length) {
        continue;
      }
      let name_end = entry_offset + name_length as usize - 2;
      if name_end > bytes.len() {
        continue;
      }
      let raw = &bytes[entry_offset..name_end];
      let units: Vec<u16> = raw.chunks_exact(2).map(|pair| u16::from_le_bytes([pair[0], pair[1]])).collect();
      let name = String::from_utf16_lossy(&units);
      let normalized = name.to_lowercase();
      if normalized == "macros" || normalized == "vba" || normalized == "_vba_project" || normalized == "vbaproject" {
        indicators.push("macro VBA in document OLE (parser structural CFB)".to_string());
      }
      if normalized == "ole10native" || normalized == "objectpool" || normalized == "package" {
        indicators.push("obiect OLE incorporat in document OLE (parser structural CFB)".to_string());
      }
      decoded_names.push(decode_msi_stream_name(&name));
    }
    sector = if (sector as usize) < fat.len() { fat[sector as usize] } else { CFB_END_OF_CHAIN };
  }
  indicators.extend(msi_indicators(bytes, &decoded_names));
  indicators.extend(msi_database_indicators(bytes));
  dedupe(indicators)
}

pub(crate) fn msi_database_indicators(bytes: &[u8]) -> Vec<String> {
  match crate::read_msi_database(bytes, &crate::MsiLimits::default()) {
    crate::MsiDatabaseOutcome::Read(report) => report.indicators,
    _ => Vec::new(),
  }
}

pub(crate) fn has_executable_extension(normalized: &str) -> bool {
  const EXTENSIONS: &[&str] = &[".exe", ".dll", ".scr", ".com", ".bat", ".cmd", ".ps1", ".sh", ".js", ".jar"];
  EXTENSIONS.iter().any(|extension| normalized.ends_with(extension))
}

pub(crate) fn is_ole_object_bin(normalized: &str) -> bool {
  if !normalized.ends_with(".bin") {
    return false;
  }
  let segment = normalized.rsplit('/').next().unwrap_or(normalized);
  let Some(rest) = segment.strip_prefix("oleobject") else { return false };
  let Some(digits) = rest.strip_suffix(".bin") else { return false };
  digits.chars().all(|character| character.is_ascii_digit())
}

pub(crate) fn ms_container_indicators(bytes: &[u8]) -> Vec<String> {
  let ContainerOutcome::Decoded(report) = decode_ms_container(bytes, &ContainerDecodeLimits::default()) else {
    return Vec::new();
  };
  if report.entries.is_empty() {
    return Vec::new();
  }
  let mut indicators = vec![format!(
    "{} decomprimat, {} intrari citite din continut, nu doar din structura",
    report.format,
    report.entries.len()
  )];
  for entry in &report.entries {
    indicators.extend(name_indicators(&entry.name));
    indicators.extend(text_link_indicators(&entry.bytes));
    if entry.truncated {
      indicators.push(format!("intrarea {} depaseste plafonul de decompresie, citita partial", entry.name));
    }
  }
  if report.truncated {
    indicators.push(format!("{} citit partial, plafonul de decompresie a fost atins", report.format));
  }
  dedupe(indicators)
}

pub(crate) fn chm_indicators(bytes: &[u8]) -> Vec<String> {
  let entries = list_chm_entries(bytes, &ChmListingLimits::default());
  if entries.is_empty() {
    return Vec::new();
  }
  let mut indicators = vec![format!(
    "ajutor compilat CHM cu {} intrari listate din structura, fara decompresie",
    entries.len()
  )];
  for entry in &entries {
    indicators.extend(name_indicators(entry));
  }
  dedupe(indicators)
}

pub(crate) fn is_remote_target(target: &[u8]) -> bool {
  starts_with_ci(target, b"http://")
    || starts_with_ci(target, b"https://")
    || starts_with_ci(target, b"ftp://")
    || starts_with_ci(target, b"file://")
    || starts_with_ci(target, b"\\\\")
}

pub(crate) fn ooxml_relationship_indicators(bytes: &[u8]) -> Vec<String> {
  let mut indicators: Vec<String> = Vec::new();
  let mut offset = 0usize;
  let mut parsed = 0usize;
  while parsed < 512 {
    let Some(relative) = find(&bytes[offset..], b"<Relationship") else { break };
    let start = offset + relative;
    let Some(length) = find(&bytes[start..], b">") else { break };
    let element = &bytes[start..start + length];
    parsed += 1;
    offset = start + length + 1;
    let relation_type = xml_attribute(element, b"type").unwrap_or(b"");
    let target = xml_attribute(element, b"target").unwrap_or(b"");
    let target_mode = xml_attribute(element, b"targetmode").unwrap_or(b"");
    let external = target_mode.eq_ignore_ascii_case(b"external");
    if ends_with_ci(relation_type, b"/vbaproject") {
      indicators.push("macro sau script Office intern".to_string());
    }
    if ends_with_ci(relation_type, b"/oleobject") || ends_with_ci(relation_type, b"/package") {
      indicators.push("obiect OLE incorporat in document Office".to_string());
    }
    if external && (ends_with_ci(relation_type, b"/attachedtemplate") || ends_with_ci(relation_type, b"/frame")) {
      indicators.push("sablon sau cadru Office incarcat dintr-o sursa externa (relatie OOXML)".to_string());
    }
    if external || is_remote_target(target) {
      indicators.push("referinta externa in document Office".to_string());
    }
  }
  dedupe(indicators)
}

pub(crate) fn is_compound_file_binary(bytes: &[u8]) -> bool {
  bytes.len() >= 512 && bytes[0..8] == [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
}

#[cfg(test)]
mod tests {
  use super::*;


  fn compound_file(entries: &[(&str, u8)]) -> Vec<u8> {
    let mut buffer = vec![0u8; 512 + 512 * 2];
    buffer[0..4].copy_from_slice(&0xd0cf_11e0u32.to_be_bytes());
    buffer[4..8].copy_from_slice(&0xa1b1_1ae1u32.to_be_bytes());
    buffer[30..32].copy_from_slice(&9u16.to_le_bytes());
    buffer[32..34].copy_from_slice(&6u16.to_le_bytes());
    buffer[44..48].copy_from_slice(&1u32.to_le_bytes());
    buffer[48..52].copy_from_slice(&1u32.to_le_bytes());
    buffer[76..80].copy_from_slice(&0u32.to_le_bytes());
    for i in 1..109 {
      buffer[76 + i * 4..80 + i * 4].copy_from_slice(&0xffff_ffffu32.to_le_bytes());
    }
    for i in 0..128 {
      buffer[512 + i * 4..516 + i * 4].copy_from_slice(&0xffff_ffffu32.to_le_bytes());
    }
    buffer[512..516].copy_from_slice(&0xffff_fffdu32.to_le_bytes());
    buffer[516..520].copy_from_slice(&0xffff_fffeu32.to_le_bytes());
    for (index, (name, object_type)) in entries.iter().take(4).enumerate() {
      let offset = 1024 + index * 128;
      let encoded: Vec<u8> = name.encode_utf16().flat_map(|unit| unit.to_le_bytes()).collect();
      buffer[offset..offset + encoded.len()].copy_from_slice(&encoded);
      buffer[offset + 64..offset + 66].copy_from_slice(&((encoded.len() + 2) as u16).to_le_bytes());
      buffer[offset + 66] = *object_type;
    }
    buffer
  }

  #[test]
  fn numele_de_stream_msi_sunt_decodate_din_codificarea_proprie() {
    let mut mangled = String::new();
    mangled.push(char::from_u32(0x4840).unwrap());
    for pair in ["Cu", "st", "om", "Ac", "ti", "on"] {
      let bytes = pair.as_bytes();
      let first = MSI_ALPHABET.iter().position(|value| *value == bytes[0]).unwrap() as u32;
      let second = MSI_ALPHABET.iter().position(|value| *value == bytes[1]).unwrap() as u32;
      mangled.push(char::from_u32(0x3800 + first + (second << 6)).unwrap());
    }
    assert_eq!(decode_msi_stream_name(&mangled), "!CustomAction");
  }

  #[test]
  fn un_nume_obisnuit_nu_este_alterat_de_decodarea_msi() {
    assert_eq!(decode_msi_stream_name("WordDocument"), "WordDocument");
    assert_eq!(decode_msi_stream_name(""), "");
  }

  #[test]
  fn un_document_ole_care_nu_e_msi_nu_primeste_indicatori_de_instalator() {
    let names = vec!["WordDocument".to_string(), "Macros".to_string()];
    assert!(msi_indicators(b"continut oarecare", &names).is_empty());
  }

  #[test]
  fn tabelele_periculoase_ale_unui_msi_produc_indicatori_distincti() {
    let names = vec![
      "!CustomAction".to_string(),
      "!Binary".to_string(),
      "!ServiceInstall".to_string(),
      "!Registry".to_string(),
    ];
    let payload = b"CustomAction care cheama powershell.exe -enc ...";
    let indicators = msi_indicators(payload, &names);

    assert!(indicators.iter().any(|entry| entry.contains("instalator MSI")));
    assert!(indicators.iter().any(|entry| entry.contains("actiuni personalizate")));
    assert!(indicators.iter().any(|entry| entry.contains("payload-uri binare")));
    assert!(indicators.iter().any(|entry| entry.contains("serviciu de sistem")));
    assert!(indicators.iter().any(|entry| entry.contains("registrul Windows")));
    assert!(indicators.iter().any(|entry| entry.contains("PowerShell")));
  }

  #[test]
  fn un_msi_fara_markeri_de_script_nu_primeste_indicatorul_de_script() {
    let names = vec!["!Property".to_string(), "!File".to_string()];
    let indicators = msi_indicators(b"doar fisiere obisnuite", &names);
    assert!(indicators.iter().any(|entry| entry.contains("instalator MSI")));
    assert!(!indicators.iter().any(|entry| entry.contains("PowerShell")), "{indicators:?}");
    assert!(!indicators.iter().any(|entry| entry.contains("interpretorul de comenzi")));
  }

  #[test]
  fn compound_file_parser_detects_macros_and_embedded_objects() {
    let with_macros = compound_file(&[("Root Entry", 5), ("Macros", 1), ("WordDocument", 2)]);
    assert_eq!(inspect_compound_file_binary(&with_macros), vec!["macro VBA in document OLE (parser structural CFB)".to_string()]);

    let with_object = compound_file(&[("Root Entry", 5), ("ObjectPool", 1)]);
    assert_eq!(inspect_compound_file_binary(&with_object), vec!["obiect OLE incorporat in document OLE (parser structural CFB)".to_string()]);

    let clean = compound_file(&[("Root Entry", 5), ("WordDocument", 2), ("1Table", 2)]);
    assert!(inspect_compound_file_binary(&clean).is_empty());
    assert!(inspect_compound_file_binary(b"nu e CFB").is_empty());
  }

  #[test]
  fn ooxml_relationship_types_are_classified_from_the_graph_not_from_the_entry_name() {
    let external_template = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="http://evil.test/p.dotm" TargetMode="External"/></Relationships>"#;
    let indicators = ooxml_relationship_indicators(external_template);
    assert!(indicators.contains(&"sablon sau cadru Office incarcat dintr-o sursa externa (relatie OOXML)".to_string()));
    assert!(indicators.contains(&"referinta externa in document Office".to_string()));

    let ole = br#"<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="embeddings/oleObject1.bin"/></Relationships>"#;
    assert!(ooxml_relationship_indicators(ole).contains(&"obiect OLE incorporat in document Office".to_string()));

    let vba = br#"<Relationships><Relationship Id="rId3" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/></Relationships>"#;
    assert!(ooxml_relationship_indicators(vba).contains(&"macro sau script Office intern".to_string()));
  }

  #[test]
  fn ooxml_internal_only_relationships_are_not_flagged_because_of_the_http_namespace() {
    let internal = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>"#;
    assert!(
      ooxml_relationship_indicators(internal).is_empty(),
      "namespace-ul http din xmlns nu este o tinta externa"
    );
  }

  #[test]
  fn ooxml_remote_targets_without_target_mode_are_still_external() {
    let remote = br#"<Relationships><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://cdn.evil.test/logo.png"/></Relationships>"#;
    assert!(ooxml_relationship_indicators(remote).contains(&"referinta externa in document Office".to_string()));
  }
}
