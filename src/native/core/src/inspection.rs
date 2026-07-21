use flate2::read::{DeflateDecoder, GzDecoder};
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

fn ci_contains(haystack: &[u8], lowercase_needle: &[u8]) -> bool {
  if lowercase_needle.is_empty() || haystack.len() < lowercase_needle.len() {
    return false;
  }
  haystack.windows(lowercase_needle.len()).any(|window| {
    window.iter().zip(lowercase_needle.iter()).all(|(a, b)| a.to_ascii_lowercase() == *b)
  })
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

fn is_compound_file_binary(bytes: &[u8]) -> bool {
  bytes.len() >= 512 && bytes[0..8] == [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
}

pub fn inspect_compound_file_binary(bytes: &[u8]) -> Vec<String> {
  if !is_compound_file_binary(bytes) {
    return Vec::new();
  }
  let mut indicators: Vec<String> = Vec::new();
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
    }
    sector = if (sector as usize) < fat.len() { fat[sector as usize] } else { CFB_END_OF_CHAIN };
  }
  dedupe(indicators)
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

fn content_indicators(name: &str, bytes: &[u8]) -> Vec<String> {
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
  if bytes.len() >= 2 && bytes[0] == 0x4d && bytes[1] == 0x5a {
    indicators.push("executabil PE intern".to_string());
  }
  if bytes.len() >= 4 && bytes[0] == 0x7f && &bytes[1..4] == b"ELF" {
    indicators.push("executabil ELF intern".to_string());
  }
  let text = scan_window(bytes);
  if pdf_action_indicators(text) {
    indicators.push("actiune automata sau script PDF intern".to_string());
  }
  if contains(text, b"DDEAUTO") || has_dde_field(text) {
    indicators.push("camp DDE intern (executie externa)".to_string());
  }
  if normalized.ends_with(".rels")
    && (has_external_target_mode(text) || ci_contains(text, b"http://") || ci_contains(text, b"https://"))
  {
    indicators.push("referinta externa in document Office".to_string());
  }
  indicators.extend(inspect_compound_file_binary(bytes));
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
      indicators.extend(content_indicators(&name, &entry));
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
    indicators.extend(content_indicators(&name, entry));
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
  let mut indicators = content_indicators("payload", &expanded);
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

fn document_finding(bytes: &[u8]) -> Finding {
  let indicators = document_indicators(bytes);
  let reason = if indicators.is_empty() {
    "document inspectat structural fara indicatori".to_string()
  } else {
    "document inspectat structural cu indicatori".to_string()
  };
  Finding { uncertain: false, indicators, reason }
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
    document_finding(bytes)
  } else if is_zip(bytes) {
    inspect_zip(bytes, 0, &mut budget)
  } else if is_gzip(bytes) {
    inspect_gzip(bytes, 0, &mut budget)
  } else if is_tar(bytes) {
    inspect_tar(bytes, 0, &mut budget)
  } else if mode == "archive" || looks_like_archive(bytes, filename, mime) {
    uncertain("formatul arhivei nu are un decodor pasiv local; verdictul ramane neconfirmat".to_string(), Vec::new())
  } else {
    document_finding(bytes)
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
  use flate2::write::{DeflateEncoder, GzEncoder};
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

  #[test]
  fn formats_without_a_local_decoder_stay_uncertain() {
    let mut rar = b"Rar!\x1a\x07\x01\x00".to_vec();
    rar.extend(std::iter::repeat_n(9u8, 64));
    let result = report(&rar, "arhiva.rar", "application/x-rar-compressed", "archive");
    assert_eq!(result.status, "uncertain");
    assert_eq!(result.reason, "formatul arhivei nu are un decodor pasiv local; verdictul ramane neconfirmat");
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
}
