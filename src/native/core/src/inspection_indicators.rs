use crate::code_disassembly::{disassemble_code, DisassemblyLimits, DisassemblyOutcome};
use crate::executable::{
  analysis_blind_spots, analyze_executable, locate_code_region, looks_like_executable, ExecutableLimits,
  ExecutableOutcome,
};
use crate::document_text::{find_url_hosts, DocumentTextLimits};
use crate::visual::{embedded_jpeg_preview, iso_bmff_image_brand, looks_like_image, scan_visual_codes, VisualLimits, VisualOutcome};
use crate::inspection_budgets::*;
use crate::inspection_verdict::*;
use crate::inspection_bytes::*;
use crate::inspection_pdf::*;
use crate::inspection_ole::*;

#[cfg(feature = "url-identity")]
pub(crate) fn host_identity_indicators(host: &str) -> Vec<String> {
  crate::url_identity::analyze_url_host(host, &[]).indicators
}

#[cfg(not(feature = "url-identity"))]
pub(crate) fn host_identity_indicators(_host: &str) -> Vec<String> {
  Vec::new()
}

pub(crate) const STANDARDS_HOSTS: &[&str] = &[
  "schemas.openxmlformats.org",
  "schemas.microsoft.com",
  "purl.org",
  "www.w3.org",
  "w3.org",
  "ns.adobe.com",
  "iptc.org",
  "xmlns.com",
  "docs.oasis-open.org",
  "relaxng.org"
];

pub(crate) fn is_standards_host(host: &str) -> bool {
  STANDARDS_HOSTS.iter().any(|known| host == *known || host.ends_with(&format!(".{known}")))
}

pub(crate) fn text_link_indicators(bytes: &[u8]) -> Vec<String> {
  let window = &bytes[..bytes.len().min(TEXT_LINK_SCAN_BYTES)];
  if !window.windows(4).any(|slice| slice == b"http") {
    return Vec::new();
  }
  let text = String::from_utf8_lossy(window);
  let mut indicators: Vec<String> = Vec::new();
  for host in find_url_hosts(&text, &DocumentTextLimits::default()) {
    if is_standards_host(&host) {
      continue;
    }
    indicators.push(format!("link in textul documentului catre {host}"));
    for semnal in host_identity_indicators(&host) {
      indicators.push(format!("{semnal} (gazda din textul documentului)"));
    }
  }
  indicators
}

pub(crate) fn name_indicators(name: &str) -> Vec<String> {
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

pub(crate) fn content_indicators(name: &str, bytes: &[u8], budget: &mut Budget) -> Vec<String> {
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
  indicators.extend(text_link_indicators(bytes));
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

pub(crate) const DISASSEMBLY_EXPLAINED_SPOTS: [&str; 2] =
  ["cod fara importuri rezolvabile", "executabil fara niciun indicator structural"];

pub(crate) fn disassembly_indicators(bytes: &[u8]) -> Vec<String> {
  let Some(region) = locate_code_region(bytes, &ExecutableLimits::default()) else {
    return Vec::new();
  };
  let end = region.offset.saturating_add(region.size).min(bytes.len());
  if end <= region.offset {
    return Vec::new();
  }
  match disassemble_code(
    &bytes[region.offset..end],
    &region.architecture,
    region.address,
    &DisassemblyLimits::default(),
  ) {
    DisassemblyOutcome::Analyzed(report) => report.indicators,
    DisassemblyOutcome::Unavailable(_)
    | DisassemblyOutcome::UnsupportedArchitecture(_)
    | DisassemblyOutcome::Failed(_) => Vec::new(),
  }
}

pub(crate) fn executable_blind_spots(bytes: &[u8]) -> Vec<String> {
  if !looks_like_executable(bytes) {
    return Vec::new();
  }
  match analyze_executable(bytes, &ExecutableLimits::default()) {
    ExecutableOutcome::Analyzed(report) => {
      let mut spots = analysis_blind_spots(&report);
      if !disassembly_indicators(bytes).is_empty() {
        spots.retain(|spot| !DISASSEMBLY_EXPLAINED_SPOTS.contains(&spot.as_str()));
      }
      spots
    }
    _ => Vec::new()
  }
}

pub(crate) fn executable_indicators(bytes: &[u8]) -> Vec<String> {
  if !looks_like_executable(bytes) {
    return Vec::new();
  }
  match analyze_executable(bytes, &ExecutableLimits::default()) {
    ExecutableOutcome::Analyzed(report) => {
      let mut indicators = report.indicators;
      if report.is_library {
        indicators.push(format!("biblioteca {} interna, nu executabil de sine statator", report.format));
      }
      indicators.extend(disassembly_indicators(bytes));
      indicators
    }
    ExecutableOutcome::Failed(_) | ExecutableOutcome::Unavailable(_) | ExecutableOutcome::NotExecutable => Vec::new(),
  }
}

pub(crate) fn iso_bmff_visual_indicators(bytes: &[u8]) -> Vec<String> {
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

pub(crate) fn visual_indicators(bytes: &[u8]) -> Vec<String> {
  if !looks_like_image(bytes) {
    return iso_bmff_visual_indicators(bytes);
  }
  match scan_visual_codes(bytes, &VisualLimits::default()) {
    VisualOutcome::Scanned { indicators, .. } => indicators,
    VisualOutcome::Failed(_) | VisualOutcome::Unavailable(_) | VisualOutcome::NotImage => Vec::new(),
  }
}

pub(crate) const VIDEO_BRANDS: &[&[u8; 4]] = &[b"isom", b"iso2", b"mp41", b"mp42", b"qt  ", b"M4V ", b"3gp4"];

#[cfg(test)]
mod tests {
  use super::*;


  #[cfg(all(feature = "executable", feature = "disassembly"))]
  fn pe_cu_cod(inceput: &[u8]) -> Vec<u8> {
    let mut cod = inceput.to_vec();
    cod.resize(8192, 0x90);
    crate::executable::tests::minimal_pe(".text", &cod, 0x6000_0020)
  }

  #[cfg(all(feature = "executable", feature = "disassembly"))]
  #[test]
  fn dezasamblarea_explica_un_executabil_fara_tabela_de_importuri() {
    let pe = pe_cu_cod(&[0x65, 0x48, 0x8b, 0x04, 0x25, 0x60, 0x00, 0x00, 0x00]);

    let gasite = executable_indicators(&pe);
    assert!(
      gasite.iter().any(|indicator| indicator.contains("PEB")),
      "codul care isi cauta singur functiile trebuie sa apara ca indicator, nu doar ca lipsa de informatie: {gasite:?}"
    );

    let puncte_oarbe = executable_blind_spots(&pe);
    assert!(
      !puncte_oarbe.iter().any(|spot| spot == "cod fara importuri rezolvabile"),
      "punctul orb exista fiindca nu citeam instructiunile; odata citite, nu mai are ce raporta: {puncte_oarbe:?}"
    );
  }

  #[cfg(all(feature = "executable", feature = "disassembly"))]
  #[test]
  fn un_executabil_pe_care_dezasamblarea_nu_il_explica_ramane_punct_orb() {
    let pe = pe_cu_cod(&[0x55, 0x48, 0x89, 0xe5, 0x5d, 0xc3]);
    let puncte_oarbe = executable_blind_spots(&pe);
    assert!(
      puncte_oarbe.iter().any(|spot| spot == "cod fara importuri rezolvabile"),
      "cand instructiunile nu spun nimic, punctul orb trebuie sa ramana; altfel am inlocuit o necunoscuta cu o certitudine falsa: {puncte_oarbe:?}"
    );
  }
}
