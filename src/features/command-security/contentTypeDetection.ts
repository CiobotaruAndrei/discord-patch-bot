"use strict";

import { getNativeFuzzy, recordNativeFallback } from "../../native/fuzzy.js";

export const MISMATCH_EXTENSION = 1;
export const MISMATCH_DECLARED_MIME = 2;
export const MISMATCH_POLYGLOT = 4;
export const MISMATCH_DISGUISED_EXECUTABLE = 8;
export const MISMATCH_TRUNCATED = 16;

export type DetectedKind = "executable" | "archive" | "document" | "script" | "image" | "media" | "text" | "other";

export interface MagicReport {
  mime: string;
  description: string;
  encoding: string;
  kind: DetectedKind;
  extensionMime: string;
  declaredMime: string;
  mismatchFlags: number;
}

interface Signature {
  mime: string;
  description: string;
  kind: DetectedKind;
}

function startsWith(buffer: Buffer, prefix: number[] | string): boolean {
  const bytes = typeof prefix === "string" ? Buffer.from(prefix, "latin1") : Buffer.from(prefix);
  return buffer.length >= bytes.length && buffer.subarray(0, bytes.length).equals(bytes);
}

function at(buffer: Buffer, offset: number, needle: string): boolean {
  const bytes = Buffer.from(needle, "latin1");
  return buffer.length >= offset + bytes.length && buffer.subarray(offset, offset + bytes.length).equals(bytes);
}

function contains(buffer: Buffer, needle: string): boolean {
  return buffer.indexOf(needle, 0, "latin1") !== -1;
}

function zipFlavor(buffer: Buffer): Signature {
  const window = buffer.subarray(0, Math.min(buffer.length, 65_536));
  if (contains(window, "AndroidManifest.xml")) {
    return { mime: "application/vnd.android.package-archive", description: "pachet Android APK (container ZIP)", kind: "archive" };
  }
  if (contains(window, "word/document.xml") || contains(window, "word/_rels")) {
    return {
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      description: "document Word OOXML (container ZIP)",
      kind: "document"
    };
  }
  if (contains(window, "xl/workbook.xml") || contains(window, "xl/_rels")) {
    return {
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      description: "registru Excel OOXML (container ZIP)",
      kind: "document"
    };
  }
  if (contains(window, "ppt/presentation.xml") || contains(window, "ppt/_rels")) {
    return {
      mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      description: "prezentare PowerPoint OOXML (container ZIP)",
      kind: "document"
    };
  }
  if (contains(window, "META-INF/MANIFEST.MF")) {
    return { mime: "application/java-archive", description: "arhiva Java JAR (container ZIP)", kind: "archive" };
  }
  if (contains(window, "mimetypeapplication/vnd.oasis.opendocument")) {
    return { mime: "application/vnd.oasis.opendocument.text", description: "document OpenDocument (container ZIP)", kind: "document" };
  }
  return { mime: "application/zip", description: "arhiva ZIP", kind: "archive" };
}

function isobmffFlavor(buffer: Buffer): Signature {
  if (at(buffer, 8, "avif") || at(buffer, 8, "avis")) return { mime: "image/avif", description: "imagine AVIF", kind: "image" };
  if (at(buffer, 8, "heic") || at(buffer, 8, "heix") || at(buffer, 8, "mif1")) {
    return { mime: "image/heif", description: "imagine HEIF/HEIC", kind: "image" };
  }
  if (at(buffer, 8, "M4A ")) return { mime: "audio/mp4", description: "audio MPEG-4", kind: "media" };
  return { mime: "video/mp4", description: "container MPEG-4", kind: "media" };
}

function riffFlavor(buffer: Buffer): Signature {
  if (at(buffer, 8, "WEBP")) return { mime: "image/webp", description: "imagine WebP", kind: "image" };
  if (at(buffer, 8, "WAVE")) return { mime: "audio/wav", description: "audio WAV", kind: "media" };
  if (at(buffer, 8, "AVI ")) return { mime: "video/x-msvideo", description: "container AVI", kind: "media" };
  return { mime: "application/octet-stream", description: "container RIFF necunoscut", kind: "other" };
}

function detectSignature(buffer: Buffer): Signature | null {
  if (startsWith(buffer, "MZ")) {
    return { mime: "application/vnd.microsoft.portable-executable", description: "executabil Windows PE", kind: "executable" };
  }
  if (startsWith(buffer, [0x7f, 0x45, 0x4c, 0x46])) return { mime: "application/x-elf", description: "executabil ELF", kind: "executable" };
  if (
    startsWith(buffer, [0xfe, 0xed, 0xfa, 0xce])
    || startsWith(buffer, [0xfe, 0xed, 0xfa, 0xcf])
    || startsWith(buffer, [0xce, 0xfa, 0xed, 0xfe])
    || startsWith(buffer, [0xcf, 0xfa, 0xed, 0xfe])
    || startsWith(buffer, [0xca, 0xfe, 0xba, 0xbe])
  ) {
    return { mime: "application/x-mach-binary", description: "executabil Mach-O", kind: "executable" };
  }
  if (startsWith(buffer, [0x00, 0x61, 0x73, 0x6d])) return { mime: "application/wasm", description: "modul WebAssembly", kind: "executable" };
  if (startsWith(buffer, "#!")) return { mime: "text/x-shellscript", description: "script cu shebang", kind: "script" };
  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buffer, [0x50, 0x4b, 0x05, 0x06]) || startsWith(buffer, [0x50, 0x4b, 0x07, 0x08])) {
    return zipFlavor(buffer);
  }
  if (startsWith(buffer, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00])) {
    return { mime: "application/vnd.rar", description: "arhiva RAR5", kind: "archive" };
  }
  if (startsWith(buffer, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00])) {
    return { mime: "application/vnd.rar", description: "arhiva RAR4", kind: "archive" };
  }
  if (startsWith(buffer, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) {
    return { mime: "application/x-7z-compressed", description: "arhiva 7-Zip", kind: "archive" };
  }
  if (startsWith(buffer, [0x1f, 0x8b])) return { mime: "application/gzip", description: "flux GZIP", kind: "archive" };
  if (startsWith(buffer, "BZh")) return { mime: "application/x-bzip2", description: "flux BZIP2", kind: "archive" };
  if (startsWith(buffer, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return { mime: "application/x-xz", description: "flux XZ", kind: "archive" };
  if (startsWith(buffer, [0x28, 0xb5, 0x2f, 0xfd])) return { mime: "application/zstd", description: "flux Zstandard", kind: "archive" };
  if (startsWith(buffer, "MSCF")) {
    return { mime: "application/vnd.ms-cab-compressed", description: "arhiva Microsoft CAB", kind: "archive" };
  }
  if (startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return { mime: "application/x-ole-storage", description: "document OLE compound file", kind: "document" };
  }
  if (at(buffer, 257, "ustar")) return { mime: "application/x-tar", description: "arhiva TAR", kind: "archive" };
  if (startsWith(buffer, "%PDF")) return { mime: "application/pdf", description: "document PDF", kind: "document" };
  if (startsWith(buffer, "{\\rtf")) return { mime: "application/rtf", description: "document RTF", kind: "document" };
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", description: "imagine JPEG", kind: "image" };
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mime: "image/png", description: "imagine PNG", kind: "image" };
  }
  if (startsWith(buffer, "GIF87a") || startsWith(buffer, "GIF89a")) return { mime: "image/gif", description: "imagine GIF", kind: "image" };
  if (startsWith(buffer, "BM")) return { mime: "image/bmp", description: "imagine BMP", kind: "image" };
  if (startsWith(buffer, [0x49, 0x49, 0x2a, 0x00]) || startsWith(buffer, [0x4d, 0x4d, 0x00, 0x2a])) {
    return { mime: "image/tiff", description: "imagine TIFF", kind: "image" };
  }
  if (startsWith(buffer, "RIFF")) return riffFlavor(buffer);
  if (at(buffer, 4, "ftyp")) return isobmffFlavor(buffer);
  if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) {
    return { mime: "video/x-matroska", description: "container Matroska/WebM", kind: "media" };
  }
  if (startsWith(buffer, "OggS")) return { mime: "application/ogg", description: "container Ogg", kind: "media" };
  if (startsWith(buffer, "fLaC")) return { mime: "audio/flac", description: "audio FLAC", kind: "media" };
  if (startsWith(buffer, "ID3") || startsWith(buffer, [0xff, 0xfb])) return { mime: "audio/mpeg", description: "audio MP3", kind: "media" };
  if (startsWith(buffer, [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00])) {
    return { mime: "application/vnd.sqlite3", description: "baza de date SQLite", kind: "other" };
  }
  return null;
}

function detectEncoding(buffer: Buffer): string {
  if (startsWith(buffer, [0xef, 0xbb, 0xbf])) return "utf-8-bom";
  if (startsWith(buffer, [0xff, 0xfe])) return "utf-16le";
  if (startsWith(buffer, [0xfe, 0xff])) return "utf-16be";
  const window = buffer.subarray(0, Math.min(buffer.length, 8192));
  if (window.length === 0) return "binary";
  if (window.includes(0)) return "binary";
  if (window.every(byte => byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte < 0x7f))) return "us-ascii";
  return Buffer.compare(Buffer.from(window.toString("utf8"), "utf8"), window) === 0 ? "utf-8" : "binary";
}

const EXTENSION_MIME = new Map<string, string>([
  ["exe", "application/vnd.microsoft.portable-executable"],
  ["dll", "application/vnd.microsoft.portable-executable"],
  ["sys", "application/vnd.microsoft.portable-executable"],
  ["scr", "application/vnd.microsoft.portable-executable"],
  ["com", "application/vnd.microsoft.portable-executable"],
  ["so", "application/x-elf"],
  ["elf", "application/x-elf"],
  ["sh", "text/x-shellscript"],
  ["bash", "text/x-shellscript"],
  ["zsh", "text/x-shellscript"],
  ["bat", "application/x-bat"],
  ["cmd", "application/x-bat"],
  ["ps1", "application/x-powershell"],
  ["js", "text/javascript"],
  ["mjs", "text/javascript"],
  ["cjs", "text/javascript"],
  ["vbs", "text/vbscript"],
  ["jar", "application/java-archive"],
  ["apk", "application/vnd.android.package-archive"],
  ["zip", "application/zip"],
  ["zipx", "application/zip"],
  ["rar", "application/vnd.rar"],
  ["7z", "application/x-7z-compressed"],
  ["gz", "application/gzip"],
  ["tgz", "application/gzip"],
  ["bz2", "application/x-bzip2"],
  ["xz", "application/x-xz"],
  ["zst", "application/zstd"],
  ["tar", "application/x-tar"],
  ["cab", "application/vnd.ms-cab-compressed"],
  ["msi", "application/x-ole-storage"],
  ["doc", "application/x-ole-storage"],
  ["xls", "application/x-ole-storage"],
  ["ppt", "application/x-ole-storage"],
  ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  ["pdf", "application/pdf"],
  ["rtf", "application/rtf"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["gif", "image/gif"],
  ["bmp", "image/bmp"],
  ["tif", "image/tiff"],
  ["tiff", "image/tiff"],
  ["webp", "image/webp"],
  ["avif", "image/avif"],
  ["heic", "image/heif"],
  ["heif", "image/heif"],
  ["mp4", "video/mp4"],
  ["m4v", "video/mp4"],
  ["mkv", "video/x-matroska"],
  ["webm", "video/x-matroska"],
  ["avi", "video/x-msvideo"],
  ["wav", "audio/wav"],
  ["mp3", "audio/mpeg"],
  ["flac", "audio/flac"],
  ["ogg", "application/ogg"],
  ["oga", "application/ogg"],
  ["ogv", "application/ogg"],
  ["txt", "text/plain"],
  ["log", "text/plain"],
  ["md", "text/plain"],
  ["json", "application/json"],
  ["xml", "application/xml"],
  ["html", "text/html"],
  ["htm", "text/html"],
  ["wasm", "application/wasm"]
]);

const ZIP_CONTAINERS = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.android.package-archive",
  "application/java-archive",
  "application/vnd.oasis.opendocument.text",
  "application/zip"
]);

const OLE_CONTAINERS = new Set([
  "application/x-ole-storage",
  "application/vnd.ms-outlook",
  "application/x-msi",
  "application/x-ms-installer",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint"
]);

export function isZipContainerMime(mime: string): boolean {
  return ZIP_CONTAINERS.has(mime);
}

function mimeFamily(mime: string): string {
  if (ZIP_CONTAINERS.has(mime)) return "zip-container";
  if (OLE_CONTAINERS.has(mime)) return "ole-container";
  return mime;
}

function compatible(detected: string, candidate: string): boolean {
  if (!candidate || detected === candidate) return true;
  if (mimeFamily(detected) === mimeFamily(candidate)) return true;
  if (detected === "application/octet-stream" || candidate === "application/octet-stream") return true;
  if (candidate === "application/x-msdownload") return true;
  if (detected === "text/x-shellscript" && candidate === "text/plain") return true;
  return detected === "text/plain" && candidate === "text/x-shellscript";
}

function isTextLike(mime: string): boolean {
  return mime.startsWith("text/") || mime === "application/json" || mime === "application/xml";
}

function extensionOf(filename: string): string {
  const lower = String(filename || "").toLowerCase();
  const name = lower.split("/").pop() ?? lower;
  const index = name.lastIndexOf(".");
  return index >= 0 && index + 1 < name.length ? name.slice(index + 1) : "";
}

function looksTruncated(buffer: Buffer, kind: DetectedKind, mime: string): boolean {
  if (buffer.length === 0) return true;
  if (mime === "application/pdf") {
    return !contains(buffer.subarray(Math.max(0, buffer.length - 2048)), "%%EOF");
  }
  if (kind === "archive" && mime === "application/zip") {
    return buffer.indexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) === -1 && buffer.length < 22;
  }
  return false;
}

export function inspectMagicFallback(buffer: Buffer, filename: string, declaredMime: string): MagicReport {
  const normalizedDeclared = String(declaredMime || "").split(";")[0].trim().toLowerCase();
  const extension = extensionOf(filename);
  const extensionMime = EXTENSION_MIME.get(extension) ?? "";
  const encoding = detectEncoding(buffer);

  const detected = detectSignature(buffer);
  const signature: Signature = detected
    ?? (encoding !== "binary"
      ? { mime: "text/plain", description: "text simplu", kind: "text" }
      : { mime: "application/octet-stream", description: "date binare neidentificate", kind: "other" });

  let mismatchFlags = 0;
  if (extensionMime && !compatible(signature.mime, extensionMime)) mismatchFlags |= MISMATCH_EXTENSION;
  if (normalizedDeclared && !compatible(signature.mime, normalizedDeclared)) mismatchFlags |= MISMATCH_DECLARED_MIME;
  if (signature.kind === "executable" && (mismatchFlags & (MISMATCH_EXTENSION | MISMATCH_DECLARED_MIME)) !== 0) {
    mismatchFlags |= MISMATCH_DISGUISED_EXECUTABLE;
  }
  if (detected && isTextLike(extensionMime) && signature.kind !== "text" && signature.kind !== "script") {
    mismatchFlags |= MISMATCH_EXTENSION;
  }
  if (looksTruncated(buffer, signature.kind, signature.mime)) mismatchFlags |= MISMATCH_TRUNCATED;
  if (detected && buffer.length > 4) {
    const tail = buffer.subarray(4, Math.min(buffer.length, 65_536));
    if (signature.mime !== "application/pdf" && contains(tail, "%PDF-")) mismatchFlags |= MISMATCH_POLYGLOT;
    if (
      !signature.mime.startsWith("application/vnd.microsoft")
      && startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])
      && contains(buffer.subarray(0, Math.min(buffer.length, 1024)), "This program cannot be run in DOS mode")
    ) {
      mismatchFlags |= MISMATCH_POLYGLOT;
    }
  }

  return {
    mime: signature.mime,
    description: signature.description,
    encoding,
    kind: signature.kind,
    extensionMime,
    declaredMime: normalizedDeclared,
    mismatchFlags
  };
}

const DETECTED_KINDS = new Set<string>(["executable", "archive", "document", "script", "image", "media", "text", "other"]);

function toDetectedKind(value: unknown): DetectedKind | null {
  return typeof value === "string" && DETECTED_KINDS.has(value) ? (value as DetectedKind) : null;
}

export function inspectMagic(buffer: Buffer, filename: string, declaredMime: string): MagicReport {
  const native = getNativeFuzzy();
  const fn = native
    ? (typeof native.inspectMagic === "function" ? native.inspectMagic : native.inspect_magic)
    : undefined;
  if (typeof fn === "function") {
    try {
      const report = fn.call(native, buffer, String(filename || ""), String(declaredMime || ""));
      const kind = toDetectedKind(report?.kind);
      if (kind && typeof report.mime === "string") {
        return {
          mime: report.mime,
          description: String(report.description ?? ""),
          encoding: String(report.encoding ?? ""),
          kind,
          extensionMime: String(report.extensionMime ?? ""),
          declaredMime: String(report.declaredMime ?? ""),
          mismatchFlags: Number(report.mismatchFlags) || 0
        };
      }
      recordNativeFallback("inspectMagic", new Error("raport nativ invalid"));
    } catch (error) {
      recordNativeFallback("inspectMagic", error);
    }
  }
  return inspectMagicFallback(buffer, filename, declaredMime);
}

export function describeMismatches(report: MagicReport): string[] {
  const notes: string[] = [];
  if (report.mismatchFlags & MISMATCH_EXTENSION) {
    notes.push(`extensia fisierului sugereaza ${report.extensionMime || "alt tip"}, dar continutul este ${report.mime}`);
  }
  if (report.mismatchFlags & MISMATCH_DECLARED_MIME) {
    notes.push(`tipul declarat ${report.declaredMime} nu corespunde continutului ${report.mime}`);
  }
  if (report.mismatchFlags & MISMATCH_DISGUISED_EXECUTABLE) {
    notes.push("executabil prezentat sub alt tip de fisier");
  }
  if (report.mismatchFlags & MISMATCH_POLYGLOT) {
    notes.push("continut poliglot: mai multe formate valide in acelasi fisier");
  }
  if (report.mismatchFlags & MISMATCH_TRUNCATED) {
    notes.push("continut trunchiat sau incomplet");
  }
  return notes;
}

export default { inspectMagic, inspectMagicFallback, describeMismatches };
