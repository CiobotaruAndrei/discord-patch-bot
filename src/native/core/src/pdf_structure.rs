pub struct PdfStructureLimits {
  pub max_objects: u32,
  pub max_streams: u32,
  pub max_decoded_bytes: u64,
  pub max_stream_raw_bytes: usize,
  pub max_depth: u32,
  pub timeout_ms: u64,
}

impl Default for PdfStructureLimits {
  fn default() -> Self {
    Self {
      max_objects: 512,
      max_streams: 64,
      max_decoded_bytes: 8 * 1024 * 1024,
      max_stream_raw_bytes: 64 * 1024,
      max_depth: 8,
      timeout_ms: 100,
    }
  }
}

pub struct PdfStructureReport {
  pub indicators: Vec<String>,
  pub object_count: u32,
  pub stream_count: u32,
  pub decoded_bytes: u64,
  pub encrypted: bool,
  pub complete: bool,
  pub stop_reason: String,
  pub pdf_version: String,
  pub revisions: u32,
}

pub enum PdfStructureOutcome {
  Unavailable(String),
  Failed(String),
  Analyzed(PdfStructureReport),
}

pub fn qpdf_available() -> bool {
  cfg!(feature = "qpdf")
}

pub fn count_revisions(bytes: &[u8]) -> u32 {
  let needle = b"startxref";
  if bytes.len() < needle.len() {
    return 0;
  }
  bytes.windows(needle.len()).filter(|window| *window == needle).count() as u32
}

pub fn needs_structural_escalation(bytes: &[u8]) -> bool {
  const MARKERS: &[&[u8]] = &[
    b"/Encrypt",
    b"/ObjStm",
    b"/XRefStm",
    b"/LZWDecode",
    b"/ASCII85Decode",
    b"/ASCIIHexDecode",
    b"/RunLengthDecode",
    b"/DCTDecode",
    b"/CCITTFaxDecode",
    b"/JBIG2Decode",
    b"/Crypt",
  ];
  if MARKERS.iter().any(|marker| window_contains(bytes, marker)) {
    return true;
  }
  count_revisions(bytes) > 1
}

fn window_contains(haystack: &[u8], needle: &[u8]) -> bool {
  if needle.is_empty() || haystack.len() < needle.len() {
    return false;
  }
  haystack.windows(needle.len()).any(|window| window == needle)
}

const ACTION_KEYS: &[(&str, &str)] = &[
  ("OpenAction", "actiune automata la deschidere (graf de obiecte qpdf)"),
  ("AA", "actiune automata pe eveniment (graf de obiecte qpdf)"),
  ("JavaScript", "JavaScript inregistrat in arborele de nume (qpdf)"),
  ("JS", "JavaScript atasat unei actiuni (qpdf)"),
  ("Launch", "actiune de lansare de proces (qpdf)"),
  ("EmbeddedFiles", "fisiere incorporate declarate in arborele de nume (qpdf)"),
  ("EmbeddedFile", "fisier incorporat (qpdf)"),
  ("RichMedia", "continut RichMedia incorporat (qpdf)"),
  ("GoToR", "actiune catre un document extern (qpdf)"),
  ("SubmitForm", "formular care trimite date catre exterior (qpdf)"),
  ("ImportData", "actiune de import de date externe (qpdf)"),
  ("XFA", "formular XFA cu potential de script (qpdf)"),
  ("URI", "referinta URI in actiune de document (qpdf)"),
];

#[cfg(feature = "qpdf")]
mod engine {
  use super::*;
  use qpdf::{QPdf, QPdfObject, QPdfObjectLike, QPdfObjectType, StreamDecodeLevel};
  use std::time::Instant;

  struct Walk<'a, F: FnMut(&str, &[u8])> {
    limits: &'a PdfStructureLimits,
    started: Instant,
    visited: Vec<(u32, u32)>,
    indicators: Vec<String>,
    object_count: u32,
    stream_count: u32,
    decoded_bytes: u64,
    stop_reason: String,
    on_stream: F,
  }

  impl<F: FnMut(&str, &[u8])> Walk<'_, F> {
    fn exhausted(&mut self) -> bool {
      if !self.stop_reason.is_empty() {
        return true;
      }
      if self.object_count >= self.limits.max_objects {
        self.stop_reason = format!("PDF depaseste limita de {} obiecte", self.limits.max_objects);
        return true;
      }
      if self.decoded_bytes > self.limits.max_decoded_bytes {
        self.stop_reason = format!("PDF depaseste limita de {} bytes decodati", self.limits.max_decoded_bytes);
        return true;
      }
      if self.started.elapsed().as_millis() as u64 > self.limits.timeout_ms {
        self.stop_reason = format!("analiza structurala PDF a depasit {} ms", self.limits.timeout_ms);
        return true;
      }
      false
    }

    fn seen(&mut self, object: &QPdfObject) -> bool {
      if !object.is_indirect() {
        return false;
      }
      let key = (object.get_id(), object.get_generation());
      if self.visited.contains(&key) {
        return true;
      }
      self.visited.push(key);
      false
    }

    fn note(&mut self, indicator: &str) {
      if !self.indicators.iter().any(|existing| existing == indicator) {
        self.indicators.push(indicator.to_string());
      }
    }

    fn stream(&mut self, object: QPdfObject) {
      if self.stream_count >= self.limits.max_streams {
        self.stop_reason = format!("PDF depaseste limita de {} fluxuri", self.limits.max_streams);
        return;
      }
      let stream: qpdf::QPdfStream = object.clone().into();
      let dictionary = stream.get_dictionary();
      if let Some(filter) = dictionary.get("/Filter") {
        let label = filter_label(&filter);
        if !label.is_empty() && label != "/FlateDecode" {
          self.note(&format!("flux PDF cu filtru {label} decodat de qpdf"));
        }
      }
      self.stream_count += 1;
      let raw = match stream.get_data(StreamDecodeLevel::None) {
        Ok(raw) => raw,
        Err(_) => {
          self.note("flux PDF ilizibil chiar si nedecodat (qpdf)");
          return;
        }
      };
      if raw.len() > self.limits.max_stream_raw_bytes {
        self.note("flux PDF peste plafonul de decodare; continutul nu a fost inspectat");
        return;
      }
      match stream.get_data(StreamDecodeLevel::Generalized) {
        Ok(decoded) => {
          self.decoded_bytes += decoded.len() as u64;
          let name = format!("obiect {} 0 R", object.get_id());
          (self.on_stream)(&name, decoded.as_ref());
        }
        Err(_) => self.note("flux PDF cu filtru nesuportat sau corupt (qpdf)"),
      }
    }

    fn visit(&mut self, object: QPdfObject, depth: u32) {
      if depth > self.limits.max_depth || self.exhausted() || self.seen(&object) {
        return;
      }
      self.object_count += 1;
      match object.get_type() {
        QPdfObjectType::Dictionary => {
          let dictionary: qpdf::QPdfDictionary = object.clone().into();
          for key in dictionary.keys() {
            let bare = key.trim_start_matches('/');
            if let Some((_, message)) = ACTION_KEYS.iter().find(|(name, _)| *name == bare) {
              self.note(message);
            }
            if let Some(value) = dictionary.get(&key) {
              self.visit(value, depth + 1);
            }
          }
        }
        QPdfObjectType::Array => {
          let array: qpdf::QPdfArray = object.clone().into();
          for item in array.iter() {
            self.visit(item, depth + 1);
          }
        }
        QPdfObjectType::Stream => {
          let dictionary = {
            let stream: qpdf::QPdfStream = object.clone().into();
            stream.get_dictionary()
          };
          self.stream(object);
          for key in dictionary.keys() {
            let bare = key.trim_start_matches('/');
            if let Some((_, message)) = ACTION_KEYS.iter().find(|(name, _)| *name == bare) {
              self.note(message);
            }
          }
        }
        QPdfObjectType::Name => {
          let name = object.as_name();
          let bare = name.trim_start_matches('/');
          if let Some((_, message)) = ACTION_KEYS.iter().find(|(key, _)| *key == bare) {
            self.note(message);
          }
        }
        _ => {}
      }
    }
  }

  fn filter_label(filter: &QPdfObject) -> String {
    match filter.get_type() {
      QPdfObjectType::Name => filter.as_name(),
      QPdfObjectType::Array => {
        let array: qpdf::QPdfArray = filter.clone().into();
        let names: Vec<String> = array
          .iter()
          .filter(|item| item.get_type() == QPdfObjectType::Name)
          .map(|item| item.as_name())
          .collect();
        names.join(" + ")
      }
      _ => String::new(),
    }
  }

  pub fn inspect<F: FnMut(&str, &[u8])>(
    bytes: &[u8],
    limits: &PdfStructureLimits,
    on_stream: F,
  ) -> PdfStructureOutcome {
    let strict = QPdf::read_from_memory(bytes);
    let (pdf, complete) = match strict {
      Ok(pdf) => (pdf, true),
      Err(error) => {
        if error.to_string().contains("InvalidPassword") {
          return PdfStructureOutcome::Analyzed(PdfStructureReport {
            indicators: vec!["PDF criptat cu parola; continutul nu poate fi inspectat local".to_string()],
            object_count: 0,
            stream_count: 0,
            decoded_bytes: 0,
            encrypted: true,
            complete: false,
            stop_reason: "PDF protejat cu parola".to_string(),
            pdf_version: String::new(),
            revisions: count_revisions(bytes),
          });
        }
        return PdfStructureOutcome::Failed(error.to_string());
      }
    };

    let mut walk = Walk {
      limits,
      started: Instant::now(),
      visited: Vec::new(),
      indicators: Vec::new(),
      object_count: 0,
      stream_count: 0,
      decoded_bytes: 0,
      stop_reason: String::new(),
      on_stream,
    };

    let encrypted = pdf.is_encrypted();
    if encrypted {
      walk.note("PDF criptat deschis fara parola; continutul ramane neconfirmat");
    }
    let revisions = count_revisions(bytes);
    if revisions > 1 {
      walk.note("PDF cu actualizari incrementale; obiecte pot fi suprascrise dupa semnare");
    }
    if let Some(trailer) = pdf.get_trailer() {
      walk.visit(trailer.into(), 0);
    }
    if let Some(root) = pdf.get_root() {
      walk.visit(root.into(), 0);
    }

    PdfStructureOutcome::Analyzed(PdfStructureReport {
      indicators: walk.indicators,
      object_count: walk.object_count,
      stream_count: walk.stream_count,
      decoded_bytes: walk.decoded_bytes,
      encrypted,
      complete: complete && walk.stop_reason.is_empty(),
      stop_reason: walk.stop_reason,
      pdf_version: pdf.get_pdf_version(),
      revisions,
    })
  }
}

#[cfg(not(feature = "qpdf"))]
mod engine {
  use super::*;

  pub fn inspect<F: FnMut(&str, &[u8])>(
    _bytes: &[u8],
    _limits: &PdfStructureLimits,
    _on_stream: F,
  ) -> PdfStructureOutcome {
    PdfStructureOutcome::Unavailable(
      "analiza structurala qpdf nu este compilata in acest build (feature `qpdf` dezactivat)".to_string(),
    )
  }
}

pub fn inspect_pdf_structure<F: FnMut(&str, &[u8])>(
  bytes: &[u8],
  limits: &PdfStructureLimits,
  on_stream: F,
) -> PdfStructureOutcome {
  engine::inspect(bytes, limits, on_stream)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn revisions_are_counted_from_the_startxref_markers() {
    assert_eq!(count_revisions(b"%PDF-1.7\nstartxref\n0\n%%EOF\n"), 1);
    assert_eq!(count_revisions(b"%PDF-1.7\nstartxref\n0\n%%EOF\nstartxref\n9\n%%EOF\n"), 2);
    assert_eq!(count_revisions(b"%PDF-1.7\n"), 0);
  }

  #[test]
  fn escalation_triggers_only_on_structures_the_fast_path_cannot_read() {
    assert!(!needs_structural_escalation(b"%PDF-1.7 << /Type /Catalog /Filter /FlateDecode >>"));
    assert!(needs_structural_escalation(b"%PDF-1.7 << /Encrypt 5 0 R >>"));
    assert!(needs_structural_escalation(b"%PDF-1.7 << /Type /ObjStm >>"));
    assert!(needs_structural_escalation(b"%PDF-1.7 << /Filter /LZWDecode >>"));
    assert!(needs_structural_escalation(b"startxref\n0\nstartxref\n1\n"));
  }

  #[cfg(feature = "qpdf")]
  fn build_pdf(objects: &[&str], root: u32) -> Vec<u8> {
    let mut out = String::from("%PDF-1.7
");
    let mut offsets: Vec<usize> = Vec::new();
    for (index, body) in objects.iter().enumerate() {
      offsets.push(out.len());
      out.push_str(&format!("{} 0 obj
{}
endobj
", index + 1, body));
    }
    let xref = out.len();
    out.push_str(&format!("xref
0 {}
0000000000 65535 f 
", objects.len() + 1));
    for offset in &offsets {
      out.push_str(&format!("{offset:010} 00000 n 
"));
    }
    out.push_str(&format!(
      "trailer
<< /Size {} /Root {} 0 R >>
startxref
{}
%%EOF
",
      objects.len() + 1,
      root,
      xref
    ));
    out.into_bytes()
  }

  #[cfg(feature = "qpdf")]
  #[test]
  fn an_open_action_reachable_only_through_the_object_graph_is_reported() {
    let pdf = build_pdf(
      &[
        "<< /Type /Catalog /Pages 2 0 R /OpenAction 3 0 R >>",
        "<< /Type /Pages /Kids [] /Count 0 >>",
        r"<< /S /JavaScript /JS (app.alert\(1\)) >>",
      ],
      1,
    );
    let mut seen: Vec<String> = Vec::new();
    let outcome = inspect_pdf_structure(&pdf, &PdfStructureLimits::default(), |name, _payload| {
      seen.push(name.to_string());
    });
    match outcome {
      PdfStructureOutcome::Analyzed(report) => {
        assert!(report.indicators.iter().any(|entry| entry.contains("actiune automata la deschidere")));
        assert!(report.indicators.iter().any(|entry| entry.contains("JavaScript")));
        assert!(report.object_count > 0);
        assert!(report.complete, "un PDF valid este raportat ca structura completa");
        assert!(!report.encrypted);
      }
      PdfStructureOutcome::Failed(detail) => panic!("analiza a esuat: {detail}"),
      PdfStructureOutcome::Unavailable(detail) => panic!("motor indisponibil: {detail}"),
    }
  }

  #[cfg(feature = "qpdf")]
  #[test]
  fn stream_payloads_are_handed_back_decoded_for_nested_inspection() {
    let payload = "MZ executabil ascuns intr-un flux PDF";
    let pdf = build_pdf(
      &[
        "<< /Type /Catalog /Pages 2 0 R /Names 3 0 R >>",
        "<< /Type /Pages /Kids [] /Count 0 >>",
        "<< /EmbeddedFiles 4 0 R >>",
        &format!("<< /Length {} >>
stream
{}
endstream", payload.len(), payload),
      ],
      1,
    );
    let mut decoded: Vec<Vec<u8>> = Vec::new();
    let outcome = inspect_pdf_structure(&pdf, &PdfStructureLimits::default(), |_name, bytes| {
      decoded.push(bytes.to_vec());
    });
    match outcome {
      PdfStructureOutcome::Analyzed(report) => {
        assert!(report.indicators.iter().any(|entry| entry.contains("fisiere incorporate")));
        assert!(
          decoded.iter().any(|bytes| bytes.starts_with(b"MZ")),
          "continutul fluxului ajunge inapoi la motorul Rust pentru inspectie recursiva"
        );
        assert!(report.decoded_bytes > 0);
      }
      PdfStructureOutcome::Failed(detail) => panic!("analiza a esuat: {detail}"),
      PdfStructureOutcome::Unavailable(detail) => panic!("motor indisponibil: {detail}"),
    }
  }

  #[cfg(feature = "qpdf")]
  #[test]
  fn a_stream_over_the_raw_cap_is_flagged_instead_of_being_decoded() {
    let payload = "A".repeat(4096);
    let pdf = build_pdf(
      &[
        "<< /Type /Catalog /Pages 2 0 R /Names 3 0 R >>",
        "<< /Type /Pages /Kids [] /Count 0 >>",
        "<< /EmbeddedFiles 4 0 R >>",
        &format!("<< /Length {} >>
stream
{}
endstream", payload.len(), payload),
      ],
      1,
    );
    let limits = PdfStructureLimits { max_stream_raw_bytes: 128, ..PdfStructureLimits::default() };
    let mut decoded = 0usize;
    let outcome = inspect_pdf_structure(&pdf, &limits, |_name, _bytes| decoded += 1);
    match outcome {
      PdfStructureOutcome::Analyzed(report) => {
        assert_eq!(decoded, 0, "fluxul peste plafon nu este decodat deloc");
        assert!(report.indicators.iter().any(|entry| entry.contains("peste plafonul de decodare")));
      }
      other => panic!("asteptam Analyzed: {}", match other {
        PdfStructureOutcome::Failed(detail) => detail,
        PdfStructureOutcome::Unavailable(detail) => detail,
        PdfStructureOutcome::Analyzed(_) => unreachable!(),
      }),
    }
  }

  #[cfg(feature = "qpdf")]
  #[test]
  fn a_pdf_that_qpdf_cannot_parse_is_reported_as_failed_with_a_reason() {
    let outcome = inspect_pdf_structure(b"%PDF-1.7
nimic valid aici
", &PdfStructureLimits::default(), |_n, _b| {});
    match outcome {
      PdfStructureOutcome::Failed(detail) => assert!(!detail.is_empty(), "esecul poarta un motiv, nu e tacut"),
      PdfStructureOutcome::Analyzed(report) => {
        assert!(!report.complete || report.object_count <= 1, "un PDF fara catalog nu poate raporta o structura bogata");
      }
      PdfStructureOutcome::Unavailable(detail) => panic!("motor indisponibil: {detail}"),
    }
  }

  #[cfg(feature = "qpdf")]
  #[test]
  fn a_reference_cycle_terminates_instead_of_recursing_forever() {
    let pdf = build_pdf(
      &["<< /Type /Catalog /Pages 2 0 R /Next 3 0 R >>", "<< /Type /Pages /Kids [] /Count 0 >>", "<< /Back 1 0 R >>"],
      1,
    );
    let outcome = inspect_pdf_structure(&pdf, &PdfStructureLimits::default(), |_n, _b| {});
    match outcome {
      PdfStructureOutcome::Analyzed(report) => {
        assert!(report.object_count < PdfStructureLimits::default().max_objects, "ciclul e oprit de setul de obiecte vizitate");
      }
      PdfStructureOutcome::Failed(detail) => panic!("analiza a esuat: {detail}"),
      PdfStructureOutcome::Unavailable(detail) => panic!("motor indisponibil: {detail}"),
    }
  }
}
