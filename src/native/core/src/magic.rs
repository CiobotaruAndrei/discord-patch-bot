use crate::magic_signatures::*;
use crate::magic_mime_table::*;
use crate::magic_encoding::*;

pub const MISMATCH_EXTENSION: u32 = 1;

pub const MISMATCH_DECLARED_MIME: u32 = 2;

pub const MISMATCH_POLYGLOT: u32 = 4;

pub const MISMATCH_DISGUISED_EXECUTABLE: u32 = 8;

pub const MISMATCH_TRUNCATED: u32 = 16;

pub struct MagicReport {
  pub mime: String,
  pub description: String,
  pub encoding: String,
  pub kind: String,
  pub extension_mime: String,
  pub declared_mime: String,
  pub mismatch_flags: u32,
}

pub fn libmagic_available() -> bool {
  cfg!(feature = "magic") && libmagic_probe()
}

#[cfg(feature = "magic")]
mod libmagic {
  use magic::cookie::{Cookie, DatabasePaths, Flags, Load};
  use std::cell::RefCell;

  thread_local! {
    static ENGINE: RefCell<Option<Option<Cookie<Load>>>> = const { RefCell::new(None) };
  }

  fn load_from_default() -> Option<Cookie<Load>> {
    Cookie::open(Flags::ERROR).ok()?.load(&DatabasePaths::default()).ok()
  }

  fn load_from_env() -> Option<Cookie<Load>> {
    let path = std::env::var_os("DPB_MAGIC_DB")?;
    let paths = DatabasePaths::new([path]).ok()?;
    Cookie::open(Flags::ERROR).ok()?.load(&paths).ok()
  }

  fn open() -> Option<Cookie<Load>> {
    load_from_default().or_else(load_from_env)
  }

  fn describe(cookie: &Cookie<Load>, bytes: &[u8], flags: Flags) -> Option<String> {
    cookie.set_flags(flags | Flags::ERROR).ok()?;
    cookie.buffer(bytes).ok()
  }

  pub fn detect(bytes: &[u8]) -> Option<(String, String)> {
    ENGINE.with(|cell| {
      let mut slot = cell.borrow_mut();
      if slot.is_none() {
        *slot = Some(open());
      }
      let cookie = slot.as_ref().and_then(|inner| inner.as_ref())?;
      let mime = describe(cookie, bytes, Flags::MIME_TYPE)?;
      let description = describe(cookie, bytes, Flags::empty())?;
      Some((mime.trim().to_string(), description.trim().to_string()))
    })
  }

  pub fn probe() -> bool {
    ENGINE.with(|cell| {
      let mut slot = cell.borrow_mut();
      if slot.is_none() {
        *slot = Some(open());
      }
      matches!(slot.as_ref(), Some(Some(_)))
    })
  }
}

fn libmagic_probe() -> bool {
  #[cfg(feature = "magic")]
  {
    libmagic::probe()
  }
  #[cfg(not(feature = "magic"))]
  {
    false
  }
}

#[derive(Clone)]
struct TypeVerdict {
  mime: String,
  description: String,
  kind: String,
  concrete: bool,
}

#[cfg(feature = "magic")]
fn detect_type_via_libmagic(bytes: &[u8], encoding: &str) -> Option<TypeVerdict> {
  let (mime, description) = libmagic::detect(bytes)?;
  let mime = mime.split(';').next().unwrap_or("").trim().to_lowercase();
  if mime.is_empty() {
    return None;
  }
  let kind = kind_for_mime(&mime);
  let concrete = !is_generic_mime(&mime) && kind != "text";
  let kind = if !concrete && encoding == "binary" && is_generic_mime(&mime) { "other" } else { kind };
  Some(TypeVerdict { mime, description, kind: kind.to_string(), concrete })
}

fn detect_type_via_signatures(bytes: &[u8], encoding: &str) -> TypeVerdict {
  match detect_signature(bytes) {
    Some(found) => TypeVerdict {
      mime: found.mime.to_string(),
      description: found.description.to_string(),
      kind: found.kind.to_string(),
      concrete: true,
    },
    None if encoding != "binary" => TypeVerdict {
      mime: "text/plain".to_string(),
      description: "text simplu".to_string(),
      kind: "text".to_string(),
      concrete: false,
    },
    None => TypeVerdict {
      mime: "application/octet-stream".to_string(),
      description: "date binare neidentificate".to_string(),
      kind: "other".to_string(),
      concrete: false,
    },
  }
}

#[cfg(feature = "magic")]
fn combine_verdicts(engine: Option<TypeVerdict>, builtin: TypeVerdict) -> TypeVerdict {
  let Some(verdict) = engine else {
    return builtin;
  };
  if !verdict.concrete {
    return if builtin.concrete { builtin } else { verdict };
  }
  if is_refinable_container(&verdict.mime)
    && builtin.concrete
    && builtin.mime != verdict.mime
    && mime_family(&builtin.mime) == mime_family(&verdict.mime)
  {
    return builtin;
  }
  verdict
}

#[cfg(feature = "magic")]
fn detect_type(bytes: &[u8], encoding: &str) -> TypeVerdict {
  combine_verdicts(detect_type_via_libmagic(bytes, encoding), detect_type_via_signatures(bytes, encoding))
}

#[cfg(not(feature = "magic"))]
fn detect_type(bytes: &[u8], encoding: &str) -> TypeVerdict {
  detect_type_via_signatures(bytes, encoding)
}

pub fn inspect_magic(bytes: &[u8], filename: &str, declared_mime: &str) -> MagicReport {
  let normalized_declared = declared_mime.split(';').next().unwrap_or("").trim().to_lowercase();
  let extension = extension_of(filename);
  let extension_mime = mime_for_extension(&extension).to_string();
  let encoding = detect_encoding(bytes);

  let verdict = detect_type(bytes, encoding);
  let detected = verdict.concrete;
  let TypeVerdict { mime, description, kind, .. } = verdict;

  let mut mismatch_flags = 0u32;
  if !extension_mime.is_empty() && !compatible(&mime, &extension_mime) {
    mismatch_flags |= MISMATCH_EXTENSION;
  }
  if !normalized_declared.is_empty() && !compatible(&mime, &normalized_declared) {
    mismatch_flags |= MISMATCH_DECLARED_MIME;
  }
  if kind == "executable" && mismatch_flags & (MISMATCH_EXTENSION | MISMATCH_DECLARED_MIME) != 0 {
    mismatch_flags |= MISMATCH_DISGUISED_EXECUTABLE;
  }
  if detected && is_text_like(&extension_mime) && kind != "text" && kind != "script" {
    mismatch_flags |= MISMATCH_EXTENSION;
  }
  if looks_truncated(bytes, &kind, &mime) {
    mismatch_flags |= MISMATCH_TRUNCATED;
  }
  if detected && bytes.len() > 4 {
    let tail = &bytes[4..bytes.len().min(65_536)];
    if mime != "application/pdf" && crate::inspection_bytes::window_contains(tail, b"%PDF-") {
      mismatch_flags |= MISMATCH_POLYGLOT;
    }
    if !mime.starts_with("application/vnd.microsoft") && starts_with(bytes, b"PK\x03\x04") && crate::inspection_bytes::window_contains(&bytes[..bytes.len().min(1024)], b"This program cannot be run in DOS mode") {
      mismatch_flags |= MISMATCH_POLYGLOT;
    }
  }

  MagicReport {
    mime,
    description,
    encoding: encoding.to_string(),
    kind,
    extension_mime,
    declared_mime: normalized_declared,
    mismatch_flags,
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn report(bytes: &[u8], filename: &str, declared: &str) -> MagicReport {
    inspect_magic(bytes, filename, declared)
  }

  fn pe_bytes() -> Vec<u8> {
    let mut out = b"MZ\x90\x00".to_vec();
    out.extend_from_slice(b"This program cannot be run in DOS mode");
    out.extend(std::iter::repeat_n(0x41u8, 512));
    out
  }

  fn zip_bytes(entry: &str) -> Vec<u8> {
    let mut out = b"PK\x03\x04".to_vec();
    out.extend(std::iter::repeat_n(0u8, 26));
    out.extend_from_slice(entry.as_bytes());
    out.extend(std::iter::repeat_n(0u8, 64));
    out.extend_from_slice(b"PK\x05\x06");
    out.extend(std::iter::repeat_n(0u8, 18));
    out
  }

  #[test]
  fn pe_renamed_as_jpg_is_reported_as_executable_with_mismatch() {
    let result = report(&pe_bytes(), "poza.jpg", "image/jpeg");
    assert_eq!(result.kind, "executable");
    assert_eq!(
      kind_for_mime(&result.mime),
      "executable",
      "MIME-ul exact difera intre detectoare (libmagic: application/x-dosexec), dar clasa ramane executabil: {}",
      result.mime
    );
    assert!(result.mismatch_flags & MISMATCH_EXTENSION != 0, "extensia .jpg contrazice continutul");
    assert!(result.mismatch_flags & MISMATCH_DECLARED_MIME != 0, "MIME-ul declarat de Discord contrazice continutul");
    assert!(result.mismatch_flags & MISMATCH_DISGUISED_EXECUTABLE != 0, "executabil deghizat");
  }

  #[test]
  fn pdf_with_txt_extension_is_still_a_document() {
    let mut pdf = b"%PDF-1.7\ncontinut\n".to_vec();
    pdf.extend_from_slice(b"%%EOF\n");
    let result = report(&pdf, "note.txt", "text/plain");
    assert_eq!(result.mime, "application/pdf");
    assert_eq!(result.kind, "document");
    assert!(result.mismatch_flags & MISMATCH_EXTENSION != 0);
    assert!(result.mismatch_flags & MISMATCH_DISGUISED_EXECUTABLE == 0, "un PDF nu e executabil deghizat");
  }

  #[test]
  fn ooxml_and_apk_are_distinguished_from_a_plain_zip() {
    assert_eq!(report(&zip_bytes("word/document.xml"), "raport.docx", "").mime, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    assert_eq!(report(&zip_bytes("xl/workbook.xml"), "raport.xlsx", "").mime, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    assert_eq!(report(&zip_bytes("AndroidManifest.xml"), "app.apk", "").mime, "application/vnd.android.package-archive");
    assert_eq!(report(&zip_bytes("META-INF/MANIFEST.MF"), "tool.jar", "").mime, "application/java-archive");
    assert_eq!(report(&zip_bytes("readme.txt"), "arhiva.zip", "").mime, "application/zip");
  }

  #[test]
  fn a_docx_named_zip_is_not_a_mismatch_because_both_are_zip_containers() {
    let result = report(&zip_bytes("word/document.xml"), "arhiva.zip", "application/zip");
    assert_eq!(result.mismatch_flags, 0, "OOXML si ZIP fac parte din aceeasi familie de containere");
  }

  #[test]
  fn archive_signatures_are_classified() {
    assert_eq!(report(b"Rar!\x1a\x07\x01\x00rest", "a.rar", "").kind, "archive");
    assert_eq!(report(b"Rar!\x1a\x07\x00rest", "a.rar", "").kind, "archive");
    assert_eq!(report(&[0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 0], "a.7z", "").kind, "archive");
    assert_eq!(report(&[0x1f, 0x8b, 0x08, 0x00], "a.gz", "").kind, "archive");
    assert_eq!(report(b"MSCF\0\0\0\0", "a.cab", "").kind, "archive");
    let mut ole = vec![0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    ole.extend(std::iter::repeat_n(0u8, 512));
    assert_eq!(report(&ole, "setup.msi", "").kind, "document");
    assert_eq!(report(&ole, "setup.msi", "").mismatch_flags, 0, "MSI este un container OLE, nu un mismatch");
  }

  #[test]
  fn builtin_signature_table_labels_archives_exactly() {
    let label = |bytes: &[u8]| detect_type_via_signatures(bytes, detect_encoding(bytes));
    assert_eq!(label(&pe_bytes()).mime, "application/vnd.microsoft.portable-executable");
    assert_eq!(label(b"Rar!\x1a\x07\x01\x00rest").mime, "application/vnd.rar");
    assert_eq!(label(b"Rar!\x1a\x07\x00rest").description, "arhiva RAR4");
    assert_eq!(label(&[0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 0]).mime, "application/x-7z-compressed");
    assert_eq!(label(&[0x1f, 0x8b, 0x08, 0x00]).mime, "application/gzip");
    assert_eq!(label(b"MSCF\0\0\0\0").mime, "application/vnd.ms-cab-compressed");
    let mut ole = vec![0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    ole.extend(std::iter::repeat_n(0u8, 512));
    assert_eq!(label(&ole).mime, "application/x-ole-storage");
  }

  #[test]
  fn scripts_and_text_are_separated_from_binary() {
    let shell = report(b"#!/bin/bash\necho salut\n", "script.sh", "text/plain");
    assert_eq!(shell.kind, "script");
    assert_eq!(shell.encoding, "us-ascii");
    assert_eq!(shell.mismatch_flags, 0, "un shebang intr-un .sh declarat text/plain nu e contradictie");

    let text = report("doar text simplu".as_bytes(), "note.txt", "text/plain");
    assert_eq!(text.kind, "text");
    assert_eq!(text.mime, "text/plain");
  }

  #[test]
  fn encoding_is_detected_for_bom_and_binary_content() {
    assert_eq!(report(&[0xef, 0xbb, 0xbf, b'a'], "a.txt", "").encoding, "utf-8-bom");
    assert_eq!(report(&[0xff, 0xfe, b'a', 0], "a.txt", "").encoding, "utf-16le");
    assert_eq!(report(&[0xfe, 0xff, 0, b'a'], "a.txt", "").encoding, "utf-16be");
    assert_eq!(report(&[0x00, 0x01, 0x02, 0x03], "a.bin", "").encoding, "binary");
    assert_eq!(report("salut ăîș".as_bytes(), "a.txt", "").encoding, "utf-8");
  }

  #[test]
  fn a_truncated_pdf_is_flagged_without_changing_the_type() {
    let result = report(b"%PDF-1.7\ninceput fara sfarsit", "doc.pdf", "application/pdf");
    assert_eq!(result.mime, "application/pdf");
    assert!(result.mismatch_flags & MISMATCH_TRUNCATED != 0);
  }

  #[test]
  fn an_empty_buffer_is_reported_as_truncated_binary() {
    let result = report(b"", "gol.bin", "");
    assert_eq!(result.kind, "other");
    assert!(result.mismatch_flags & MISMATCH_TRUNCATED != 0);
  }

  #[test]
  fn a_polyglot_zip_carrying_a_pe_stub_is_flagged() {
    let mut polyglot = b"PK\x03\x04".to_vec();
    polyglot.extend_from_slice(b"This program cannot be run in DOS mode");
    polyglot.extend(std::iter::repeat_n(0u8, 32));
    let result = report(&polyglot, "arhiva.zip", "application/zip");
    assert!(result.mismatch_flags & MISMATCH_POLYGLOT != 0);
  }

  #[test]
  fn images_and_media_are_routed_to_their_own_kinds() {
    assert_eq!(report(&[0xff, 0xd8, 0xff, 0xe0], "a.jpg", "image/jpeg").kind, "image");
    assert_eq!(report(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "a.png", "").kind, "image");
    let mut webp = b"RIFF".to_vec();
    webp.extend_from_slice(&[0, 0, 0, 0]);
    webp.extend_from_slice(b"WEBP");
    assert_eq!(report(&webp, "a.webp", "").mime, "image/webp");
    let mut mp4 = vec![0u8; 4];
    mp4.extend_from_slice(b"ftypisom");
    assert_eq!(report(&mp4, "clip.mp4", "").kind, "media");
    let mut avif = vec![0u8; 4];
    avif.extend_from_slice(b"ftypavif");
    assert_eq!(report(&avif, "a.avif", "").mime, "image/avif");
  }

  #[test]
  fn an_unknown_declared_mime_never_overrides_the_detected_type() {
    let result = report(&pe_bytes(), "setup.exe", "application/octet-stream");
    assert_eq!(result.kind, "executable");
    assert_eq!(result.mismatch_flags, 0, "octet-stream este generic, nu o contradictie");
  }

  #[test]
  fn mime_kinds_cover_the_routing_categories() {
    assert_eq!(kind_for_mime("image/png"), "image");
    assert_eq!(kind_for_mime("video/mp4"), "media");
    assert_eq!(kind_for_mime("audio/mpeg"), "media");
    assert_eq!(kind_for_mime("application/x-dosexec"), "executable");
    assert_eq!(kind_for_mime("application/x-sharedlib"), "executable");
    assert_eq!(kind_for_mime("text/x-shellscript"), "script");
    assert_eq!(kind_for_mime("application/x-7z-compressed"), "archive");
    assert_eq!(kind_for_mime("application/pdf"), "document");
    assert_eq!(kind_for_mime("application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "document");
    assert_eq!(kind_for_mime("text/plain"), "text");
    assert_eq!(kind_for_mime("application/octet-stream"), "other");
  }

  #[test]
  fn kind_based_compatibility_tolerates_mime_variants_but_not_cross_kind() {
    assert!(compatible("application/x-dosexec", "application/vnd.microsoft.portable-executable"), "acelasi kind executabil, variante MIME diferite");
    assert!(compatible("application/x-gzip", "application/gzip"), "aceeasi arhiva sub nume MIME alternativ");
    assert!(!compatible("application/x-dosexec", "image/jpeg"), "executabil vs imagine ramane contradictie");
    assert!(!compatible("application/pdf", "application/zip"), "document vs arhiva raman incompatibile daca nu au familie comuna");
  }

  #[cfg(feature = "magic")]
  #[test]
  fn libmagic_when_available_drives_the_type_from_its_own_database() {
    if !libmagic_available() {
      return;
    }
    let mut gif = b"GIF89a".to_vec();
    gif.extend_from_slice(&[0x10, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00]);
    gif.extend(std::iter::repeat_n(0u8, 64));
    let disguised = report(&gif, "raport.pdf", "application/pdf");
    assert_eq!(disguised.mime, "image/gif", "libmagic clasifica GIF-ul din propria baza de semnaturi");
    assert_eq!(disguised.kind, "image");
    assert!(disguised.mismatch_flags & MISMATCH_EXTENSION != 0, "extensia .pdf contrazice continutul GIF");

    let mut pdf = b"%PDF-1.7\n1 0 obj<<>>endobj\n".to_vec();
    pdf.extend_from_slice(b"%%EOF\n");
    let doc = report(&pdf, "doc.pdf", "application/pdf");
    assert_eq!(doc.kind, "document");
    assert_eq!(doc.mismatch_flags, 0, "un PDF real numit .pdf nu are contradictii");
  }

  #[cfg(feature = "magic")]
  #[test]
  fn compunerea_verdictelor_alege_corect_intre_motor_si_tabelul_intern() {
    let builtin_pe = detect_type_via_signatures(&pe_bytes(), detect_encoding(&pe_bytes()));
    let generic = |mime: &str| TypeVerdict {
      mime: mime.to_string(),
      description: "data".to_string(),
      kind: "other".to_string(),
      concrete: false,
    };
    let concrete = |mime: &str, kind: &str| TypeVerdict {
      mime: mime.to_string(),
      description: "din motor".to_string(),
      kind: kind.to_string(),
      concrete: true,
    };

    assert_eq!(
      combine_verdicts(None, builtin_pe.clone()).mime,
      "application/vnd.microsoft.portable-executable",
      "fara motor (baza magic lipseste) preia complet tabelul intern"
    );
    assert_eq!(
      combine_verdicts(Some(generic("application/octet-stream")), builtin_pe.clone()).mime,
      "application/vnd.microsoft.portable-executable",
      "un verdict generic al motorului cedeaza in fata tabelului intern concret"
    );
    assert_eq!(
      combine_verdicts(Some(concrete("application/x-dosexec", "executable")), builtin_pe.clone()).mime,
      "application/x-dosexec",
      "un verdict concret al motorului ramane autoritatea, chiar daca tabelul intern are alt nume MIME"
    );

    let docx = zip_bytes("word/document.xml");
    let builtin_docx = detect_type_via_signatures(&docx, detect_encoding(&docx));
    assert_eq!(
      combine_verdicts(Some(concrete("application/zip", "archive")), builtin_docx).mime,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "un container ZIP recunoscut de motor e rafinat de tabelul intern in subtipul real"
    );

    let text = detect_type_via_signatures(b"doar text", detect_encoding(b"doar text"));
    assert_eq!(
      combine_verdicts(Some(generic("application/octet-stream")), text).mime,
      "application/octet-stream",
      "cand nici tabelul intern nu e concret, verdictul generic al motorului ramane"
    );
  }
}
