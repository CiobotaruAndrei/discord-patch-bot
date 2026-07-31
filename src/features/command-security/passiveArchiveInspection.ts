"use strict";

import { gunzipSync, inflateRawSync } from "node:zlib";
import { getNativeFuzzy, recordNativeFallback } from "../../native/fuzzy.js";
import { enforceBudget, inspected, resolveLimits, uncertain, DEFAULT_INSPECTION_LIMITS, MAX_DEPTH, MAX_ENTRIES, MAX_EXPANDED_BYTES, MAX_COMPRESSION_RATIO, MAX_INSPECTION_MS } from "./archiveInspectionBudget.js";
import type { InspectionBudget, InspectionLimits, PassiveArchiveFinding } from "./archiveInspectionBudget.js";
import { contentIndicators, nameIndicators, textLinkIndicators } from "./archiveContentIndicators.js";
import { isPdfDocument, pdfStructuralIndicators, hasObfuscatedPdfActionName } from "./pdfInspection.js";
import { inspectCompoundFileBinary, isCompoundFileBinary } from "./compoundFileInspection.js";
import { scanRar4Headers, scanRar5Headers, scanSevenZipHeaders } from "./rarSevenZipHeaders.js";

export type { PassiveArchiveFinding, InspectionLimits } from "./archiveInspectionBudget.js";
export { DEFAULT_INSPECTION_LIMITS } from "./archiveInspectionBudget.js";
import { recordAnalysisBlindSpot, recordUninspectableFormat } from "./coverageGapMetrics.js";
import { inspectInIsolatedProcess, isolatedInspectionStatus } from "./isolatedInspection.js";


export interface InspectionReport {
  status: "inspected" | "uncertain";
  indicators: string[];
  reason: string;
  entriesInspected: number;
  expandedBytes: number;
  elapsedMs: number;
  uninspectableFormat?: string;
  analysisBlindSpots?: string[];
}
export { hasObfuscatedPdfActionName } from "./pdfInspection.js";
export { inspectCompoundFileBinary } from "./compoundFileInspection.js";

function zipEntryData(buffer: Buffer, offset: number, compressedSize: number, uncompressedSize: number, method: number, maxExpandedBytes: number): Buffer {
  const compressed = buffer.subarray(offset, offset + compressedSize);
  if (method === 0) return Buffer.from(compressed);
  if (method === 8) return inflateRawSync(compressed, { maxOutputLength: Math.min(uncompressedSize || maxExpandedBytes, maxExpandedBytes) });
  throw new Error(`metoda ZIP ${method} nu este suportata pasiv`);
}

function inspectZip(buffer: Buffer, depth: number, budget: InspectionBudget): PassiveArchiveFinding {
  if (depth > budget.limits.maxDepth) return uncertain(`arhiva depaseste adancimea maxima ${budget.limits.maxDepth}`);
  const indicators: string[] = [];
  let offset = 0;
  let entries = 0;
  while (offset + 4 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50) return uncertain("structura ZIP trunchiata sau necunoscuta", indicators);
    if (offset + 8 <= buffer.length && (buffer.readUInt16LE(offset + 6) & 0x0001) !== 0) return uncertain("arhiva criptata ZIP", indicators);
    if (offset + 30 > buffer.length) return uncertain("header ZIP trunchiat", indicators);
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    if ((flags & 0x0008) !== 0) return uncertain("arhiva ZIP cu dimensiuni post-date nu poate fi inspectata strict", indicators);
    const dataOffset = offset + 30 + nameLength + extraLength;
    const endOffset = dataOffset + compressedSize;
    if (dataOffset > buffer.length || endOffset > buffer.length) return uncertain("intrare ZIP trunchiata", indicators);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    if (!name.endsWith("/")) {
      const limitFailure = enforceBudget(budget, compressedSize, uncompressedSize);
      if (limitFailure) return uncertain(limitFailure, indicators);
      let entry: Buffer;
      try {
        entry = zipEntryData(buffer, dataOffset, compressedSize, uncompressedSize, method, budget.limits.maxExpandedBytes);
      } catch (error) {
        return uncertain(error instanceof Error ? error.message : "intrarea ZIP nu a putut fi decomprimata", indicators);
      }
      if (uncompressedSize !== 0 && entry.length !== uncompressedSize) return uncertain("dimensiunea decomprimata ZIP nu corespunde headerului", indicators);
      indicators.push(...contentIndicators(name, entry, budget));
      const nested = inspectNested(name, entry, depth + 1, budget);
      indicators.push(...nested.indicators);
      if (nested.status === "uncertain") return uncertain(nested.reason, indicators);
    }
    entries++;
    offset = endOffset;
  }
  return entries > 0 ? inspected(indicators) : uncertain("arhiva ZIP nu contine intrari locale inspectabile", indicators);
}

function inspectTar(buffer: Buffer, depth: number, budget: InspectionBudget): PassiveArchiveFinding {
  if (depth > budget.limits.maxDepth) return uncertain(`arhiva depaseste adancimea maxima ${budget.limits.maxDepth}`);
  const indicators: string[] = [];
  let offset = 0;
  let entries = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const rawSize = header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim();
    const size = Number.parseInt(rawSize || "0", 8);
    if (!Number.isFinite(size) || size < 0) return uncertain("header TAR invalid", indicators);
    const dataOffset = offset + 512;
    const endOffset = dataOffset + size;
    if (endOffset > buffer.length) return uncertain("intrare TAR trunchiata", indicators);
    const limitFailure = enforceBudget(budget, size, size);
    if (limitFailure) return uncertain(limitFailure, indicators);
    const entry = buffer.subarray(dataOffset, endOffset);
    indicators.push(...contentIndicators(name, entry, budget));
    const nested = inspectNested(name, entry, depth + 1, budget);
    indicators.push(...nested.indicators);
    if (nested.status === "uncertain") return uncertain(nested.reason, indicators);
    entries++;
    offset = dataOffset + Math.ceil(size / 512) * 512;
  }
  return entries > 0 ? inspected(indicators) : uncertain("arhiva TAR nu contine intrari inspectabile", indicators);
}

function inspectGzip(buffer: Buffer, depth: number, budget: InspectionBudget): PassiveArchiveFinding {
  if (depth > budget.limits.maxDepth) return uncertain(`arhiva depaseste adancimea maxima ${budget.limits.maxDepth}`);
  let expanded: Buffer;
  try {
    expanded = gunzipSync(buffer, { maxOutputLength: budget.limits.maxExpandedBytes });
  } catch {
    return uncertain("arhiva GZIP este trunchiata, invalida sau depaseste limita decomprimata");
  }
  const limitFailure = enforceBudget(budget, buffer.length, expanded.length);
  if (limitFailure) return uncertain(limitFailure);
  const tar = inspectTar(expanded, depth + 1, budget);
  if (tar.status === "inspected") return tar;
  const indicators = contentIndicators("payload", expanded, budget);
  const nested = inspectNested("payload", expanded, depth + 1, budget);
  indicators.push(...nested.indicators);
  return nested.status === "uncertain" && indicators.length === 0 ? uncertain(tar.reason) : inspected(indicators);
}

function inspectNested(name: string, buffer: Buffer, depth: number, budget: InspectionBudget): PassiveArchiveFinding {
  if (buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50) return inspectZip(buffer, depth, budget);
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) return inspectGzip(buffer, depth, budget);
  if (name.toLowerCase().endsWith(".tar") || (buffer.length >= 262 && buffer.subarray(257, 262).toString("ascii") === "ustar")) {
    return inspectTar(buffer, depth, budget);
  }
  return inspected([]);
}

export function inspectArchivePassively(buffer: Buffer): PassiveArchiveFinding {
  const budget: InspectionBudget = { entries: 0, expandedBytes: 0, startedAt: Date.now(), limits: DEFAULT_INSPECTION_LIMITS };
  if (isZipContainer(buffer)) return inspectZip(buffer, 0, budget);
  if (isGzipContainer(buffer)) return inspectGzip(buffer, 0, budget);
  if (isTarContainer(buffer)) return inspectTar(buffer, 0, budget);
  if (isRar4Container(buffer) || isRar5Container(buffer)) return inspectRar(buffer, budget);
  if (isSevenZipContainer(buffer)) return inspectSevenZip(buffer);
  return uncertain(NO_LOCAL_DECODER_REASON);
}

const NO_LOCAL_DECODER_REASON = "formatul arhivei nu are un decodor pasiv local; verdictul ramane neconfirmat";
const ARCHIVE_EXTENSIONS = [".zip", ".tar", ".gz", ".tgz", ".rar", ".7z", ".bz2", ".xz"];
const ARCHIVE_MIME_TOKENS = ["zip", "tar", "gzip", "x-rar", "7z", "compressed"];

function isZipContainer(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50;
}

function isGzipContainer(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
}

function isTarContainer(buffer: Buffer): boolean {
  return buffer.length >= 262 && buffer.subarray(257, 262).toString("ascii") === "ustar";
}

interface HeaderEntry {
  name: string;
  encrypted: boolean;
  directory: boolean;
}

interface HeaderScan {
  entries: HeaderEntry[];
  encryptedHeaders: boolean;
  truncated: string | null;
}

const RAR4_SIGNATURE = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]);
const RAR5_SIGNATURE = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]);
const SEVEN_ZIP_SIGNATURE = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);

function isRar4Container(buffer: Buffer): boolean {
  return buffer.length >= 7 && buffer.subarray(0, 7).equals(RAR4_SIGNATURE);
}

function isRar5Container(buffer: Buffer): boolean {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(RAR5_SIGNATURE);
}

function isSevenZipContainer(buffer: Buffer): boolean {
  return buffer.length >= 32 && buffer.subarray(0, 6).equals(SEVEN_ZIP_SIGNATURE);
}

function headerScanFinding(scan: HeaderScan, format: string): PassiveArchiveFinding {
  const indicators: string[] = [];
  let encryptedEntries = false;
  for (const entry of scan.entries) {
    if (entry.encrypted) encryptedEntries = true;
    if (!entry.directory) indicators.push(...nameIndicators(entry.name));
  }
  const unique = [...new Set(indicators)];
  if (scan.encryptedHeaders) {
    return uncertain(`arhiva ${format} are headerul criptat; numele intrarilor nu pot fi citite fara parola`, unique);
  }
  if (encryptedEntries) return uncertain(`arhiva criptata ${format}`, unique);
  if (scan.truncated) return uncertain(scan.truncated, unique);
  if (scan.entries.length === 0) {
    return uncertain(`arhiva ${format} nu expune nume de intrari inspectabile pasiv; continutul nu are decodor local`, unique);
  }
  return uncertain(
    `arhiva ${format} inspectata structural doar la nivel de header (${scan.entries.length} intrari); continutul comprimat nu are decodor pasiv local`,
    unique
  );
}

function inspectRar(buffer: Buffer, budget: InspectionBudget): PassiveArchiveFinding {
  return headerScanFinding(isRar5Container(buffer) ? scanRar5Headers(buffer, budget) : scanRar4Headers(buffer, budget), "RAR");
}

function inspectSevenZip(buffer: Buffer): PassiveArchiveFinding {
  return headerScanFinding(scanSevenZipHeaders(buffer), "7z");
}

function looksLikeArchive(buffer: Buffer, filename: string, mime: string): boolean {
  if (isZipContainer(buffer) || isGzipContainer(buffer) || isTarContainer(buffer)) return true;
  if (buffer.length >= 7 && buffer.subarray(0, 4).toString("latin1") === "Rar!" && buffer[4] === 0x1a && buffer[5] === 0x07) return true;
  if (buffer.length >= 6 && buffer[0] === 0x37 && buffer[1] === 0x7a && buffer[2] === 0xbc && buffer[3] === 0xaf && buffer[4] === 0x27 && buffer[5] === 0x1c) return true;
  const name = String(filename || "").toLowerCase();
  if (ARCHIVE_EXTENSIONS.some(extension => name.endsWith(extension))) return true;
  const type = String(mime || "").toLowerCase();
  return ARCHIVE_MIME_TOKENS.some(token => type.includes(token));
}

export function documentIndicators(buffer: Buffer): string[] {
  const window = buffer.subarray(0, Math.min(buffer.length, 1_048_576));
  const ascii = window.toString("latin1");
  const indicators: string[] = [];
  if (ascii.includes("vbaProject.bin") || ascii.includes("word/vbaProject") || ascii.includes("macros/vba") || ascii.includes("_VBA_PROJECT") || /\bMacros\b/.test(ascii)) {
    indicators.push("indicator de macro VBA");
  }
  if (/\/JavaScript\b/.test(ascii) || /\/JS\b/.test(ascii) || ascii.includes("/OpenAction") || /\/AA\b/.test(ascii) || hasObfuscatedPdfActionName(ascii)) {
    indicators.push("indicator de script/actiune automata in document");
  }
  if (ascii.includes("/Launch") || ascii.includes("/EmbeddedFile") || ascii.includes("/RichMedia") || ascii.includes("/GoToR")) {
    indicators.push("indicator de lansare de proces sau continut incorporat");
  }
  if (ascii.includes("DDEAUTO") || /\bDDE\s/.test(ascii)) {
    indicators.push("indicator de camp DDE (executie externa)");
  }
  if (ascii.includes("/XFA")) {
    indicators.push("formular XFA cu potential de script");
  }
  indicators.push(...inspectCompoundFileBinary(buffer));
  return [...new Set(indicators)];
}

export type InspectionMode = "archive" | "document" | "auto";

function documentFinding(buffer: Buffer, budget: InspectionBudget): PassiveArchiveFinding {
  const indicators = [...new Set([...documentIndicators(buffer), ...textLinkIndicators(buffer), ...pdfStructuralIndicators(buffer, budget)])];
  return {
    status: "inspected",
    indicators,
    reason: indicators.length > 0 ? "document inspectat structural cu indicatori" : "document inspectat structural fara indicatori"
  };
}

export function inspectUntrustedContentFallback(
  buffer: Buffer,
  filename: string,
  mime: string,
  mode: InspectionMode = "auto",
  limits: Partial<InspectionLimits> = {}
): InspectionReport {
  const startedAt = Date.now();
  const budget: InspectionBudget = { entries: 0, expandedBytes: 0, startedAt, limits: resolveLimits(limits) };
  let finding: PassiveArchiveFinding;
  if (mode === "document") finding = documentFinding(buffer, budget);
  else if (isZipContainer(buffer)) finding = inspectZip(buffer, 0, budget);
  else if (isGzipContainer(buffer)) finding = inspectGzip(buffer, 0, budget);
  else if (isTarContainer(buffer)) finding = inspectTar(buffer, 0, budget);
  else if (isRar4Container(buffer) || isRar5Container(buffer)) finding = inspectRar(buffer, budget);
  else if (isSevenZipContainer(buffer)) finding = inspectSevenZip(buffer);
  else if (mode === "archive" || looksLikeArchive(buffer, filename, mime)) finding = uncertain(NO_LOCAL_DECODER_REASON);
  else finding = documentFinding(buffer, budget);
  return {
    status: finding.status,
    indicators: [...new Set(finding.indicators)],
    reason: finding.reason,
    entriesInspected: budget.entries,
    expandedBytes: budget.expandedBytes,
    elapsedMs: Date.now() - startedAt
  };
}

function recordCoverageGaps(report: InspectionReport): InspectionReport {
  if (typeof report.uninspectableFormat === "string") recordUninspectableFormat(report.uninspectableFormat);
  for (const spot of report.analysisBlindSpots ?? []) recordAnalysisBlindSpot(String(spot));
  return report;
}

export async function inspectUntrustedContent(
  buffer: Buffer,
  filename: string,
  mime: string,
  mode: InspectionMode = "auto",
  limits: Partial<InspectionLimits> = {}
): Promise<InspectionReport> {
  if (isolatedInspectionStatus().isolated) {
    const isolated = await inspectInIsolatedProcess(buffer, String(filename || ""), String(mime || ""), mode, resolveLimits(limits));
    if (isolated) return recordCoverageGaps(isolated);
    recordNativeFallback("inspectUntrustedContent", new Error("procesul izolat nu a produs verdict"));
    return inspectUntrustedContentFallback(buffer, filename, mime, mode, limits);
  }
  const native = getNativeFuzzy();
  const fn = native
    ? (typeof native.inspectUntrustedContent === "function" ? native.inspectUntrustedContent : native.inspect_untrusted_content)
    : undefined;
  if (typeof fn === "function") {
    try {
      const report = await fn.call(native, {
        bytes: buffer,
        filename: String(filename || ""),
        mime: String(mime || ""),
        mode,
        maxDepth: limits.maxDepth ?? 0,
        maxEntries: limits.maxEntries ?? 0,
        maxExpandedBytes: limits.maxExpandedBytes ?? 0,
        maxCompressionRatio: limits.maxCompressionRatio ?? 0,
        timeoutMs: limits.timeoutMs ?? 0
      });
      if (report && (report.status === "inspected" || report.status === "uncertain")) {
        return recordCoverageGaps({
          status: report.status,
          indicators: Array.isArray(report.indicators) ? report.indicators.map(indicator => String(indicator)) : [],
          reason: String(report.reason || ""),
          entriesInspected: Number(report.entriesInspected) || 0,
          expandedBytes: Number(report.expandedBytes) || 0,
          elapsedMs: Number(report.elapsedMs) || 0,
          uninspectableFormat: typeof report.uninspectableFormat === "string" ? report.uninspectableFormat : undefined,
          analysisBlindSpots: Array.isArray(report.analysisBlindSpots) ? report.analysisBlindSpots.map(spot => String(spot)) : undefined
        });
      }
      recordNativeFallback("inspectUntrustedContent", new Error("raport nativ invalid"));
    } catch (error) {
      recordNativeFallback("inspectUntrustedContent", error);
    }
  }
  return inspectUntrustedContentFallback(buffer, filename, mime, mode, limits);
}

export default { inspectArchivePassively, inspectUntrustedContent };
