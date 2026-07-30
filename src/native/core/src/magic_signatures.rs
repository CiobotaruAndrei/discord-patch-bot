pub(crate) struct Signature {
  pub(crate) mime: &'static str,
  pub(crate) description: &'static str,
  pub(crate) kind: &'static str,
}

pub(crate) fn starts_with(bytes: &[u8], prefix: &[u8]) -> bool {
  bytes.len() >= prefix.len() && &bytes[..prefix.len()] == prefix
}

pub(crate) fn at(bytes: &[u8], offset: usize, needle: &[u8]) -> bool {
  bytes.len() >= offset + needle.len() && &bytes[offset..offset + needle.len()] == needle
}

pub(crate) fn signature(mime: &'static str, description: &'static str, kind: &'static str) -> Signature {
  Signature { mime, description, kind }
}

pub(crate) fn zip_flavor(bytes: &[u8]) -> Signature {
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

pub(crate) fn isobmff_flavor(bytes: &[u8]) -> Signature {
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

pub(crate) fn riff_flavor(bytes: &[u8]) -> Signature {
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

pub(crate) fn detect_signature(bytes: &[u8]) -> Option<Signature> {
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
