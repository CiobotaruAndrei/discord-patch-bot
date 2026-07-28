use crate::executable::{analyze_executable, looks_like_executable, ExecutableLimits, ExecutableOutcome};
use crate::visual::{embedded_jpeg_preview, iso_bmff_image_brand, looks_like_image, png_from_samples, scan_visual_codes, VisualLimits, VisualOutcome};
use crate::pdf_structure::{
  inspect_pdf_structure, needs_structural_escalation, PdfStructureLimits, PdfStructureOutcome,
};
use flate2::read::{DeflateDecoder, GzDecoder, ZlibDecoder};
use std::io::Read;
use std::time::Instant;

pub struct InspectionLimits {
  pub max_depth: u32,
  pub max_entries: u32,
  pub max_expanded_bytes: u64,
  pub max_compression_ratio: f64,
  pub timeout_ms: u64,
}

impl Default for InspectionLimits {
  fn default() -> Self {
    Self {
      max_depth: 3,
      max_entries: 64,
      max_expanded_bytes: 8 * 1024 * 1024,
      max_compression_ratio: 100.0,
      timeout_ms: 100,
    }
  }
}

pub struct InspectionReport {
  pub status: String,
  pub indicators: Vec<String>,
  pub reason: String,
  pub entries_inspected: u32,
  pub expanded_bytes: u64,
  pub elapsed_ms: f64,
}

struct Finding {
  uncertain: bool,
  indicators: Vec<String>,
  reason: String,
}

struct Budget {
  entries: u32,
  expanded_bytes: u64,
  started: Instant,
  limits: InspectionLimits,
}

fn dedupe(values: Vec<String>) -> Vec<String> {
  let mut seen: Vec<String> = Vec::new();
  for value in values {
    if !seen.iter().any(|existing| existing == &value) {
      seen.push(value);
    }
  }
  seen
}

fn uncertain(reason: String, indicators: Vec<String>) -> Finding {
  Finding { uncertain: true, indicators, reason }
}

fn inspected(indicators: Vec<String>) -> Finding {
  let deduped = dedupe(indicators);
  let reason = if deduped.is_empty() {
    "arhiva inspectata pasiv fara indicatori interni".to_string()
  } else {
    "arhiva inspectata pasiv cu indicatori interni".to_string()
  };
  Finding { uncertain: false, indicators: deduped, reason }
}

fn enforce_budget(budget: &mut Budget, compressed_bytes: u64, expanded_bytes: u64) -> Option<String> {
  budget.entries += 1;
  budget.expanded_bytes += expanded_bytes;
  if budget.entries > budget.limits.max_entries {
    return Some(format!("arhiva depaseste limita de {} intrari", budget.limits.max_entries));
  }
  if budget.expanded_bytes > budget.limits.max_expanded_bytes {
    return Some(format!("arhiva depaseste limita de {} bytes decomprimati", budget.limits.max_expanded_bytes));
  }
  if compressed_bytes > 0 && (expanded_bytes as f64 / compressed_bytes as f64) > budget.limits.max_compression_ratio {
    return Some(format!("arhiva depaseste raportul maxim de compresie {}:1", budget.limits.max_compression_ratio as u64));
  }
  if budget.started.elapsed().as_millis() as u64 > budget.limits.timeout_ms {
    return Some(format!("inspectia arhivei a depasit {} ms", budget.limits.timeout_ms));
  }
  None
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
  if needle.is_empty() || haystack.len() < needle.len() {
    return None;
  }
  haystack.windows(needle.len()).position(|window| window == needle)
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
  find(haystack, needle).is_some()
}

pub(crate) fn window_contains(haystack: &[u8], needle: &[u8]) -> bool {
  contains(haystack, needle)
}

fn is_word_byte(byte: u8) -> bool {
  byte.is_ascii_alphanumeric() || byte == b'_'
}

fn contains_with_trailing_boundary(haystack: &[u8], needle: &[u8]) -> bool {
  let mut offset = 0;
  while offset + needle.len() <= haystack.len() {
    match find(&haystack[offset..], needle) {
      None => return false,
      Some(index) => {
        let start = offset + index;
        let end = start + needle.len();
        if end >= haystack.len() || !is_word_byte(haystack[end]) {
          return true;
        }
        offset = start + 1;
      }
    }
  }
  false
}

fn contains_word(haystack: &[u8], needle: &[u8]) -> bool {
  let mut offset = 0;
  while offset + needle.len() <= haystack.len() {
    match find(&haystack[offset..], needle) {
      None => return false,
      Some(index) => {
        let start = offset + index;
        let end = start + needle.len();
        let leading_ok = start == 0 || !is_word_byte(haystack[start - 1]);
        let trailing_ok = end >= haystack.len() || !is_word_byte(haystack[end]);
        if leading_ok && trailing_ok {
          return true;
        }
        offset = start + 1;
      }
    }
  }
  false
}

fn has_dde_field(haystack: &[u8]) -> bool {
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

fn has_external_target_mode(haystack: &[u8]) -> bool {
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

const PDF_DANGEROUS_NAMES: &[&str] = &["JavaScript", "JS", "OpenAction", "AA", "Launch", "EmbeddedFile", "RichMedia", "GoToR"];

fn hex_value(byte: u8) -> Option<u8> {
  match byte {
    b'0'..=b'9' => Some(byte - b'0'),
    b'a'..=b'f' => Some(byte - b'a' + 10),
    b'A'..=b'F' => Some(byte - b'A' + 10),
    _ => None,
  }
}

pub fn has_obfuscated_pdf_action_name(text: &[u8]) -> bool {
  let mut index = 0;
  while index < text.len() {
    if text[index] != b'/' {
      index += 1;
      continue;
    }
    let mut cursor = index + 1;
    let mut units = 0;
    let mut has_hash = false;
    let mut decoded = String::new();
    while cursor < text.len() && units < 64 {
      let byte = text[cursor];
      if byte == b'#' && cursor + 2 < text.len() {
        match (hex_value(text[cursor + 1]), hex_value(text[cursor + 2])) {
          (Some(high), Some(low)) => {
            decoded.push((high * 16 + low) as char);
            has_hash = true;
            cursor += 3;
            units += 1;
          }
          _ => break,
        }
      } else if byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'_' || byte == b'-' {
        decoded.push(byte as char);
        cursor += 1;
        units += 1;
      } else {
        break;
      }
    }
    if units > 0 && has_hash && PDF_DANGEROUS_NAMES.contains(&decoded.as_str()) {
      return true;
    }
    index = if cursor > index { cursor } else { index + 1 };
  }
  false
}

const CFB_END_OF_CHAIN: u32 = 0xffff_fffe;
const CFB_FREE_SECT: u32 = 0xffff_ffff;
const CFB_MAX_FAT_SECTORS: usize = 512;
const CFB_MAX_DIR_ENTRIES: usize = 4096;

fn read_u16_le(bytes: &[u8], offset: usize) -> Option<u16> {
  if offset + 2 > bytes.len() { return None; }
  Some(u16::from_le_bytes([bytes[offset], bytes[offset + 1]]))
}

fn read_u32_le(bytes: &[u8], offset: usize) -> Option<u32> {
  if offset + 4 > bytes.len() { return None; }
  Some(u32::from_le_bytes([bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]]))
}

fn read_u64_le(bytes: &[u8], offset: usize) -> Option<u64> {
  if offset + 8 > bytes.len() { return None; }
  let mut buffer = [0u8; 8];
  buffer.copy_from_slice(&bytes[offset..offset + 8]);
  Some(u64::from_le_bytes(buffer))
}

pub(crate) fn is_compound_file_binary(bytes: &[u8]) -> bool {
  bytes.len() >= 512 && bytes[0..8] == [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
}

const MSI_ALPHABET: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz._";

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

const MSI_TABLES: &[(&str, &str)] = &[
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

fn msi_indicators(bytes: &[u8], decoded_names: &[String]) -> Vec<String> {
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

fn msi_database_indicators(bytes: &[u8]) -> Vec<String> {
  match crate::read_msi_database(bytes, &crate::MsiLimits::default()) {
    crate::MsiDatabaseOutcome::Read(report) => report.indicators,
    _ => Vec::new(),
  }
}

fn has_executable_extension(normalized: &str) -> bool {
  const EXTENSIONS: &[&str] = &[".exe", ".dll", ".scr", ".com", ".bat", ".cmd", ".ps1", ".sh", ".js", ".jar"];
  EXTENSIONS.iter().any(|extension| normalized.ends_with(extension))
}

fn is_ole_object_bin(normalized: &str) -> bool {
  if !normalized.ends_with(".bin") {
    return false;
  }
  let segment = normalized.rsplit('/').next().unwrap_or(normalized);
  let Some(rest) = segment.strip_prefix("oleobject") else { return false };
  let Some(digits) = rest.strip_suffix(".bin") else { return false };
  digits.chars().all(|character| character.is_ascii_digit())
}

fn scan_window(bytes: &[u8]) -> &[u8] {
  &bytes[..bytes.len().min(1_048_576)]
}

fn pdf_action_indicators(text: &[u8]) -> bool {
  contains_with_trailing_boundary(text, b"/JavaScript")
    || contains_with_trailing_boundary(text, b"/JS")
    || contains(text, b"/OpenAction")
    || contains(text, b"/Launch")
    || contains_with_trailing_boundary(text, b"/AA")
    || contains(text, b"/EmbeddedFile")
    || contains(text, b"/RichMedia")
    || has_obfuscated_pdf_action_name(text)
}

const PDF_MAX_STREAMS: usize = 64;
const PDF_DICT_LOOKBEHIND: usize = 4096;

fn is_pdf(bytes: &[u8]) -> bool {
  bytes.len() >= 5 && &bytes[..5] == b"%PDF-"
}

fn inflate_zlib(data: &[u8], max_output: u64) -> Option<Vec<u8>> {
  let mut out = Vec::new();
  let mut decoder = ZlibDecoder::new(data).take(max_output + 1);
  decoder.read_to_end(&mut out).ok()?;
  if out.len() as u64 > max_output {
    return None;
  }
  Some(out)
}

fn pdf_stream_payload(bytes: &[u8], keyword_end: usize) -> Option<(&[u8], usize)> {
  let mut start = keyword_end;
  if start < bytes.len() && bytes[start] == b'\r' {
    start += 1;
  }
  if start < bytes.len() && bytes[start] == b'\n' {
    start += 1;
  }
  let relative = find(&bytes[start..], b"endstream")?;
  Some((&bytes[start..start + relative], start + relative + 9))
}

const PDF_MAX_RECONSTRUCTED_PIXELS: u64 = 4_000_000;

fn pdf_dictionary_number(dictionary: &[u8], key: &[u8]) -> Option<u32> {
  let at = find(dictionary, key)?;
  let mut cursor = at + key.len();
  while cursor < dictionary.len() && dictionary[cursor].is_ascii_whitespace() {
    cursor += 1;
  }
  let start = cursor;
  while cursor < dictionary.len() && dictionary[cursor].is_ascii_digit() {
    cursor += 1;
  }
  if cursor == start || cursor - start > 9 {
    return None;
  }
  std::str::from_utf8(&dictionary[start..cursor]).ok()?.parse::<u32>().ok()
}

fn pdf_image_indicators(dictionary: &[u8], samples: &[u8]) -> Vec<String> {
  if !contains(dictionary, b"/Image") || pdf_dictionary_number(dictionary, b"/BitsPerComponent") != Some(8) {
    return Vec::new();
  }
  let channels = if contains(dictionary, b"/DeviceGray") {
    1u32
  } else if contains(dictionary, b"/DeviceRGB") {
    3u32
  } else {
    return Vec::new();
  };
  let (Some(width), Some(height)) = (
    pdf_dictionary_number(dictionary, b"/Width"),
    pdf_dictionary_number(dictionary, b"/Height")
  ) else {
    return Vec::new();
  };
  if u64::from(width) * u64::from(height) > PDF_MAX_RECONSTRUCTED_PIXELS {
    return Vec::new();
  }
  match png_from_samples(width, height, channels, samples) {
    Some(png) => visual_indicators(&png),
    None => Vec::new()
  }
}

fn pdf_structural_indicators(bytes: &[u8], budget: &mut Budget) -> Vec<String> {
  if !is_pdf(bytes) {
    return Vec::new();
  }
  let mut indicators: Vec<String> = Vec::new();
  let mut streams = 0usize;
  let mut offset = 0usize;
  while streams < PDF_MAX_STREAMS {
    let Some(relative) = find(&bytes[offset..], b"stream") else { break };
    let keyword_start = offset + relative;
    let keyword_end = keyword_start + 6;
    if keyword_start >= 3 && &bytes[keyword_start - 3..keyword_start] == b"end" {
      offset = keyword_end;
      continue;
    }
    let Some((payload, next_offset)) = pdf_stream_payload(bytes, keyword_end) else { break };
    let dictionary_start = keyword_start.saturating_sub(PDF_DICT_LOOKBEHIND);
    let dictionary = &bytes[dictionary_start..keyword_start];
    if contains(dictionary, b"/FlateDecode") || contains(dictionary, b"/Fl") {
      streams += 1;
      if let Some(decoded) = inflate_zlib(payload, budget.limits.max_expanded_bytes) {
        budget.expanded_bytes += decoded.len() as u64;
        if budget.expanded_bytes > budget.limits.max_expanded_bytes {
          break;
        }
        indicators.extend(pdf_image_indicators(dictionary, &decoded));
        if pdf_action_indicators(&decoded) {
          indicators.push("actiune automata sau script PDF in flux comprimat (parser structural PDF)".to_string());
        }
        if contains(&decoded, b"/Launch") || contains(&decoded, b"/EmbeddedFile") || contains(&decoded, b"/RichMedia") || contains(&decoded, b"/GoToR") {
          indicators.push("indicator de lansare de proces sau continut incorporat".to_string());
        }
        if contains(&decoded, b"DDEAUTO") || has_dde_field(&decoded) {
          indicators.push("indicator de camp DDE (executie externa)".to_string());
        }
        if contains(&decoded, b"/XFA") {
          indicators.push("formular XFA cu potential de script".to_string());
        }
      }
      if budget.started.elapsed().as_millis() as u64 > budget.limits.timeout_ms {
        break;
      }
    }
    offset = next_offset;
  }
  dedupe(indicators)
}

fn xml_attribute<'a>(element: &'a [u8], name: &[u8]) -> Option<&'a [u8]> {
  let mut offset = 0usize;
  while offset + name.len() <= element.len() {
    let window = &element[offset..];
    let position = window
      .windows(name.len())
      .position(|candidate| candidate.iter().zip(name.iter()).all(|(a, b)| a.to_ascii_lowercase() == *b))?;
    let start = offset + position;
    let leading_ok = start == 0 || !is_word_byte(element[start - 1]);
    let mut cursor = start + name.len();
    while cursor < element.len() && element[cursor].is_ascii_whitespace() {
      cursor += 1;
    }
    if leading_ok && cursor < element.len() && element[cursor] == b'=' {
      cursor += 1;
      while cursor < element.len() && element[cursor].is_ascii_whitespace() {
        cursor += 1;
      }
      if cursor < element.len() && (element[cursor] == b'"' || element[cursor] == b'\'') {
        let quote = element[cursor];
        cursor += 1;
        let end = element[cursor..].iter().position(|byte| *byte == quote)? + cursor;
        return Some(&element[cursor..end]);
      }
    }
    offset = start + 1;
  }
  None
}

fn ends_with_ci(haystack: &[u8], suffix: &[u8]) -> bool {
  haystack.len() >= suffix.len()
    && haystack[haystack.len() - suffix.len()..]
      .iter()
      .zip(suffix.iter())
      .all(|(a, b)| a.to_ascii_lowercase() == *b)
}

fn starts_with_ci(haystack: &[u8], prefix: &[u8]) -> bool {
  haystack.len() >= prefix.len()
    && haystack[..prefix.len()].iter().zip(prefix.iter()).all(|(a, b)| a.to_ascii_lowercase() == *b)
}

fn is_remote_target(target: &[u8]) -> bool {
  starts_with_ci(target, b"http://")
    || starts_with_ci(target, b"https://")
    || starts_with_ci(target, b"ftp://")
    || starts_with_ci(target, b"file://")
    || starts_with_ci(target, b"\\\\")
}

fn ooxml_relationship_indicators(bytes: &[u8]) -> Vec<String> {
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

fn name_indicators(name: &str) -> Vec<String> {
  let normalized = name.replace('\\', "/").to_lowercase();
  let mut indicators: Vec<String> = Vec::new();
  if normalized.ends_with("vbaproject.bin") || normalized.contains("/macros/") || normalized.ends_with(".vbs") {
    indicators.push("macro sau script Office intern".to_string());
  }
  if normalized.contains("/embeddings/") || is_ole_object_bin(&normalized) || normalized.ends_with(".ole") {
    indicators.push("obiect OLE incorporat in document Office".to_string());
  }
  if has_executable_extension(&normalized) {
    indicators.push("fisier executabil sau script intern".to_string());
  }
  indicators
}

fn content_indicators(name: &str, bytes: &[u8], budget: &mut Budget) -> Vec<String> {
  let normalized = name.replace('\\', "/").to_lowercase();
  let mut indicators: Vec<String> = name_indicators(name);
  if bytes.len() >= 2 && bytes[0] == 0x4d && bytes[1] == 0x5a {
    indicators.push("executabil PE intern".to_string());
  }
  if bytes.len() >= 4 && bytes[0] == 0x7f && &bytes[1..4] == b"ELF" {
    indicators.push("executabil ELF intern".to_string());
  }
  indicators.extend(executable_indicators(bytes));
  indicators.extend(visual_indicators(bytes));
  let text = scan_window(bytes);
  if pdf_action_indicators(text) {
    indicators.push("actiune automata sau script PDF intern".to_string());
  }
  if contains(text, b"DDEAUTO") || has_dde_field(text) {
    indicators.push("camp DDE intern (executie externa)".to_string());
  }
  if normalized.ends_with(".rels") {
    indicators.extend(ooxml_relationship_indicators(bytes));
    if has_external_target_mode(text) {
      indicators.push("referinta externa in document Office".to_string());
    }
  }
  indicators.extend(inspect_compound_file_binary(bytes));
  indicators.extend(pdf_structural_indicators(bytes, budget));
  indicators
}

pub fn document_indicators(bytes: &[u8]) -> Vec<String> {
  let text = scan_window(bytes);
  let mut indicators: Vec<String> = Vec::new();
  if contains(text, b"vbaProject.bin")
    || contains(text, b"word/vbaProject")
    || contains(text, b"macros/vba")
    || contains(text, b"_VBA_PROJECT")
    || contains_word(text, b"Macros")
  {
    indicators.push("indicator de macro VBA".to_string());
  }
  if contains_with_trailing_boundary(text, b"/JavaScript")
    || contains_with_trailing_boundary(text, b"/JS")
    || contains(text, b"/OpenAction")
    || contains_with_trailing_boundary(text, b"/AA")
    || has_obfuscated_pdf_action_name(text)
  {
    indicators.push("indicator de script/actiune automata in document".to_string());
  }
  if contains(text, b"/Launch") || contains(text, b"/EmbeddedFile") || contains(text, b"/RichMedia") || contains(text, b"/GoToR") {
    indicators.push("indicator de lansare de proces sau continut incorporat".to_string());
  }
  if contains(text, b"DDEAUTO") || has_dde_field(text) {
    indicators.push("indicator de camp DDE (executie externa)".to_string());
  }
  if contains(text, b"/XFA") {
    indicators.push("formular XFA cu potential de script".to_string());
  }
  indicators.extend(inspect_compound_file_binary(bytes));
  dedupe(indicators)
}

fn inflate_raw(data: &[u8], max_output: u64) -> Result<Vec<u8>, String> {
  let mut out = Vec::new();
  let mut decoder = DeflateDecoder::new(data).take(max_output + 1);
  decoder.read_to_end(&mut out).map_err(|_| "intrarea ZIP nu a putut fi decomprimata".to_string())?;
  if out.len() as u64 > max_output {
    return Err("intrarea ZIP depaseste limita decomprimata".to_string());
  }
  Ok(out)
}

fn gunzip(data: &[u8], max_output: u64) -> Result<Vec<u8>, String> {
  let mut out = Vec::new();
  let mut decoder = GzDecoder::new(data).take(max_output + 1);
  decoder.read_to_end(&mut out).map_err(|_| "gzip invalid".to_string())?;
  if out.len() as u64 > max_output {
    return Err("gzip peste limita".to_string());
  }
  Ok(out)
}

fn is_zip(bytes: &[u8]) -> bool {
  bytes.len() >= 4 && read_u32_le(bytes, 0) == Some(0x0403_4b50)
}

fn is_gzip(bytes: &[u8]) -> bool {
  bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b
}

fn is_tar(bytes: &[u8]) -> bool {
  bytes.len() >= 262 && &bytes[257..262] == b"ustar"
}

fn zip_entry_data(bytes: &[u8], offset: usize, compressed_size: usize, uncompressed_size: u64, method: u16, max_expanded: u64) -> Result<Vec<u8>, String> {
  let compressed = &bytes[offset..offset + compressed_size];
  if method == 0 {
    return Ok(compressed.to_vec());
  }
  if method == 8 {
    let limit = if uncompressed_size == 0 { max_expanded } else { uncompressed_size.min(max_expanded) };
    return inflate_raw(compressed, limit);
  }
  Err(format!("metoda ZIP {} nu este suportata pasiv", method))
}

fn inspect_zip(bytes: &[u8], depth: u32, budget: &mut Budget) -> Finding {
  if depth > budget.limits.max_depth {
    return uncertain(format!("arhiva depaseste adancimea maxima {}", budget.limits.max_depth), Vec::new());
  }
  let mut indicators: Vec<String> = Vec::new();
  let mut offset = 0usize;
  let mut entries = 0u32;
  while offset + 4 <= bytes.len() {
    let signature = read_u32_le(bytes, offset).unwrap_or(0);
    if signature == 0x0201_4b50 || signature == 0x0605_4b50 {
      break;
    }
    if signature != 0x0403_4b50 {
      return uncertain("structura ZIP trunchiata sau necunoscuta".to_string(), indicators);
    }
    if offset + 8 <= bytes.len() && (read_u16_le(bytes, offset + 6).unwrap_or(0) & 0x0001) != 0 {
      return uncertain("arhiva criptata ZIP".to_string(), indicators);
    }
    if offset + 30 > bytes.len() {
      return uncertain("header ZIP trunchiat".to_string(), indicators);
    }
    let flags = read_u16_le(bytes, offset + 6).unwrap_or(0);
    let method = read_u16_le(bytes, offset + 8).unwrap_or(0);
    let compressed_size = read_u32_le(bytes, offset + 18).unwrap_or(0) as usize;
    let uncompressed_size = read_u32_le(bytes, offset + 22).unwrap_or(0) as u64;
    let name_length = read_u16_le(bytes, offset + 26).unwrap_or(0) as usize;
    let extra_length = read_u16_le(bytes, offset + 28).unwrap_or(0) as usize;
    if (flags & 0x0008) != 0 {
      return uncertain("arhiva ZIP cu dimensiuni post-date nu poate fi inspectata strict".to_string(), indicators);
    }
    let data_offset = offset + 30 + name_length + extra_length;
    let end_offset = data_offset.saturating_add(compressed_size);
    if data_offset > bytes.len() || end_offset > bytes.len() {
      return uncertain("intrare ZIP trunchiata".to_string(), indicators);
    }
    let name = String::from_utf8_lossy(&bytes[offset + 30..offset + 30 + name_length]).to_string();
    if !name.ends_with('/') {
      if let Some(limit_failure) = enforce_budget(budget, compressed_size as u64, uncompressed_size) {
        return uncertain(limit_failure, indicators);
      }
      let entry = match zip_entry_data(bytes, data_offset, compressed_size, uncompressed_size, method, budget.limits.max_expanded_bytes) {
        Ok(value) => value,
        Err(message) => return uncertain(message, indicators),
      };
      if uncompressed_size != 0 && entry.len() as u64 != uncompressed_size {
        return uncertain("dimensiunea decomprimata ZIP nu corespunde headerului".to_string(), indicators);
      }
      indicators.extend(content_indicators(&name, &entry, budget));
      let nested = inspect_nested(&name, &entry, depth + 1, budget);
      indicators.extend(nested.indicators);
      if nested.uncertain {
        return uncertain(nested.reason, indicators);
      }
    }
    entries += 1;
    offset = end_offset;
  }
  if entries > 0 {
    inspected(indicators)
  } else {
    uncertain("arhiva ZIP nu contine intrari locale inspectabile".to_string(), indicators)
  }
}

fn inspect_tar(bytes: &[u8], depth: u32, budget: &mut Budget) -> Finding {
  if depth > budget.limits.max_depth {
    return uncertain(format!("arhiva depaseste adancimea maxima {}", budget.limits.max_depth), Vec::new());
  }
  let mut indicators: Vec<String> = Vec::new();
  let mut offset = 0usize;
  let mut entries = 0u32;
  while offset + 512 <= bytes.len() {
    let header = &bytes[offset..offset + 512];
    if header.iter().all(|byte| *byte == 0) {
      break;
    }
    let raw_name = &header[0..100];
    let name_end = raw_name.iter().position(|byte| *byte == 0).unwrap_or(raw_name.len());
    let name = String::from_utf8_lossy(&raw_name[..name_end]).to_string();
    let raw_size = &header[124..136];
    let size_end = raw_size.iter().position(|byte| *byte == 0).unwrap_or(raw_size.len());
    let size_text = String::from_utf8_lossy(&raw_size[..size_end]).trim().to_string();
    let size = if size_text.is_empty() { 0 } else { u64::from_str_radix(&size_text, 8).unwrap_or(u64::MAX) };
    if size == u64::MAX {
      return uncertain("header TAR invalid".to_string(), indicators);
    }
    let data_offset = offset + 512;
    let end_offset = data_offset.saturating_add(size as usize);
    if end_offset > bytes.len() {
      return uncertain("intrare TAR trunchiata".to_string(), indicators);
    }
    if let Some(limit_failure) = enforce_budget(budget, size, size) {
      return uncertain(limit_failure, indicators);
    }
    let entry = &bytes[data_offset..end_offset];
    indicators.extend(content_indicators(&name, entry, budget));
    let nested = inspect_nested(&name, entry, depth + 1, budget);
    indicators.extend(nested.indicators);
    if nested.uncertain {
      return uncertain(nested.reason, indicators);
    }
    entries += 1;
    offset = data_offset + ((size as usize).div_ceil(512)) * 512;
  }
  if entries > 0 {
    inspected(indicators)
  } else {
    uncertain("arhiva TAR nu contine intrari inspectabile".to_string(), indicators)
  }
}

fn inspect_gzip(bytes: &[u8], depth: u32, budget: &mut Budget) -> Finding {
  if depth > budget.limits.max_depth {
    return uncertain(format!("arhiva depaseste adancimea maxima {}", budget.limits.max_depth), Vec::new());
  }
  let expanded = match gunzip(bytes, budget.limits.max_expanded_bytes) {
    Ok(value) => value,
    Err(_) => return uncertain("arhiva GZIP este trunchiata, invalida sau depaseste limita decomprimata".to_string(), Vec::new()),
  };
  if let Some(limit_failure) = enforce_budget(budget, bytes.len() as u64, expanded.len() as u64) {
    return uncertain(limit_failure, Vec::new());
  }
  let tar = inspect_tar(&expanded, depth + 1, budget);
  if !tar.uncertain {
    return tar;
  }
  let mut indicators = content_indicators("payload", &expanded, budget);
  let nested = inspect_nested("payload", &expanded, depth + 1, budget);
  let nested_uncertain = nested.uncertain;
  indicators.extend(nested.indicators);
  if nested_uncertain && indicators.is_empty() {
    uncertain(tar.reason, Vec::new())
  } else {
    inspected(indicators)
  }
}

fn inspect_nested(name: &str, bytes: &[u8], depth: u32, budget: &mut Budget) -> Finding {
  if is_zip(bytes) {
    return inspect_zip(bytes, depth, budget);
  }
  if is_gzip(bytes) {
    return inspect_gzip(bytes, depth, budget);
  }
  if name.to_lowercase().ends_with(".tar") || is_tar(bytes) {
    return inspect_tar(bytes, depth, budget);
  }
  inspected(Vec::new())
}

struct HeaderEntry {
  name: String,
  encrypted: bool,
  directory: bool,
}

struct HeaderScan {
  entries: Vec<HeaderEntry>,
  encrypted_headers: bool,
  truncated: Option<String>,
}

fn is_rar4(bytes: &[u8]) -> bool {
  bytes.len() >= 7 && bytes[0..7] == [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]
}

fn is_rar5(bytes: &[u8]) -> bool {
  bytes.len() >= 8 && bytes[0..8] == [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]
}

fn is_seven_zip(bytes: &[u8]) -> bool {
  bytes.len() >= 32 && bytes[0..6] == [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]
}

fn decode_oem_name(raw: &[u8]) -> String {
  raw.iter().take_while(|byte| **byte != 0).map(|byte| *byte as char).collect()
}

fn read_vint(bytes: &[u8], offset: usize) -> Option<(u64, usize)> {
  let mut value = 0u64;
  let mut shift = 0u32;
  let mut cursor = offset;
  while cursor < bytes.len() && shift < 64 {
    let byte = bytes[cursor];
    value |= ((byte & 0x7f) as u64) << shift;
    cursor += 1;
    if byte & 0x80 == 0 {
      return Some((value, cursor - offset));
    }
    shift += 7;
  }
  None
}

fn scan_rar4_headers(bytes: &[u8], budget: &mut Budget) -> HeaderScan {
  let mut scan = HeaderScan { entries: Vec::new(), encrypted_headers: false, truncated: None };
  let mut offset = 7usize;
  while offset + 7 <= bytes.len() {
    let head_flags = match read_u16_le(bytes, offset + 3) {
      Some(value) => value,
      None => {
        scan.truncated = Some("structura RAR trunchiata sau necunoscuta".to_string());
        return scan;
      }
    };
    let head_size = match read_u16_le(bytes, offset + 5) {
      Some(value) => value as usize,
      None => {
        scan.truncated = Some("structura RAR trunchiata sau necunoscuta".to_string());
        return scan;
      }
    };
    if head_size < 7 {
      scan.truncated = Some("structura RAR trunchiata sau necunoscuta".to_string());
      return scan;
    }
    let head_type = bytes[offset + 2];
    if head_type == 0x7b {
      return scan;
    }
    let mut data_size = 0u64;
    if head_flags & 0x8000 != 0 {
      data_size = read_u32_le(bytes, offset + 7).unwrap_or(0) as u64;
    }
    if head_type == 0x74 {
      if offset + 32 > bytes.len() {
        scan.truncated = Some("header RAR trunchiat".to_string());
        return scan;
      }
      let name_size = read_u16_le(bytes, offset + 26).unwrap_or(0) as usize;
      let mut name_offset = offset + 32;
      if head_flags & 0x0100 != 0 {
        name_offset += 8;
      }
      if name_offset + name_size > bytes.len() {
        scan.truncated = Some("nume de intrare RAR trunchiat".to_string());
        return scan;
      }
      if let Some(failure) = enforce_budget(budget, 0, 0) {
        scan.truncated = Some(failure);
        return scan;
      }
      scan.entries.push(HeaderEntry {
        name: decode_oem_name(&bytes[name_offset..name_offset + name_size]),
        encrypted: head_flags & 0x0004 != 0,
        directory: head_flags & 0x00e0 == 0x00e0,
      });
    }
    let advance = head_size as u64 + data_size;
    if advance == 0 {
      scan.truncated = Some("structura RAR trunchiata sau necunoscuta".to_string());
      return scan;
    }
    match offset.checked_add(advance as usize) {
      Some(next) if next > offset => offset = next,
      _ => {
        scan.truncated = Some("structura RAR trunchiata sau necunoscuta".to_string());
        return scan;
      }
    }
  }
  if offset < bytes.len() {
    scan.truncated = Some("header RAR trunchiat".to_string());
  }
  scan
}

fn scan_rar5_headers(bytes: &[u8], budget: &mut Budget) -> HeaderScan {
  let mut scan = HeaderScan { entries: Vec::new(), encrypted_headers: false, truncated: None };
  let mut offset = 8usize;
  while offset + 5 <= bytes.len() {
    let mut cursor = offset + 4;
    let (header_size, used) = match read_vint(bytes, cursor) {
      Some(value) => value,
      None => {
        scan.truncated = Some("structura RAR trunchiata sau necunoscuta".to_string());
        return scan;
      }
    };
    cursor += used;
    let header_start = cursor;
    let (header_type, used) = match read_vint(bytes, cursor) {
      Some(value) => value,
      None => {
        scan.truncated = Some("structura RAR trunchiata sau necunoscuta".to_string());
        return scan;
      }
    };
    cursor += used;
    let (header_flags, used) = match read_vint(bytes, cursor) {
      Some(value) => value,
      None => {
        scan.truncated = Some("structura RAR trunchiata sau necunoscuta".to_string());
        return scan;
      }
    };
    cursor += used;
    if header_flags & 0x0001 != 0 {
      match read_vint(bytes, cursor) {
        Some((_, used)) => cursor += used,
        None => {
          scan.truncated = Some("structura RAR trunchiata sau necunoscuta".to_string());
          return scan;
        }
      }
    }
    let mut data_size = 0u64;
    if header_flags & 0x0002 != 0 {
      match read_vint(bytes, cursor) {
        Some((value, used)) => {
          data_size = value;
          cursor += used;
        }
        None => {
          scan.truncated = Some("structura RAR trunchiata sau necunoscuta".to_string());
          return scan;
        }
      }
    }
    if header_type == 4 {
      scan.encrypted_headers = true;
      return scan;
    }
    if header_type == 5 {
      return scan;
    }
    if header_type == 2 || header_type == 3 {
      match read_rar5_file_name(bytes, cursor) {
        Some((name, file_flags)) => {
          if header_type == 2 {
            if let Some(failure) = enforce_budget(budget, 0, 0) {
              scan.truncated = Some(failure);
              return scan;
            }
            scan.entries.push(HeaderEntry {
              name,
              encrypted: false,
              directory: file_flags & 0x0001 != 0,
            });
          }
        }
        None => {
          scan.truncated = Some("nume de intrare RAR trunchiat".to_string());
          return scan;
        }
      }
    }
    let advance = (header_start - offset) as u64 + header_size + data_size;
    if advance == 0 {
      scan.truncated = Some("structura RAR trunchiata sau necunoscuta".to_string());
      return scan;
    }
    match offset.checked_add(advance as usize) {
      Some(next) if next > offset => offset = next,
      _ => {
        scan.truncated = Some("structura RAR trunchiata sau necunoscuta".to_string());
        return scan;
      }
    }
  }
  if offset < bytes.len() {
    scan.truncated = Some("header RAR trunchiat".to_string());
  }
  scan
}

fn read_rar5_file_name(bytes: &[u8], offset: usize) -> Option<(String, u64)> {
  let mut cursor = offset;
  let (file_flags, used) = read_vint(bytes, cursor)?;
  cursor += used;
  let (_unpacked_size, used) = read_vint(bytes, cursor)?;
  cursor += used;
  let (_attributes, used) = read_vint(bytes, cursor)?;
  cursor += used;
  if file_flags & 0x0002 != 0 {
    cursor += 4;
  }
  if file_flags & 0x0004 != 0 {
    cursor += 4;
  }
  let (_compression, used) = read_vint(bytes, cursor)?;
  cursor += used;
  let (_host_os, used) = read_vint(bytes, cursor)?;
  cursor += used;
  let (name_length, used) = read_vint(bytes, cursor)?;
  cursor += used;
  let end = cursor.checked_add(name_length as usize)?;
  if end > bytes.len() {
    return None;
  }
  Some((String::from_utf8_lossy(&bytes[cursor..end]).into_owned(), file_flags))
}

fn scan_seven_zip_headers(bytes: &[u8]) -> HeaderScan {
  let mut scan = HeaderScan { entries: Vec::new(), encrypted_headers: false, truncated: None };
  let next_offset = match read_u64_le(bytes, 12) {
    Some(value) => value,
    None => {
      scan.truncated = Some("structura 7z trunchiata sau necunoscuta".to_string());
      return scan;
    }
  };
  let next_size = match read_u64_le(bytes, 20) {
    Some(value) => value,
    None => {
      scan.truncated = Some("structura 7z trunchiata sau necunoscuta".to_string());
      return scan;
    }
  };
  let start = match (next_offset as usize).checked_add(32) {
    Some(value) => value,
    None => {
      scan.truncated = Some("structura 7z trunchiata sau necunoscuta".to_string());
      return scan;
    }
  };
  let end = match start.checked_add(next_size as usize) {
    Some(value) => value,
    None => {
      scan.truncated = Some("structura 7z trunchiata sau necunoscuta".to_string());
      return scan;
    }
  };
  if next_size == 0 || end > bytes.len() {
    scan.truncated = Some("structura 7z trunchiata sau necunoscuta".to_string());
    return scan;
  }
  if bytes[start] == 0x17 {
    scan.encrypted_headers = true;
    return scan;
  }
  if bytes[start] != 0x01 {
    scan.truncated = Some("structura 7z trunchiata sau necunoscuta".to_string());
  }
  scan
}

fn header_scan_finding(scan: HeaderScan, format: &str, budget: &mut Budget) -> Finding {
  let mut indicators: Vec<String> = Vec::new();
  let mut encrypted_entries = false;
  for entry in &scan.entries {
    if entry.encrypted {
      encrypted_entries = true;
    }
    if !entry.directory {
      indicators.extend(name_indicators(&entry.name));
    }
  }
  if scan.encrypted_headers {
    return uncertain(
      format!("arhiva {} are headerul criptat; numele intrarilor nu pot fi citite fara parola", format),
      dedupe(indicators),
    );
  }
  if encrypted_entries {
    return uncertain(format!("arhiva criptata {}", format), dedupe(indicators));
  }
  if let Some(failure) = scan.truncated {
    let _ = budget;
    return uncertain(failure, dedupe(indicators));
  }
  if scan.entries.is_empty() {
    return uncertain(
      format!("arhiva {} nu expune nume de intrari inspectabile pasiv; continutul nu are decodor local", format),
      dedupe(indicators),
    );
  }
  uncertain(
    format!(
      "arhiva {} inspectata structural doar la nivel de header ({} intrari); continutul comprimat nu are decodor pasiv local",
      format,
      scan.entries.len()
    ),
    dedupe(indicators),
  )
}

fn inspect_native_container(bytes: &[u8], depth: u32, budget: &mut Budget, format_label: &str) -> Option<Finding> {
  if !crate::native_archive_available() {
    return None;
  }
  if depth > budget.limits.max_depth {
    return Some(uncertain(format!("arhiva depaseste adancimea maxima {}", budget.limits.max_depth), Vec::new()));
  }
  let mut indicators: Vec<String> = Vec::new();
  let mut encrypted_entries = false;
  let mut stop_reason: Option<String> = None;
  let max_entry_bytes = budget.limits.max_expanded_bytes;

  let outcome = crate::decode_native_archive(bytes, max_entry_bytes, |entry, payload| {
    if entry.encrypted {
      encrypted_entries = true;
      return false;
    }
    if entry.unsafe_path {
      indicators.push("cale de intrare nesigura in arhiva (absoluta sau iesind din radacina)".to_string());
    }
    if entry.link {
      indicators.push("link simbolic sau hard link in arhiva (nu este materializat)".to_string());
    }
    if entry.directory {
      return true;
    }
    if let Some(failure) = enforce_budget(budget, 0, payload.len() as u64) {
      stop_reason = Some(failure);
      return false;
    }
    indicators.extend(content_indicators(&entry.name, payload, budget));
    let nested = inspect_nested(&entry.name, payload, depth + 1, budget);
    indicators.extend(nested.indicators);
    if nested.uncertain {
      stop_reason = Some(nested.reason);
      return false;
    }
    true
  });

  match outcome {
    crate::NativeArchiveOutcome::Unavailable(_) => None,
    crate::NativeArchiveOutcome::Failed(_) => {
      if encrypted_entries {
        return Some(uncertain(format!("arhiva criptata {}", format_label), dedupe(indicators)));
      }
      None
    }
    crate::NativeArchiveOutcome::Decoded { entries, format } => {
      if encrypted_entries {
        return Some(uncertain(format!("arhiva criptata {}", format_label), dedupe(indicators)));
      }
      if let Some(reason) = stop_reason {
        return Some(uncertain(reason, dedupe(indicators)));
      }
      if entries == 0 {
        return None;
      }
      let deduped = dedupe(indicators);
      let reason = if deduped.is_empty() {
        format!("arhiva {} decodata complet ({} intrari), fara indicatori interni", format, entries)
      } else {
        format!("arhiva {} decodata complet ({} intrari), cu indicatori interni", format, entries)
      };
      Some(Finding { uncertain: false, indicators: deduped, reason })
    }
  }
}

fn inspect_rar(bytes: &[u8], budget: &mut Budget) -> Finding {
  let scan = if is_rar5(bytes) { scan_rar5_headers(bytes, budget) } else { scan_rar4_headers(bytes, budget) };
  header_scan_finding(scan, "RAR", budget)
}

fn inspect_seven_zip(bytes: &[u8], budget: &mut Budget) -> Finding {
  let scan = scan_seven_zip_headers(bytes);
  header_scan_finding(scan, "7z", budget)
}

fn looks_like_archive(bytes: &[u8], filename: &str, mime: &str) -> bool {
  if is_zip(bytes) || is_gzip(bytes) || is_tar(bytes) {
    return true;
  }
  if bytes.len() >= 7 && &bytes[0..6] == b"Rar!\x1a\x07" {
    return true;
  }
  if bytes.len() >= 6 && bytes[0..6] == [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] {
    return true;
  }
  let lower_name = filename.to_lowercase();
  let lower_mime = mime.to_lowercase();
  const ARCHIVE_EXTENSIONS: &[&str] = &[".zip", ".tar", ".gz", ".tgz", ".rar", ".7z", ".bz2", ".xz"];
  if ARCHIVE_EXTENSIONS.iter().any(|extension| lower_name.ends_with(extension)) {
    return true;
  }
  ["zip", "tar", "gzip", "x-rar", "7z", "compressed"].iter().any(|token| lower_mime.contains(token))
}

fn pdf_deep_indicators(bytes: &[u8], budget: &mut Budget) -> Option<(Vec<String>, bool, String)> {
  if !is_pdf(bytes) || !needs_structural_escalation(bytes) {
    return None;
  }
  let limits = PdfStructureLimits {
    max_decoded_bytes: budget.limits.max_expanded_bytes,
    timeout_ms: budget.limits.timeout_ms,
    ..PdfStructureLimits::default()
  };
  let mut nested: Vec<String> = Vec::new();
  let outcome = inspect_pdf_structure(bytes, &limits, |name, payload| {
    nested.extend(content_indicators(name, payload, budget));
  });
  match outcome {
    PdfStructureOutcome::Analyzed(report) => {
      budget.expanded_bytes += report.decoded_bytes;
      let mut indicators = report.indicators;
      indicators.extend(nested);
      let uncertain = report.encrypted || !report.complete;
      let reason = if report.encrypted {
        "PDF criptat analizat structural; verdictul ramane neconfirmat".to_string()
      } else if !report.stop_reason.is_empty() {
        report.stop_reason
      } else {
        format!(
          "PDF analizat structural cu qpdf ({} obiecte, {} fluxuri, versiune {})",
          report.object_count, report.stream_count, report.pdf_version
        )
      };
      Some((indicators, uncertain, reason))
    }
    PdfStructureOutcome::Failed(_) | PdfStructureOutcome::Unavailable(_) => None,
  }
}

fn executable_indicators(bytes: &[u8]) -> Vec<String> {
  if !looks_like_executable(bytes) {
    return Vec::new();
  }
  match analyze_executable(bytes, &ExecutableLimits::default()) {
    ExecutableOutcome::Analyzed(report) => {
      let mut indicators = report.indicators;
      if report.is_library {
        indicators.push(format!("biblioteca {} interna, nu executabil de sine statator", report.format));
      }
      indicators
    }
    ExecutableOutcome::Failed(_) | ExecutableOutcome::Unavailable(_) | ExecutableOutcome::NotExecutable => Vec::new(),
  }
}

const ISO_BMFF_PREVIEW_SCAN_BYTES: usize = 512 * 1024;

fn iso_bmff_visual_indicators(bytes: &[u8]) -> Vec<String> {
  let Some(brand) = iso_bmff_image_brand(bytes) else { return Vec::new() };
  if let Some(preview) = embedded_jpeg_preview(bytes, ISO_BMFF_PREVIEW_SCAN_BYTES) {
    if let VisualOutcome::Scanned { indicators, codes } = scan_visual_codes(preview, &VisualLimits::default()) {
      if !codes.is_empty() {
        let mut found = vec![format!("cod citit din previzualizarea incorporata a unei imagini {brand}")];
        found.extend(indicators);
        return found;
      }
    }
  }
  vec![format!(
    "imagine {brand} neinspectata vizual: formatul nu are decodor, deci un cod din ea nu poate fi citit"
  )]
}

fn visual_indicators(bytes: &[u8]) -> Vec<String> {
  if !looks_like_image(bytes) {
    return iso_bmff_visual_indicators(bytes);
  }
  match scan_visual_codes(bytes, &VisualLimits::default()) {
    VisualOutcome::Scanned { indicators, .. } => indicators,
    VisualOutcome::Failed(_) | VisualOutcome::Unavailable(_) | VisualOutcome::NotImage => Vec::new(),
  }
}

fn document_finding(bytes: &[u8], budget: &mut Budget) -> Finding {
  let mut indicators = document_indicators(bytes);
  indicators.extend(executable_indicators(bytes));
  indicators.extend(visual_indicators(bytes));
  indicators.extend(pdf_structural_indicators(bytes, budget));
  let deep = pdf_deep_indicators(bytes, budget);
  let (uncertain, deep_reason) = match deep {
    Some((deep_indicators, uncertain, reason)) => {
      indicators.extend(deep_indicators);
      (uncertain, Some(reason))
    }
    None => (false, None),
  };
  let indicators = dedupe(indicators);
  let reason = match deep_reason {
    Some(reason) => reason,
    None if indicators.is_empty() => "document inspectat structural fara indicatori".to_string(),
    None => "document inspectat structural cu indicatori".to_string(),
  };
  Finding { uncertain, indicators, reason }
}

pub fn inspect_untrusted_content(
  bytes: &[u8],
  filename: &str,
  mime: &str,
  mode: &str,
  limits: InspectionLimits,
) -> InspectionReport {
  let started = Instant::now();
  let mut budget = Budget { entries: 0, expanded_bytes: 0, started, limits };
  let finding = if mode == "document" {
    document_finding(bytes, &mut budget)
  } else if is_zip(bytes) {
    inspect_zip(bytes, 0, &mut budget)
  } else if is_gzip(bytes) {
    inspect_gzip(bytes, 0, &mut budget)
  } else if is_tar(bytes) {
    inspect_tar(bytes, 0, &mut budget)
  } else if is_rar4(bytes) || is_rar5(bytes) {
    inspect_native_container(bytes, 0, &mut budget, "RAR").unwrap_or_else(|| inspect_rar(bytes, &mut budget))
  } else if is_seven_zip(bytes) {
    inspect_native_container(bytes, 0, &mut budget, "7z").unwrap_or_else(|| inspect_seven_zip(bytes, &mut budget))
  } else if looks_like_image(bytes) {
    let indicators = dedupe(visual_indicators(bytes));
    let reason = if indicators.is_empty() {
      "imagine scanata fara coduri vizuale".to_string()
    } else {
      "imagine scanata cu coduri vizuale".to_string()
    };
    Finding { uncertain: false, indicators, reason }
  } else if looks_like_executable(bytes) {
    let indicators = dedupe(executable_indicators(bytes));
    let reason = if indicators.is_empty() {
      "executabil analizat structural fara indicatori".to_string()
    } else {
      "executabil analizat structural cu indicatori".to_string()
    };
    Finding { uncertain: false, indicators, reason }
  } else if mode == "archive" || looks_like_archive(bytes, filename, mime) {
    uncertain("formatul arhivei nu are un decodor pasiv local; verdictul ramane neconfirmat".to_string(), Vec::new())
  } else {
    document_finding(bytes, &mut budget)
  };
  InspectionReport {
    status: if finding.uncertain { "uncertain".to_string() } else { "inspected".to_string() },
    indicators: dedupe(finding.indicators),
    reason: finding.reason,
    entries_inspected: budget.entries,
    expanded_bytes: budget.expanded_bytes,
    elapsed_ms: started.elapsed().as_secs_f64() * 1000.0,
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use flate2::write::{DeflateEncoder, GzEncoder, ZlibEncoder};
  use flate2::Compression;
  use std::io::Write;

  fn deflate_raw(data: &[u8]) -> Vec<u8> {
    let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(data).unwrap();
    encoder.finish().unwrap()
  }

  fn gzip(data: &[u8]) -> Vec<u8> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(data).unwrap();
    encoder.finish().unwrap()
  }

  struct ZipEntry {
    name: String,
    data: Vec<u8>,
    deflate: bool,
    encrypted: bool,
  }

  fn entry(name: &str, data: &[u8]) -> ZipEntry {
    ZipEntry { name: name.to_string(), data: data.to_vec(), deflate: false, encrypted: false }
  }

  fn deflated(name: &str, data: Vec<u8>) -> ZipEntry {
    ZipEntry { name: name.to_string(), data, deflate: true, encrypted: false }
  }

  fn zip_archive(entries: &[ZipEntry]) -> Vec<u8> {
    let mut out = Vec::new();
    for item in entries {
      let payload = if item.deflate { deflate_raw(&item.data) } else { item.data.clone() };
      out.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
      out.extend_from_slice(&20u16.to_le_bytes());
      out.extend_from_slice(&(if item.encrypted { 1u16 } else { 0u16 }).to_le_bytes());
      out.extend_from_slice(&(if item.deflate { 8u16 } else { 0u16 }).to_le_bytes());
      out.extend_from_slice(&0u16.to_le_bytes());
      out.extend_from_slice(&0u16.to_le_bytes());
      out.extend_from_slice(&0u32.to_le_bytes());
      out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
      out.extend_from_slice(&(item.data.len() as u32).to_le_bytes());
      out.extend_from_slice(&(item.name.len() as u16).to_le_bytes());
      out.extend_from_slice(&0u16.to_le_bytes());
      out.extend_from_slice(item.name.as_bytes());
      out.extend_from_slice(&payload);
    }
    out
  }

  fn tar_archive(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut out = Vec::new();
    for (name, data) in entries {
      let mut header = vec![0u8; 512];
      header[..name.len()].copy_from_slice(name.as_bytes());
      let size = format!("{:011o}\0", data.len());
      header[124..124 + size.len()].copy_from_slice(size.as_bytes());
      header[257..263].copy_from_slice(b"ustar\0");
      out.extend_from_slice(&header);
      let padded = data.len().div_ceil(512) * 512;
      out.extend_from_slice(data);
      out.extend(std::iter::repeat_n(0u8, padded - data.len()));
    }
    out.extend(std::iter::repeat_n(0u8, 1024));
    out
  }

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

  fn report(bytes: &[u8], filename: &str, mime: &str, mode: &str) -> InspectionReport {
    inspect_untrusted_content(bytes, filename, mime, mode, InspectionLimits::default())
  }

  #[test]
  fn zip_stored_entries_are_inspected_and_counted() {
    let archive = zip_archive(&[entry("readme.txt", b"text simplu"), entry("notes.txt", b"alt text")]);
    let result = report(&archive, "arhiva.zip", "application/zip", "archive");
    assert_eq!(result.status, "inspected");
    assert_eq!(result.entries_inspected, 2);
    assert!(result.indicators.is_empty());
  }

  #[test]
  fn zip_deflate_entries_expose_internal_executables() {
    let mut pe = vec![0x4d, 0x5a, 0x90, 0x00];
    pe.extend(std::iter::repeat_n(0x41u8, 512));
    let archive = zip_archive(&[deflated("setup/installer.exe", pe)]);
    let result = report(&archive, "setup.zip", "application/zip", "archive");
    assert_eq!(result.status, "inspected");
    assert!(result.indicators.contains(&"fisier executabil sau script intern".to_string()));
    assert!(result.indicators.contains(&"executabil PE intern".to_string()));
  }

  #[test]
  fn encrypted_zip_stays_uncertain_instead_of_clean() {
    let archive = zip_archive(&[ZipEntry { name: "secret.bin".to_string(), data: vec![7u8; 64], deflate: false, encrypted: true }]);
    let result = report(&archive, "secret.zip", "application/zip", "archive");
    assert_eq!(result.status, "uncertain");
    assert_eq!(result.reason, "arhiva criptata ZIP");
  }

  #[test]
  fn truncated_zip_stays_uncertain() {
    let archive = zip_archive(&[entry("big.bin", &vec![3u8; 512])]);
    let result = report(&archive[..80], "trunchiat.zip", "application/zip", "archive");
    assert_eq!(result.status, "uncertain");
  }

  #[test]
  fn nested_zip_inside_zip_is_traversed() {
    let mut pe = vec![0x4d, 0x5a];
    pe.extend(std::iter::repeat_n(0x41u8, 256));
    let inner = zip_archive(&[deflated("payload/tool.exe", pe)]);
    let outer = zip_archive(&[entry("bundle/inner.zip", &inner)]);
    let result = report(&outer, "bundle.zip", "application/zip", "archive");
    assert!(result.indicators.contains(&"executabil PE intern".to_string()));
  }

  #[test]
  fn compression_ratio_budget_stops_zip_bombs() {
    let archive = zip_archive(&[deflated("bomb.bin", vec![0u8; 4096 * 400])]);
    let result = report(&archive, "bomb.zip", "application/zip", "archive");
    assert_eq!(result.status, "uncertain");
    assert_eq!(result.reason, "arhiva depaseste raportul maxim de compresie 100:1");
  }

  #[test]
  fn entry_budget_is_configurable_per_call() {
    let archive = zip_archive(&[entry("a.txt", b"a"), entry("b.txt", b"b"), entry("c.txt", b"c")]);
    let limits = InspectionLimits { max_entries: 2, ..InspectionLimits::default() };
    let result = inspect_untrusted_content(&archive, "arhiva.zip", "application/zip", "archive", limits);
    assert_eq!(result.status, "uncertain");
    assert_eq!(result.reason, "arhiva depaseste limita de 2 intrari");
  }

  #[test]
  fn tar_entries_expose_office_macros_and_external_targets() {
    let rels = b"<Relationships><Relationship TargetMode=\"External\" Target=\"http://evil.test/x\"/></Relationships>";
    let archive = tar_archive(&[
      ("word/vbaProject.bin", b"Attribute VB_Name"),
      ("word/_rels/document.xml.rels", rels),
    ]);
    let result = report(&archive, "office.tar", "application/x-tar", "archive");
    assert_eq!(result.status, "inspected");
    assert!(result.indicators.contains(&"macro sau script Office intern".to_string()));
    assert!(result.indicators.contains(&"referinta externa in document Office".to_string()));
  }

  #[test]
  fn gzip_wrapping_a_tar_is_traversed() {
    let archive = gzip(&tar_archive(&[("word/vbaProject.bin", b"Attribute VB_Name")]));
    let result = report(&archive, "office.tgz", "application/gzip", "archive");
    assert_eq!(result.status, "inspected");
    assert!(result.indicators.contains(&"macro sau script Office intern".to_string()));
  }

  #[test]
  fn truncated_gzip_stays_uncertain() {
    let archive = gzip(b"continut oarecare de test");
    let result = report(&archive[..12], "text.gz", "application/gzip", "archive");
    assert_eq!(result.status, "uncertain");
    assert_eq!(result.reason, "arhiva GZIP este trunchiata, invalida sau depaseste limita decomprimata");
  }

  fn rar4_file_block(name: &str, flags: u16, packed: &[u8]) -> Vec<u8> {
    let name_bytes = name.as_bytes();
    let head_size = 32 + name_bytes.len();
    let mut block = vec![0u8; head_size];
    block[2] = 0x74;
    block[3..5].copy_from_slice(&(flags | 0x8000).to_le_bytes());
    block[5..7].copy_from_slice(&(head_size as u16).to_le_bytes());
    block[7..11].copy_from_slice(&(packed.len() as u32).to_le_bytes());
    block[11..15].copy_from_slice(&(packed.len() as u32).to_le_bytes());
    block[26..28].copy_from_slice(&(name_bytes.len() as u16).to_le_bytes());
    block[32..32 + name_bytes.len()].copy_from_slice(name_bytes);
    block.extend_from_slice(packed);
    block
  }

  fn rar4_archive(blocks: Vec<Vec<u8>>) -> Vec<u8> {
    let mut out = vec![0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00];
    let mut main = vec![0u8; 13];
    main[2] = 0x73;
    main[5..7].copy_from_slice(&13u16.to_le_bytes());
    out.extend_from_slice(&main);
    for block in blocks {
      out.extend_from_slice(&block);
    }
    let mut end = vec![0u8; 7];
    end[2] = 0x7b;
    end[5..7].copy_from_slice(&7u16.to_le_bytes());
    out.extend_from_slice(&end);
    out
  }

  fn vint(value: u64) -> Vec<u8> {
    let mut out = Vec::new();
    let mut remaining = value;
    loop {
      let byte = (remaining & 0x7f) as u8;
      remaining >>= 7;
      if remaining == 0 {
        out.push(byte);
        return out;
      }
      out.push(byte | 0x80);
    }
  }

  fn rar5_block(header_type: u64, header_flags: u64, body: Vec<u8>, data: &[u8]) -> Vec<u8> {
    let mut header = Vec::new();
    header.extend_from_slice(&vint(header_type));
    header.extend_from_slice(&vint(header_flags));
    if header_flags & 0x0002 != 0 {
      header.extend_from_slice(&vint(data.len() as u64));
    }
    header.extend_from_slice(&body);
    let mut out = vec![0u8; 4];
    out.extend_from_slice(&vint(header.len() as u64));
    out.extend_from_slice(&header);
    out.extend_from_slice(data);
    out
  }

  fn rar5_file_block(name: &str, file_flags: u64, data: &[u8]) -> Vec<u8> {
    let mut body = Vec::new();
    body.extend_from_slice(&vint(file_flags));
    body.extend_from_slice(&vint(data.len() as u64));
    body.extend_from_slice(&vint(0));
    body.extend_from_slice(&vint(0));
    body.extend_from_slice(&vint(0));
    body.extend_from_slice(&vint(name.len() as u64));
    body.extend_from_slice(name.as_bytes());
    rar5_block(2, 0x0002, body, data)
  }

  fn rar5_archive(blocks: Vec<Vec<u8>>) -> Vec<u8> {
    let mut out = vec![0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00];
    out.extend_from_slice(&rar5_block(1, 0, vint(0), &[]));
    for block in blocks {
      out.extend_from_slice(&block);
    }
    out.extend_from_slice(&rar5_block(5, 0, vint(0), &[]));
    out
  }

  fn seven_zip_archive(next_header: &[u8]) -> Vec<u8> {
    let mut out = vec![0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0x00, 0x04];
    out.extend_from_slice(&[0u8; 4]);
    out.extend_from_slice(&0u64.to_le_bytes());
    out.extend_from_slice(&(next_header.len() as u64).to_le_bytes());
    out.extend_from_slice(&[0u8; 4]);
    out.extend_from_slice(next_header);
    out
  }

  #[test]
  fn rar4_headers_expose_entry_names_without_decompressing() {
    let archive = rar4_archive(vec![
      rar4_file_block("docs/readme.txt", 0, b"date"),
      rar4_file_block("setup/installer.exe", 0, b"date"),
    ]);
    let result = report(&archive, "arhiva.rar", "application/x-rar-compressed", "archive");
    assert_eq!(result.status, "uncertain", "continutul comprimat nu are decodor local, deci verdictul nu poate fi inspectat");
    assert!(result.indicators.contains(&"fisier executabil sau script intern".to_string()));
    assert_eq!(result.entries_inspected, 2);
    assert!(result.reason.contains("RAR inspectata structural doar la nivel de header"));
  }

  #[test]
  fn rar4_encrypted_entries_are_reported_as_encrypted() {
    let archive = rar4_archive(vec![rar4_file_block("secret.exe", 0x0004, b"date")]);
    let result = report(&archive, "secret.rar", "application/x-rar-compressed", "archive");
    assert_eq!(result.status, "uncertain");
    assert_eq!(result.reason, "arhiva criptata RAR");
  }

  #[test]
  fn rar4_directory_entries_do_not_produce_content_indicators() {
    let archive = rar4_archive(vec![rar4_file_block("scripts.exe", 0x00e0, b"")]);
    let result = report(&archive, "arhiva.rar", "application/x-rar-compressed", "archive");
    assert!(result.indicators.is_empty(), "un director nu e un fisier executabil, chiar daca numele se termina in .exe");
  }

  #[test]
  fn rar5_headers_expose_entry_names() {
    let archive = rar5_archive(vec![
      rar5_file_block("docs/readme.txt", 0, b"date"),
      rar5_file_block("macros/auto.vbs", 0, b"date"),
    ]);
    let result = report(&archive, "arhiva.rar", "application/x-rar-compressed", "archive");
    assert_eq!(result.status, "uncertain");
    assert!(result.indicators.contains(&"macro sau script Office intern".to_string()));
    assert_eq!(result.entries_inspected, 2);
  }

  #[test]
  fn rar5_encrypted_archive_header_stops_enumeration() {
    let mut archive = vec![0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00];
    archive.extend_from_slice(&rar5_block(4, 0, vint(0), &[]));
    archive.extend_from_slice(&rar5_file_block("secret.exe", 0, b"date"));
    let result = report(&archive, "secret.rar", "application/x-rar-compressed", "archive");
    assert_eq!(result.status, "uncertain");
    assert!(result.reason.contains("headerul criptat"));
    assert!(result.indicators.is_empty(), "cu headerul criptat nu se pot citi nume, deci nu se inventeaza indicatori");
  }

  #[test]
  fn rar_entry_budget_is_enforced_on_header_scan() {
    let archive = rar4_archive(vec![
      rar4_file_block("a.txt", 0, b"x"),
      rar4_file_block("b.txt", 0, b"x"),
      rar4_file_block("c.txt", 0, b"x"),
    ]);
    let limits = InspectionLimits { max_entries: 2, ..InspectionLimits::default() };
    let result = inspect_untrusted_content(&archive, "arhiva.rar", "application/x-rar-compressed", "archive", limits);
    assert_eq!(result.status, "uncertain");
    assert_eq!(result.reason, "arhiva depaseste limita de 2 intrari");
  }

  #[test]
  fn truncated_rar_is_reported_as_truncated_not_clean() {
    let archive = rar4_archive(vec![rar4_file_block("setup.exe", 0, b"date")]);
    let result = report(&archive[..26], "arhiva.rar", "application/x-rar-compressed", "archive");
    assert_eq!(result.status, "uncertain");
    assert!(result.reason.contains("trunchiat"));
  }

  #[test]
  fn seven_zip_encoded_header_is_named_precisely() {
    let result = report(&seven_zip_archive(&[0x17, 0x06, 0x00]), "arhiva.7z", "application/x-7z-compressed", "archive");
    assert_eq!(result.status, "uncertain");
    assert!(result.reason.contains("7z"));
    assert!(result.reason.contains("headerul criptat"));
  }

  #[test]
  fn seven_zip_plain_header_without_names_stays_uncertain() {
    let result = report(&seven_zip_archive(&[0x01, 0x00]), "arhiva.7z", "application/x-7z-compressed", "archive");
    assert_eq!(result.status, "uncertain");
    assert!(result.reason.contains("nu expune nume de intrari inspectabile pasiv"));
  }

  #[test]
  fn unknown_archive_formats_keep_the_generic_uncertain_reason() {
    let mut bz2 = b"BZh9".to_vec();
    bz2.extend(std::iter::repeat_n(9u8, 64));
    let result = report(&bz2, "arhiva.bz2", "application/x-bzip2", "archive");
    assert_eq!(result.status, "uncertain");
    assert_eq!(result.reason, "formatul arhivei nu are un decodor pasiv local; verdictul ramane neconfirmat");
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
  fn document_mode_detects_pdf_actions_including_hex_obfuscation() {
    let plain = report(b"%PDF-1.7 << /OpenAction << /JavaScript (x) >> /Launch (calc.exe) >>", "a.pdf", "application/pdf", "document");
    assert!(plain.indicators.contains(&"indicator de script/actiune automata in document".to_string()));
    assert!(plain.indicators.contains(&"indicator de lansare de proces sau continut incorporat".to_string()));

    let obfuscated = report(b"%PDF-1.7 << /J#61vaScript (x) >>", "b.pdf", "application/pdf", "document");
    assert!(obfuscated.indicators.contains(&"indicator de script/actiune automata in document".to_string()));

    let benign = report(b"%PDF-1.7 << /Titl#65 (doc) >>", "c.pdf", "application/pdf", "document");
    assert!(benign.indicators.is_empty());
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
  fn mode_is_decided_by_the_caller_not_by_sniffing() {
    let docx = zip_archive(&[deflated("word/vbaProject.bin", b"Attribute VB_Name".to_vec())]);
    let as_archive = report(&docx, "document.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "archive");
    let as_document = report(&docx, "document.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "document");
    assert!(as_archive.indicators.contains(&"macro sau script Office intern".to_string()));
    assert!(!as_document.indicators.contains(&"macro sau script Office intern".to_string()));
  }

  #[test]
  fn plain_content_in_auto_mode_is_inspected_as_a_document() {
    let result = report(b"doar text simplu, fara actiuni", "note.txt", "text/plain", "auto");
    assert_eq!(result.status, "inspected");
    assert_eq!(result.reason, "document inspectat structural fara indicatori");
    assert_eq!(result.entries_inspected, 0);
  }

  fn zlib_deflate(data: &[u8]) -> Vec<u8> {
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::best());
    encoder.write_all(data).unwrap();
    encoder.finish().unwrap()
  }

  fn pdf_with_compressed_stream(payload: &[u8]) -> Vec<u8> {
    let mut body = payload.to_vec();
    body.extend_from_slice(b" ");
    body.extend(b"0 0 0 0 0 0 0 0 0 0 ".repeat(64));
    let compressed = zlib_deflate(&body);
    let mut out = Vec::new();
    out.extend_from_slice(b"%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n2 0 obj\n<< /Length ");
    out.extend_from_slice(compressed.len().to_string().as_bytes());
    out.extend_from_slice(b" /Filter /FlateDecode >>\nstream\n");
    out.extend_from_slice(&compressed);
    out.extend_from_slice(b"\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");
    out
  }

  #[test]
  fn pdf_actions_hidden_in_a_flate_stream_are_found_by_the_structural_parser() {
    let pdf = pdf_with_compressed_stream(b"<< /Type /Action /S /JavaScript /JS (app.alert(1)) >>");
    assert_eq!(
      document_indicators(&pdf),
      Vec::<String>::new(),
      "scanarea de fereastra pe bytes-ul brut nu vede continutul comprimat, deci testul chiar exercita parserul structural"
    );
    let result = report(&pdf, "raport.pdf", "application/pdf", "document");
    assert_eq!(result.status, "inspected");
    assert!(result.indicators.contains(&"actiune automata sau script PDF in flux comprimat (parser structural PDF)".to_string()));
    assert!(result.expanded_bytes > 0, "bytes-ii decomprimati din fluxuri intra in bugetul raportat");
  }

  #[test]
  fn pdf_streams_with_benign_content_do_not_produce_indicators() {
    let pdf = pdf_with_compressed_stream(b"BT /F1 12 Tf (raport trimestrial) Tj ET");
    let result = report(&pdf, "raport.pdf", "application/pdf", "document");
    assert_eq!(result.status, "inspected");
    assert!(result.indicators.is_empty());
  }

  #[test]
  fn pdf_embedded_file_inside_a_flate_stream_is_reported() {
    let pdf = pdf_with_compressed_stream(b"<< /Type /Filespec /EmbeddedFile 12 0 R >>");
    let result = report(&pdf, "raport.pdf", "application/pdf", "document");
    assert!(result.indicators.contains(&"indicator de lansare de proces sau continut incorporat".to_string()));
  }

  #[test]
  fn pdf_stream_budget_stops_at_the_expanded_bytes_limit() {
    let pdf = pdf_with_compressed_stream(&vec![b'A'; 4096]);
    let limits = InspectionLimits { max_expanded_bytes: 16, ..InspectionLimits::default() };
    let result = inspect_untrusted_content(&pdf, "raport.pdf", "application/pdf", "document", limits);
    assert_eq!(result.status, "inspected", "un buget depasit pe fluxuri nu transforma documentul in verdict de arhiva");
    assert!(result.indicators.is_empty());
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
