use crate::executable::looks_like_executable;
use crate::similarity_corpus::known_sample_indicators;
use crate::visual::{iso_bmff_image_brand, looks_like_image};
use std::time::Instant;
use crate::inspection_budgets::*;
use crate::inspection_verdict::*;
use crate::inspection_pdf::*;
use crate::inspection_ole::*;
use crate::inspection_archives::*;
use crate::inspection_indicators::*;

pub(crate) fn inspect_nested(name: &str, bytes: &[u8], depth: u32, budget: &mut Budget) -> Finding {
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

pub fn container_signature(bytes: &[u8]) -> Option<&'static str> {
  const SIGNATURES: &[(&[u8], &str)] = &[
    (&[0x4d, 0x53, 0x43, 0x46], "CAB"),
    (&[0x49, 0x54, 0x53, 0x46], "CHM"),
    (&[0x53, 0x5a, 0x44, 0x44, 0x88, 0xf0, 0x27, 0x33], "SZDD"),
    (&[0x4b, 0x57, 0x41, 0x4a, 0x88, 0xf0, 0x27, 0xd1], "KWAJ"),
    (&[0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], "XZ"),
    (&[0x28, 0xb5, 0x2f, 0xfd], "Zstandard"),
    (&[0x04, 0x22, 0x4d, 0x18], "LZ4"),
    (&[0x1f, 0xa0], "compress LZH"),
    (&[0x1f, 0x9d], "compress LZW")
  ];
  for (magic, label) in SIGNATURES {
    if bytes.starts_with(magic) {
      return Some(label);
    }
  }
  if bytes.len() >= 4 && &bytes[0..3] == b"BZh" && bytes[3].is_ascii_digit() && bytes[3] != b'0' {
    return Some("bzip2");
  }
  None
}

pub(crate) fn looks_like_archive(bytes: &[u8], filename: &str, mime: &str) -> bool {
  if is_zip(bytes) || is_gzip(bytes) || is_tar(bytes) {
    return true;
  }
  if bytes.len() >= 7 && &bytes[0..6] == b"Rar!\x1a\x07" {
    return true;
  }
  if bytes.len() >= 6 && bytes[0..6] == [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] {
    return true;
  }
  if container_signature(bytes).is_some() {
    return true;
  }
  let lower_name = filename.to_lowercase();
  let lower_mime = mime.to_lowercase();
  const ARCHIVE_EXTENSIONS: &[&str] =
    &[".zip", ".tar", ".gz", ".tgz", ".rar", ".7z", ".bz2", ".xz", ".cab", ".chm", ".zst", ".lz4"];
  if ARCHIVE_EXTENSIONS.iter().any(|extension| lower_name.ends_with(extension)) {
    return true;
  }
  ["zip", "tar", "gzip", "x-rar", "7z", "compressed"].iter().any(|token| lower_mime.contains(token))
}

pub(crate) fn document_finding(bytes: &[u8], budget: &mut Budget) -> Finding {
  let mut indicators = document_indicators(bytes);
  indicators.extend(executable_indicators(bytes));
  indicators.extend(visual_indicators(bytes));
  indicators.extend(text_link_indicators(bytes));
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

pub fn uninspectable_format(bytes: &[u8], filename: &str, mime: &str) -> Option<String> {
  if let Some(label) = container_signature(bytes) {
    return Some(label.to_string());
  }
  if let Some(brand) = iso_bmff_image_brand(bytes) {
    return Some(brand.to_string());
  }
  if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
    let candidate = &bytes[8..12];
    if VIDEO_BRANDS.iter().any(|brand| *brand == candidate) {
      return Some("video ISO-BMFF".to_string());
    }
  }
  if bytes.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]) {
    return Some("video Matroska".to_string());
  }
  if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"AVI " {
    return Some("video AVI".to_string());
  }
  if is_rar4(bytes) || is_rar5(bytes) {
    return Some("RAR".to_string());
  }
  if is_seven_zip(bytes) {
    return Some("7z".to_string());
  }
  if looks_like_archive(bytes, filename, mime) {
    return Some("arhiva necunoscuta".to_string());
  }
  None
}

pub fn inspect_untrusted_content(
  bytes: &[u8],
  filename: &str,
  mime: &str,
  mode: &str,
  limits: InspectionLimits,
) -> InspectionReport {
  let started = Instant::now();
  let mut imagine_fara_cod = false;
  let mut decodor_nativ_esuat: Option<&str> = None;
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
    inspect_native_container(bytes, 0, &mut budget, "RAR").unwrap_or_else(|| {
      decodor_nativ_esuat = Some("RAR");
      inspect_rar(bytes, &mut budget)
    })
  } else if is_seven_zip(bytes) {
    inspect_native_container(bytes, 0, &mut budget, "7z").unwrap_or_else(|| {
      decodor_nativ_esuat = Some("7z");
      inspect_seven_zip(bytes, &mut budget)
    })
  } else if looks_like_image(bytes) {
    let indicators = dedupe(visual_indicators(bytes));
    let reason = if indicators.is_empty() {
      "imagine scanata fara coduri vizuale".to_string()
    } else {
      "imagine scanata cu coduri vizuale".to_string()
    };
    imagine_fara_cod = indicators.is_empty() && bytes.len() >= IMAGE_TEXT_BLIND_SPOT_BYTES;
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
    match ms_container_indicators(bytes) {
      decomprimate if !decomprimate.is_empty() => Finding {
        uncertain: false,
        indicators: decomprimate,
        reason: "container Microsoft decomprimat, continutul intrarilor a fost citit".to_string()
      },
      _ => uncertain(
        "formatul arhivei nu are un decodor pasiv local; verdictul ramane neconfirmat".to_string(),
        chm_indicators(bytes)
      )
    }
  } else {
    document_finding(bytes, &mut budget)
  };
  let mostra_cunoscuta = known_sample_indicators(bytes);
  let format_neinspectat = match uninspectable_format(bytes, filename, mime) {
    Some(label) if finding.uncertain || label.starts_with("video") || iso_bmff_image_brand(bytes).is_some() => Some(label),
    _ => None
  };
  InspectionReport {
    status: if finding.uncertain { "uncertain".to_string() } else { "inspected".to_string() },
    indicators: {
      let mut toti = finding.indicators;
      toti.extend(mostra_cunoscuta);
      dedupe(toti)
    },
    reason: finding.reason,
    entries_inspected: budget.entries,
    expanded_bytes: budget.expanded_bytes,
    elapsed_ms: started.elapsed().as_secs_f64() * 1000.0,
    uninspectable_format: format_neinspectat,
    analysis_blind_spots: {
      let mut spots = executable_blind_spots(bytes);
      if let Some(format) = decodor_nativ_esuat {
        spots.push(format!("{format} deschis doar la nivel de header, decodorul nativ a esuat"));
      }
      if imagine_fara_cod {
        spots.push("imagine fara cod vizual, text posibil necitit".to_string());
      }
      spots
    },
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

  fn report(bytes: &[u8], filename: &str, mime: &str, mode: &str) -> InspectionReport {
    inspect_untrusted_content(bytes, filename, mime, mode, InspectionLimits::default())
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
}
