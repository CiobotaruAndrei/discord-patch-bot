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

struct Signature {
  mime: &'static str,
  description: &'static str,
  kind: &'static str,
}

fn starts_with(bytes: &[u8], prefix: &[u8]) -> bool {
  bytes.len() >= prefix.len() && &bytes[..prefix.len()] == prefix
}

fn at(bytes: &[u8], offset: usize, needle: &[u8]) -> bool {
  bytes.len() >= offset + needle.len() && &bytes[offset..offset + needle.len()] == needle
}

fn signature(mime: &'static str, description: &'static str, kind: &'static str) -> Signature {
  Signature { mime, description, kind }
}

fn zip_flavor(bytes: &[u8]) -> Signature {
  let window = &bytes[..bytes.len().min(65_536)];
  if crate::inspection_bytes::window_contains(window, b"AndroidManifest.xml") {
    return signature("application/vnd.android.package-archive", "pachet Android APK (container ZIP)", "archive");
  }
  if crate::inspection_bytes::window_contains(window, b"word/document.xml") || crate::inspection_bytes::window_contains(window, b"word/_rels") {
    return signature(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "document Word OOXML (container ZIP)",
      "document"
    );
  }
  if crate::inspection_bytes::window_contains(window, b"xl/workbook.xml") || crate::inspection_bytes::window_contains(window, b"xl/_rels") {
    return signature(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "registru Excel OOXML (container ZIP)",
      "document"
    );
  }
  if crate::inspection_bytes::window_contains(window, b"ppt/presentation.xml") || crate::inspection_bytes::window_contains(window, b"ppt/_rels") {
    return signature(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "prezentare PowerPoint OOXML (container ZIP)",
      "document"
    );
  }
  if crate::inspection_bytes::window_contains(window, b"META-INF/MANIFEST.MF") {
    return signature("application/java-archive", "arhiva Java JAR (container ZIP)", "archive");
  }
  if crate::inspection_bytes::window_contains(window, b"mimetypeapplication/vnd.oasis.opendocument") {
    return signature("application/vnd.oasis.opendocument.text", "document OpenDocument (container ZIP)", "document");
  }
  signature("application/zip", "arhiva ZIP", "archive")
}

fn isobmff_flavor(bytes: &[u8]) -> Signature {
  if at(bytes, 8, b"avif") || at(bytes, 8, b"avis") {
    return signature("image/avif", "imagine AVIF", "image");
  }
  if at(bytes, 8, b"heic") || at(bytes, 8, b"heix") || at(bytes, 8, b"mif1") {
    return signature("image/heif", "imagine HEIF/HEIC", "image");
  }
  if at(bytes, 8, b"M4A ") {
    return signature("audio/mp4", "audio MPEG-4", "media");
  }
  signature("video/mp4", "container MPEG-4", "media")
}

fn riff_flavor(bytes: &[u8]) -> Signature {
  if at(bytes, 8, b"WEBP") {
    return signature("image/webp", "imagine WebP", "image");
  }
  if at(bytes, 8, b"WAVE") {
    return signature("audio/wav", "audio WAV", "media");
  }
  if at(bytes, 8, b"AVI ") {
    return signature("video/x-msvideo", "container AVI", "media");
  }
  signature("application/octet-stream", "container RIFF necunoscut", "other")
}

fn detect_signature(bytes: &[u8]) -> Option<Signature> {
  if starts_with(bytes, b"MZ") {
    return Some(signature("application/vnd.microsoft.portable-executable", "executabil Windows PE", "executable"));
  }
  if starts_with(bytes, b"\x7fELF") {
    return Some(signature("application/x-elf", "executabil ELF", "executable"));
  }
  if starts_with(bytes, &[0xfe, 0xed, 0xfa, 0xce])
    || starts_with(bytes, &[0xfe, 0xed, 0xfa, 0xcf])
    || starts_with(bytes, &[0xce, 0xfa, 0xed, 0xfe])
    || starts_with(bytes, &[0xcf, 0xfa, 0xed, 0xfe])
    || starts_with(bytes, &[0xca, 0xfe, 0xba, 0xbe])
  {
    return Some(signature("application/x-mach-binary", "executabil Mach-O", "executable"));
  }
  if starts_with(bytes, b"\0asm") {
    return Some(signature("application/wasm", "modul WebAssembly", "executable"));
  }
  if starts_with(bytes, b"#!") {
    return Some(signature("text/x-shellscript", "script cu shebang", "script"));
  }
  if starts_with(bytes, b"PK\x03\x04") || starts_with(bytes, b"PK\x05\x06") || starts_with(bytes, b"PK\x07\x08") {
    return Some(zip_flavor(bytes));
  }
  if starts_with(bytes, b"Rar!\x1a\x07\x01\x00") {
    return Some(signature("application/vnd.rar", "arhiva RAR5", "archive"));
  }
  if starts_with(bytes, b"Rar!\x1a\x07\x00") {
    return Some(signature("application/vnd.rar", "arhiva RAR4", "archive"));
  }
  if starts_with(bytes, &[0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]) {
    return Some(signature("application/x-7z-compressed", "arhiva 7-Zip", "archive"));
  }
  if starts_with(bytes, &[0x1f, 0x8b]) {
    return Some(signature("application/gzip", "flux GZIP", "archive"));
  }
  if starts_with(bytes, b"BZh") {
    return Some(signature("application/x-bzip2", "flux BZIP2", "archive"));
  }
  if starts_with(bytes, &[0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]) {
    return Some(signature("application/x-xz", "flux XZ", "archive"));
  }
  if starts_with(bytes, &[0x28, 0xb5, 0x2f, 0xfd]) {
    return Some(signature("application/zstd", "flux Zstandard", "archive"));
  }
  if starts_with(bytes, b"MSCF") {
    return Some(signature("application/vnd.ms-cab-compressed", "arhiva Microsoft CAB", "archive"));
  }
  if starts_with(bytes, &[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) {
    return Some(signature("application/x-ole-storage", "document OLE compound file", "document"));
  }
  if at(bytes, 257, b"ustar") {
    return Some(signature("application/x-tar", "arhiva TAR", "archive"));
  }
  if starts_with(bytes, b"%PDF") {
    return Some(signature("application/pdf", "document PDF", "document"));
  }
  if starts_with(bytes, b"{\\rtf") {
    return Some(signature("application/rtf", "document RTF", "document"));
  }
  if starts_with(bytes, &[0xff, 0xd8, 0xff]) {
    return Some(signature("image/jpeg", "imagine JPEG", "image"));
  }
  if starts_with(bytes, &[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) {
    return Some(signature("image/png", "imagine PNG", "image"));
  }
  if starts_with(bytes, b"GIF87a") || starts_with(bytes, b"GIF89a") {
    return Some(signature("image/gif", "imagine GIF", "image"));
  }
  if starts_with(bytes, b"BM") {
    return Some(signature("image/bmp", "imagine BMP", "image"));
  }
  if starts_with(bytes, &[0x49, 0x49, 0x2a, 0x00]) || starts_with(bytes, &[0x4d, 0x4d, 0x00, 0x2a]) {
    return Some(signature("image/tiff", "imagine TIFF", "image"));
  }
  if starts_with(bytes, b"RIFF") {
    return Some(riff_flavor(bytes));
  }
  if at(bytes, 4, b"ftyp") {
    return Some(isobmff_flavor(bytes));
  }
  if starts_with(bytes, &[0x1a, 0x45, 0xdf, 0xa3]) {
    return Some(signature("video/x-matroska", "container Matroska/WebM", "media"));
  }
  if starts_with(bytes, b"OggS") {
    return Some(signature("application/ogg", "container Ogg", "media"));
  }
  if starts_with(bytes, b"fLaC") {
    return Some(signature("audio/flac", "audio FLAC", "media"));
  }
  if starts_with(bytes, b"ID3") || starts_with(bytes, &[0xff, 0xfb]) {
    return Some(signature("audio/mpeg", "audio MP3", "media"));
  }
  if starts_with(bytes, b"SQLite format 3\0") {
    return Some(signature("application/vnd.sqlite3", "baza de date SQLite", "other"));
  }
  if starts_with(bytes, &[0xca, 0xfe, 0xba, 0xbe]) {
    return Some(signature("application/java-vm", "class Java", "executable"));
  }
  None
}

fn detect_encoding(bytes: &[u8]) -> &'static str {
  if starts_with(bytes, &[0xef, 0xbb, 0xbf]) {
    return "utf-8-bom";
  }
  if starts_with(bytes, &[0xff, 0xfe]) {
    return "utf-16le";
  }
  if starts_with(bytes, &[0xfe, 0xff]) {
    return "utf-16be";
  }
  let window = &bytes[..bytes.len().min(8192)];
  if window.is_empty() {
    return "binary";
  }
  if window.contains(&0) {
    return "binary";
  }
  if window.iter().all(|byte| *byte == b'\t' || *byte == b'\n' || *byte == b'\r' || (0x20..0x7f).contains(byte)) {
    return "us-ascii";
  }
  if std::str::from_utf8(window).is_ok() {
    return "utf-8";
  }
  "binary"
}

fn extension_of(filename: &str) -> String {
  let lower = filename.to_lowercase();
  let name = lower.rsplit('/').next().unwrap_or(&lower).to_string();
  match name.rfind('.') {
    Some(index) if index + 1 < name.len() => name[index + 1..].to_string(),
    _ => String::new(),
  }
}

fn mime_for_extension(extension: &str) -> &'static str {
  match extension {
    "exe" | "dll" | "sys" | "scr" | "com" => "application/vnd.microsoft.portable-executable",
    "so" | "elf" => "application/x-elf",
    "sh" | "bash" | "zsh" => "text/x-shellscript",
    "bat" | "cmd" => "application/x-bat",
    "ps1" => "application/x-powershell",
    "js" | "mjs" | "cjs" => "text/javascript",
    "vbs" => "text/vbscript",
    "jar" => "application/java-archive",
    "apk" => "application/vnd.android.package-archive",
    "zip" | "zipx" => "application/zip",
    "rar" => "application/vnd.rar",
    "7z" => "application/x-7z-compressed",
    "gz" | "tgz" => "application/gzip",
    "bz2" => "application/x-bzip2",
    "xz" => "application/x-xz",
    "zst" => "application/zstd",
    "tar" => "application/x-tar",
    "cab" => "application/vnd.ms-cab-compressed",
    "msi" => "application/x-ole-storage",
    "doc" | "xls" | "ppt" => "application/x-ole-storage",
    "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "pdf" => "application/pdf",
    "rtf" => "application/rtf",
    "jpg" | "jpeg" => "image/jpeg",
    "png" => "image/png",
    "gif" => "image/gif",
    "bmp" => "image/bmp",
    "tif" | "tiff" => "image/tiff",
    "webp" => "image/webp",
    "avif" => "image/avif",
    "heic" | "heif" => "image/heif",
    "mp4" | "m4v" => "video/mp4",
    "mkv" | "webm" => "video/x-matroska",
    "avi" => "video/x-msvideo",
    "wav" => "audio/wav",
    "mp3" => "audio/mpeg",
    "flac" => "audio/flac",
    "ogg" | "oga" | "ogv" => "application/ogg",
    "txt" | "log" | "md" => "text/plain",
    "json" => "application/json",
    "xml" => "application/xml",
    "html" | "htm" => "text/html",
    "wasm" => "application/wasm",
    _ => "",
  }
}

fn kind_for_mime(mime: &str) -> &'static str {
  if mime.is_empty() {
    return "other";
  }
  if mime.starts_with("image/") {
    return "image";
  }
  if mime.starts_with("video/") || mime.starts_with("audio/") || mime == "application/ogg" {
    return "media";
  }
  match mime {
    "application/vnd.microsoft.portable-executable"
    | "application/x-dosexec"
    | "application/x-msdownload"
    | "application/x-executable"
    | "application/x-pie-executable"
    | "application/x-sharedlib"
    | "application/x-elf"
    | "application/x-object"
    | "application/x-mach-binary"
    | "application/java-vm"
    | "application/wasm" => "executable",
    "text/x-shellscript"
    | "text/x-perl"
    | "text/x-python"
    | "text/x-ruby"
    | "text/x-php"
    | "text/javascript"
    | "application/javascript"
    | "text/vbscript"
    | "application/x-bat"
    | "application/x-msdos-program"
    | "application/x-powershell"
    | "application/x-sh" => "script",
    "application/zip"
    | "application/vnd.android.package-archive"
    | "application/java-archive"
    | "application/x-7z-compressed"
    | "application/vnd.rar"
    | "application/x-rar"
    | "application/gzip"
    | "application/x-gzip"
    | "application/x-tar"
    | "application/x-bzip2"
    | "application/x-xz"
    | "application/zstd"
    | "application/x-zstd"
    | "application/x-lzma"
    | "application/vnd.ms-cab-compressed"
    | "application/x-cpio"
    | "application/x-archive" => "archive",
    "application/pdf"
    | "application/rtf"
    | "text/rtf"
    | "application/msword"
    | "application/vnd.ms-excel"
    | "application/vnd.ms-powerpoint"
    | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    | "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    | "application/vnd.oasis.opendocument.text"
    | "application/vnd.oasis.opendocument.spreadsheet"
    | "application/vnd.oasis.opendocument.presentation"
    | "application/x-ole-storage"
    | "application/vnd.ms-outlook"
    | "application/x-msi"
    | "application/x-ms-installer" => "document",
    "text/plain" | "application/json" | "application/xml" | "text/xml" | "text/html" | "text/csv" => "text",
    _ if mime.starts_with("text/") => "text",
    _ => "other",
  }
}

fn mime_family(mime: &str) -> &str {
  match mime {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    | "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    | "application/vnd.android.package-archive"
    | "application/java-archive"
    | "application/vnd.oasis.opendocument.text"
    | "application/zip" => "zip-container",
    "application/x-ole-storage"
    | "application/vnd.ms-outlook"
    | "application/x-msi"
    | "application/x-ms-installer"
    | "application/msword"
    | "application/vnd.ms-excel"
    | "application/vnd.ms-powerpoint" => "ole-container",
    other => other,
  }
}

fn compatible(detected: &str, candidate: &str) -> bool {
  if candidate.is_empty() || detected == candidate {
    return true;
  }
  if mime_family(detected) == mime_family(candidate) {
    return true;
  }
  let detected_kind = kind_for_mime(detected);
  if detected_kind != "other" && detected_kind == kind_for_mime(candidate) {
    return true;
  }
  matches!(
    (detected, candidate),
    ("text/x-shellscript", "text/plain")
      | ("text/plain", "text/x-shellscript")
      | ("application/octet-stream", _)
      | (_, "application/octet-stream")
      | (_, "application/x-msdownload")
  )
}

fn is_text_like(mime: &str) -> bool {
  mime.starts_with("text/") || mime == "application/json" || mime == "application/xml"
}

fn looks_truncated(bytes: &[u8], kind: &str, mime: &str) -> bool {
  if bytes.is_empty() {
    return true;
  }
  if mime == "application/pdf" {
    let tail = &bytes[bytes.len().saturating_sub(2048)..];
    return !crate::inspection_bytes::window_contains(tail, b"%%EOF");
  }
  if kind == "archive" && mime == "application/zip" {
    return !crate::inspection_bytes::window_contains(bytes, b"PK\x05\x06") && bytes.len() < 22;
  }
  false
}

fn is_generic_mime(mime: &str) -> bool {
  matches!(mime, "application/octet-stream" | "text/plain" | "application/x-empty" | "")
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
fn is_refinable_container(mime: &str) -> bool {
  matches!(mime, "application/zip" | "application/x-ole-storage")
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
