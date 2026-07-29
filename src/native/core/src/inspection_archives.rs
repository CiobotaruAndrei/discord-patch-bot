use std::io::Read;
use flate2::read::{DeflateDecoder, GzDecoder};
use crate::inspection_budgets::*;
use crate::inspection_verdict::*;
use crate::inspection_bytes::*;
use crate::inspection_indicators::*;
use crate::inspection::*;

pub(crate) fn inflate_raw(data: &[u8], max_output: u64) -> Result<Vec<u8>, String> {
  let mut out = Vec::new();
  let mut decoder = DeflateDecoder::new(data).take(max_output + 1);
  decoder.read_to_end(&mut out).map_err(|_| "intrarea ZIP nu a putut fi decomprimata".to_string())?;
  if out.len() as u64 > max_output {
    return Err("intrarea ZIP depaseste limita decomprimata".to_string());
  }
  Ok(out)
}

pub(crate) fn gunzip(data: &[u8], max_output: u64) -> Result<Vec<u8>, String> {
  let mut out = Vec::new();
  let mut decoder = GzDecoder::new(data).take(max_output + 1);
  decoder.read_to_end(&mut out).map_err(|_| "gzip invalid".to_string())?;
  if out.len() as u64 > max_output {
    return Err("gzip peste limita".to_string());
  }
  Ok(out)
}

pub(crate) fn is_zip(bytes: &[u8]) -> bool {
  bytes.len() >= 4 && read_u32_le(bytes, 0) == Some(0x0403_4b50)
}

pub(crate) fn is_gzip(bytes: &[u8]) -> bool {
  bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b
}

pub(crate) fn is_tar(bytes: &[u8]) -> bool {
  bytes.len() >= 262 && &bytes[257..262] == b"ustar"
}

pub(crate) fn zip_entry_data(bytes: &[u8], offset: usize, compressed_size: usize, uncompressed_size: u64, method: u16, max_expanded: u64) -> Result<Vec<u8>, String> {
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

pub(crate) fn inspect_zip(bytes: &[u8], depth: u32, budget: &mut Budget) -> Finding {
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

pub(crate) fn inspect_tar(bytes: &[u8], depth: u32, budget: &mut Budget) -> Finding {
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

pub(crate) fn inspect_gzip(bytes: &[u8], depth: u32, budget: &mut Budget) -> Finding {
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

pub(crate) struct HeaderEntry {
  pub(crate) name: String,
  pub(crate) encrypted: bool,
  pub(crate) directory: bool,
}

pub(crate) struct HeaderScan {
  pub(crate) entries: Vec<HeaderEntry>,
  pub(crate) encrypted_headers: bool,
  pub(crate) truncated: Option<String>,
}

pub(crate) fn is_rar4(bytes: &[u8]) -> bool {
  bytes.len() >= 7 && bytes[0..7] == [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]
}

pub(crate) fn is_rar5(bytes: &[u8]) -> bool {
  bytes.len() >= 8 && bytes[0..8] == [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]
}

pub(crate) fn is_seven_zip(bytes: &[u8]) -> bool {
  bytes.len() >= 32 && bytes[0..6] == [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]
}

pub(crate) fn decode_oem_name(raw: &[u8]) -> String {
  raw.iter().take_while(|byte| **byte != 0).map(|byte| *byte as char).collect()
}

pub(crate) fn read_vint(bytes: &[u8], offset: usize) -> Option<(u64, usize)> {
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

pub(crate) fn scan_rar4_headers(bytes: &[u8], budget: &mut Budget) -> HeaderScan {
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

pub(crate) fn scan_rar5_headers(bytes: &[u8], budget: &mut Budget) -> HeaderScan {
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

pub(crate) fn read_rar5_file_name(bytes: &[u8], offset: usize) -> Option<(String, u64)> {
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

pub(crate) fn scan_seven_zip_headers(bytes: &[u8]) -> HeaderScan {
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

pub(crate) fn header_scan_finding(scan: HeaderScan, format: &str, budget: &mut Budget) -> Finding {
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

pub(crate) fn inspect_native_container(bytes: &[u8], depth: u32, budget: &mut Budget, format_label: &str) -> Option<Finding> {
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

pub(crate) fn inspect_rar(bytes: &[u8], budget: &mut Budget) -> Finding {
  let scan = if is_rar5(bytes) { scan_rar5_headers(bytes, budget) } else { scan_rar4_headers(bytes, budget) };
  header_scan_finding(scan, "RAR", budget)
}

pub(crate) fn inspect_seven_zip(bytes: &[u8], budget: &mut Budget) -> Finding {
  let scan = scan_seven_zip_headers(bytes);
  header_scan_finding(scan, "7z", budget)
}
