use crate::magic_signatures::*;

pub(crate) fn detect_encoding(bytes: &[u8]) -> &'static str {
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

pub(crate) fn looks_truncated(bytes: &[u8], kind: &str, mime: &str) -> bool {
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
