"use strict";

import { gunzipSync, inflateRawSync } from "node:zlib";

export type ThreatArchiveFormat = "zip" | "tar" | "gzip" | "rar" | "7z" | "pdf" | "office" | "unknown";

export type ThreatScanLimits = {
  maxDepth: number;
  maxEntries: number;
  maxDecompressedBytes: number;
  maxCompressionRatio: number;
  maxScanMs: number;
};

export const DEFAULT_THREAT_SCAN_LIMITS: ThreatScanLimits = Object.freeze({
  maxDepth: 4,
  maxEntries: 256,
  maxDecompressedBytes: 8 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxScanMs: 250
});

export type ThreatArchiveFinding = {
  kind: "macro" | "script" | "active-object" | "external-reference" | "pdf-action" | "archive-limit" | "encrypted" | "unsupported";
  path?: string;
  detail: string;
};

export type ThreatArchiveInspection = {
  format: ThreatArchiveFormat;
  complete: boolean;
  state: "clean" | "suspicious" | "uncertain" | "unsupported";
  entries: number;
  decompressedBytes: number;
  maxDepth: number;
  findings: ThreatArchiveFinding[];
  reason: string;
};

type InspectionContext = {
  limits: ThreatScanLimits;
  startedAt: number;
  entries: number;
  decompressedBytes: number;
  maxDepth: number;
  findings: ThreatArchiveFinding[];
};

function positiveLimit(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function normalizeThreatScanLimits(input?: Partial<ThreatScanLimits>): ThreatScanLimits {
  const source = input ?? {};
  return {
    maxDepth: positiveLimit(source.maxDepth ?? 0, DEFAULT_THREAT_SCAN_LIMITS.maxDepth),
    maxEntries: positiveLimit(source.maxEntries ?? 0, DEFAULT_THREAT_SCAN_LIMITS.maxEntries),
    maxDecompressedBytes: positiveLimit(source.maxDecompressedBytes ?? 0, DEFAULT_THREAT_SCAN_LIMITS.maxDecompressedBytes),
    maxCompressionRatio: positiveLimit(source.maxCompressionRatio ?? 0, DEFAULT_THREAT_SCAN_LIMITS.maxCompressionRatio),
    maxScanMs: positiveLimit(source.maxScanMs ?? 0, DEFAULT_THREAT_SCAN_LIMITS.maxScanMs)
  };
}

function text(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

function hasAscii(bytes: Uint8Array, pattern: RegExp): boolean {
  return pattern.test(text(bytes));
}

function extension(name: string): string {
  const normalized = name.toLowerCase().split(/[?#]/, 1)[0];
  const index = normalized.lastIndexOf(".");
  return index >= 0 ? normalized.slice(index) : "";
}

export function detectThreatArchiveFormat(bytes: Uint8Array, name = ""): ThreatArchiveFormat {
  if (bytes.length >= 6 && bytes[0] === 0x37 && bytes[1] === 0x7a && bytes[2] === 0xbc && bytes[3] === 0xaf && bytes[4] === 0x27 && bytes[5] === 0x1c) return "7z";
  if (bytes.length >= 7 && bytes[0] === 0x52 && bytes[1] === 0x61 && bytes[2] === 0x72 && bytes[3] === 0x21 && bytes[4] === 0x1a && bytes[5] === 0x07) return "rar";
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return "gzip";
  if (bytes.length >= 4 && ((bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x05 && bytes[3] === 0x06) || (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x07 && bytes[3] === 0x08))) return "zip";
  if (bytes.length >= 262 && text(bytes.subarray(257, 262)) === "ustar") return "tar";
  if (extension(name) === ".pdf" || bytes.length >= 5 && text(bytes.subarray(0, 5)) === "%PDF-") return "pdf";
  if (/\.(?:docx|docm|xlsx|xlsm|pptx|pptm)$/i.test(name)) return "office";
  return "unknown";
}

function addFinding(context: InspectionContext, finding: ThreatArchiveFinding): void {
  if (!context.findings.some(existing => existing.kind === finding.kind && existing.path === finding.path && existing.detail === finding.detail)) context.findings.push(finding);
}

function limitReached(context: InspectionContext, depth: number): boolean {
  if (Date.now() - context.startedAt > context.limits.maxScanMs) {
    addFinding(context, { kind: "archive-limit", detail: "bugetul de timp al scanarii a fost depasit" });
    return true;
  }
  if (depth > context.limits.maxDepth) {
    addFinding(context, { kind: "archive-limit", detail: "adancimea maxima a arhivei a fost depasita" });
    return true;
  }
  if (context.entries >= context.limits.maxEntries) {
    addFinding(context, { kind: "archive-limit", detail: "numarul maxim de intrari a fost depasit" });
    return true;
  }
  return false;
}

function addDecompressedBytes(context: InspectionContext, bytes: number, compressedBytes: number): boolean {
  context.decompressedBytes += Math.max(0, bytes);
  if (context.decompressedBytes > context.limits.maxDecompressedBytes) {
    addFinding(context, { kind: "archive-limit", detail: "bugetul de bytes decomprimati a fost depasit" });
    return false;
  }
  if (compressedBytes > 0 && bytes / compressedBytes > context.limits.maxCompressionRatio) {
    addFinding(context, { kind: "archive-limit", detail: "raportul de compresie a depasit limita anti-bomba" });
    return false;
  }
  return true;
}

function passiveDocumentFindings(bytes: Uint8Array, name: string, context: InspectionContext): ThreatArchiveFormat {
  const format = detectThreatArchiveFormat(bytes, name);
  if (format === "pdf") {
    const source = text(bytes);
    if (/\/JavaScript|\/JS\b/i.test(source)) addFinding(context, { kind: "script", detail: "PDF-ul contine JavaScript" });
    if (/\/AA\b|\/OpenAction\b|\/Launch\b|\/GoToR\b/i.test(source)) addFinding(context, { kind: "pdf-action", detail: "PDF-ul contine o actiune automata sau externa" });
    if (/\/EmbeddedFile\b|\/RichMedia\b|\/XFA\b|\/AcroForm\b/i.test(source)) addFinding(context, { kind: "active-object", detail: "PDF-ul contine obiecte active sau atasamente" });
    if (/https?:\/\/|\/URI\b/i.test(source)) addFinding(context, { kind: "external-reference", detail: "PDF-ul contine referinte externe" });
    return format;
  }
  if (format === "office") {
    const source = text(bytes);
    if (/vbaProject|macros|oleObject|activex|customUI/i.test(source)) addFinding(context, { kind: "macro", detail: "pachetul Office contine macrocomenzi sau obiecte OLE/ActiveX" });
    if (/TargetMode\s*=\s*["']External["']|externalLinks|https?:\/\/|DDE/i.test(source)) addFinding(context, { kind: "external-reference", detail: "pachetul Office contine referinte externe sau DDE" });
    return format;
  }
  return format;
}

function inspectZip(bytes: Uint8Array, name: string, context: InspectionContext, depth: number): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= 0 && offset >= bytes.length - 65_557; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  if (end < 0) {
    addFinding(context, { kind: "unsupported", detail: "central directory ZIP lipseste sau este trunchiat" });
    return;
  }
  const centralSize = view.getUint32(end + 12, true);
  const centralOffset = view.getUint32(end + 16, true);
  if (centralOffset + centralSize > bytes.length) {
    addFinding(context, { kind: "archive-limit", detail: "central directory ZIP depaseste obiectul descarcat" });
    return;
  }
  let offset = centralOffset;
  const packageText = text(bytes);
  const officePackage = /\[Content_Types\]\.xml|(?:^|\/)word\//i.test(packageText) || /\.(?:docx|docm|xlsx|xlsm|pptx|pptm)$/i.test(name);
  if (officePackage && /vbaProject|vbaData|macros|oleObject|activex/i.test(packageText)) addFinding(context, { kind: "macro", detail: "pachet Office cu macrocomponente sau obiecte active" });
  if (officePackage && /externalLinks|TargetMode="External"|https?:\/\/|DDE/i.test(packageText)) addFinding(context, { kind: "external-reference", detail: "pachet Office cu referinte externe sau DDE" });
  while (offset + 46 <= centralOffset + centralSize) {
    if (limitReached(context, depth)) return;
    if (view.getUint32(offset, true) !== 0x02014b50) {
      addFinding(context, { kind: "unsupported", detail: "intrare ZIP invalida" });
      return;
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const entryName = text(bytes.subarray(offset + 46, offset + 46 + nameLength));
    context.entries++;
    if ((flags & 1) !== 0) {
      addFinding(context, { kind: "encrypted", path: entryName, detail: "intrarea ZIP este criptata" });
    } else if (localOffset + 30 <= bytes.length && localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true) + compressedSize <= bytes.length) {
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const compressed = bytes.subarray(localOffset + 30 + localNameLength + localExtraLength, localOffset + 30 + localNameLength + localExtraLength + compressedSize);
      let entryBytes: Uint8Array | null = null;
      try {
        if (method === 0) entryBytes = compressed;
        else if (method === 8) entryBytes = new Uint8Array(inflateRawSync(compressed));
        else addFinding(context, { kind: "unsupported", path: entryName, detail: `metoda ZIP ${method} nu este suportata` });
      } catch {
        addFinding(context, { kind: "unsupported", path: entryName, detail: "intrarea ZIP nu a putut fi decomprimata" });
      }
      if (entryBytes && !addDecompressedBytes(context, Math.max(entryBytes.length, uncompressedSize), compressed.length)) return;
      if (entryBytes && !entryName.endsWith("/")) {
        const childFormat = detectThreatArchiveFormat(entryBytes, entryName);
        if (childFormat === "zip" || childFormat === "tar" || childFormat === "gzip") inspectArchiveBytes(entryBytes, entryName, context, depth + 1);
        else passiveDocumentFindings(entryBytes, entryName, context);
      }
    } else {
      addFinding(context, { kind: "archive-limit", path: entryName, detail: "intrarea ZIP este trunchiata" });
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
}

function parseTarSize(bytes: Uint8Array): number | null {
  const value = text(bytes).replace(/\0.*$/, "").trim();
  if (!value) return 0;
  const parsed = Number.parseInt(value, 8);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function inspectTar(bytes: Uint8Array, context: InspectionContext, depth: number): void {
  let offset = 0;
  while (offset + 512 <= bytes.length) {
    if (limitReached(context, depth)) return;
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) return;
    const size = parseTarSize(header.subarray(124, 136));
    const name = text(header.subarray(0, 100)).replace(/\0.*$/, "");
    if (size === null) {
      addFinding(context, { kind: "unsupported", path: name, detail: "dimensiunea TAR este invalida" });
      return;
    }
    context.entries++;
    const start = offset + 512;
    const end = start + size;
    if (end > bytes.length || !addDecompressedBytes(context, size, Math.max(1, size))) {
      addFinding(context, { kind: "archive-limit", path: name, detail: "intrarea TAR este trunchiata sau depaseste bugetul" });
      return;
    }
    const entryBytes = bytes.subarray(start, end);
    const childFormat = detectThreatArchiveFormat(entryBytes, name);
    if (childFormat === "zip" || childFormat === "tar" || childFormat === "gzip") inspectArchiveBytes(entryBytes, name, context, depth + 1);
    else passiveDocumentFindings(entryBytes, name, context);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (offset !== bytes.length) addFinding(context, { kind: "archive-limit", detail: "arhiva TAR este trunchiata" });
}

function inspectArchiveBytes(bytes: Uint8Array, name: string, context: InspectionContext, depth: number): void {
  if (limitReached(context, depth)) return;
  const format = detectThreatArchiveFormat(bytes, name);
  context.maxDepth = Math.max(context.maxDepth, depth);
  if (format === "zip") return inspectZip(bytes, name, context, depth);
  if (format === "tar") return inspectTar(bytes, context, depth);
  if (format === "gzip") {
    try {
      const inflated = new Uint8Array(gunzipSync(bytes));
      if (!addDecompressedBytes(context, inflated.length, bytes.length)) return;
      inspectArchiveBytes(inflated, name.replace(/\.gz$/i, ""), context, depth + 1);
    } catch {
      addFinding(context, { kind: "unsupported", detail: "GZIP-ul este trunchiat sau invalid" });
    }
  }
}

export function inspectThreatBytes(bytes: Uint8Array, name = "", limits?: Partial<ThreatScanLimits>): ThreatArchiveInspection {
  const context: InspectionContext = {
    limits: normalizeThreatScanLimits(limits),
    startedAt: Date.now(),
    entries: 0,
    decompressedBytes: 0,
    maxDepth: 0,
    findings: []
  };
  const format = passiveDocumentFindings(bytes, name, context);
  if (format === "rar" || format === "7z") addFinding(context, { kind: "unsupported", detail: `${format.toUpperCase()} necesita un motor extern verificabil` });
  else if (format === "zip" || format === "tar" || format === "gzip") inspectArchiveBytes(bytes, name, context, 0);
  const incomplete = context.findings.some(finding => finding.kind === "archive-limit" || finding.kind === "encrypted" || finding.kind === "unsupported");
  const suspicious = context.findings.some(finding => ["macro", "script", "active-object", "external-reference", "pdf-action"].includes(finding.kind));
  const reason = context.findings.map(finding => finding.detail).join("; ") || "nu au fost detectati indicatori pasivi";
  return {
    format,
    complete: !incomplete,
    state: incomplete ? "uncertain" : suspicious ? "suspicious" : "clean",
    entries: context.entries,
    decompressedBytes: context.decompressedBytes,
    maxDepth: context.maxDepth,
    findings: context.findings,
    reason
  };
}

export default { detectThreatArchiveFormat, inspectThreatBytes, normalizeThreatScanLimits, DEFAULT_THREAT_SCAN_LIMITS };
