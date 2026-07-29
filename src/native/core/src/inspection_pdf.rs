use std::io::Read;
use crate::document_text::{extract_pdf_text, find_url_hosts, DocumentTextLimits};
use crate::pdf_vector::{rasterize_filled_rectangles, VectorRasterLimits};
use crate::visual::png_from_samples;
use crate::pdf_structure::{
  inspect_pdf_structure, needs_structural_escalation, PdfStructureLimits, PdfStructureOutcome,
};
use flate2::read::ZlibDecoder;
use crate::inspection_budgets::*;
use crate::inspection_verdict::*;
use crate::inspection_bytes::*;
use crate::inspection_ole::*;
use crate::inspection_indicators::*;

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

pub(crate) fn pdf_action_indicators(text: &[u8]) -> bool {
  contains_with_trailing_boundary(text, b"/JavaScript")
    || contains_with_trailing_boundary(text, b"/JS")
    || contains(text, b"/OpenAction")
    || contains(text, b"/Launch")
    || contains_with_trailing_boundary(text, b"/AA")
    || contains(text, b"/EmbeddedFile")
    || contains(text, b"/RichMedia")
    || has_obfuscated_pdf_action_name(text)
}

pub(crate) fn is_pdf(bytes: &[u8]) -> bool {
  bytes.len() >= 5 && &bytes[..5] == b"%PDF-"
}

pub(crate) fn inflate_zlib(data: &[u8], max_output: u64) -> Option<Vec<u8>> {
  let mut out = Vec::new();
  let mut decoder = ZlibDecoder::new(data).take(max_output + 1);
  decoder.read_to_end(&mut out).ok()?;
  if out.len() as u64 > max_output {
    return None;
  }
  Some(out)
}

pub(crate) fn pdf_stream_payload(bytes: &[u8], keyword_end: usize) -> Option<(&[u8], usize)> {
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

pub(crate) fn pdf_dictionary_number(dictionary: &[u8], key: &[u8]) -> Option<u32> {
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

pub(crate) fn pdf_text_link_indicators(content: &[u8]) -> Vec<String> {
  let limits = DocumentTextLimits::default();
  let text = extract_pdf_text(content, &limits);
  if text.is_empty() {
    return Vec::new();
  }
  let mut indicators: Vec<String> = Vec::new();
  for host in find_url_hosts(&text, &limits) {
    indicators.push(format!("link in textul vizibil al documentului catre {host}"));
    for semnal in host_identity_indicators(&host) {
      indicators.push(format!("{semnal} (gazda din textul documentului)"));
    }
  }
  indicators
}

pub(crate) fn pdf_vector_code_indicators(content: &[u8]) -> Vec<String> {
  if !contains(content, b" re") {
    return Vec::new();
  }
  let Some(raster) = rasterize_filled_rectangles(content, &VectorRasterLimits::default()) else {
    return Vec::new();
  };
  match png_from_samples(raster.width, raster.height, 1, &raster.samples) {
    Some(png) => visual_indicators(&png)
      .into_iter()
      .map(|entry| format!("{entry} (desenat vectorial in pagina PDF)"))
      .collect(),
    None => Vec::new()
  }
}

pub(crate) fn pdf_image_indicators(dictionary: &[u8], samples: &[u8]) -> Vec<String> {
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

pub(crate) fn pdf_structural_indicators(bytes: &[u8], budget: &mut Budget) -> Vec<String> {
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
        indicators.extend(pdf_vector_code_indicators(&decoded));
        indicators.extend(pdf_text_link_indicators(&decoded));
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

pub(crate) fn pdf_deep_indicators(bytes: &[u8], budget: &mut Budget) -> Option<(Vec<String>, bool, String)> {
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
