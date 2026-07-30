pub(crate) fn extension_of(filename: &str) -> String {
  let lower = filename.to_lowercase();
  let name = lower.rsplit('/').next().unwrap_or(&lower).to_string();
  match name.rfind('.') {
    Some(index) if index + 1 < name.len() => name[index + 1..].to_string(),
    _ => String::new(),
  }
}

pub(crate) fn mime_for_extension(extension: &str) -> &'static str {
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

pub(crate) fn kind_for_mime(mime: &str) -> &'static str {
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

pub(crate) fn mime_family(mime: &str) -> &str {
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

pub(crate) fn compatible(detected: &str, candidate: &str) -> bool {
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

pub(crate) fn is_text_like(mime: &str) -> bool {
  mime.starts_with("text/") || mime == "application/json" || mime == "application/xml"
}

pub(crate) fn is_generic_mime(mime: &str) -> bool {
  matches!(mime, "application/octet-stream" | "text/plain" | "application/x-empty" | "")
}

#[cfg(feature = "magic")]
pub(crate) fn is_refinable_container(mime: &str) -> bool {
  matches!(mime, "application/zip" | "application/x-ole-storage")
}
