"use strict";

import { gunzipSync, inflateRawSync, inflateSync } from "node:zlib";
import { getNativeFuzzy, recordNativeFallback } from "../../native/fuzzy.js";

export interface PassiveArchiveFinding {
  status: "inspected" | "uncertain";
  indicators: string[];
  reason: string;
}

import { recordUninspectableFormat } from "./uninspectableFormatMetrics.js";

export interface InspectionReport {
  status: "inspected" | "uncertain";
  indicators: string[];
  reason: string;
  entriesInspected: number;
  expandedBytes: number;
  elapsedMs: number;
  uninspectableFormat?: string;
}

export interface InspectionLimits {
  maxDepth: number;
  maxEntries: number;
  maxExpandedBytes: number;
  maxCompressionRatio: number;
  timeoutMs: number;
}

interface InspectionBudget {
  entries: number;
  expandedBytes: number;
  startedAt: number;
  limits: InspectionLimits;
}

const MAX_DEPTH = 3;
const MAX_ENTRIES = 64;
const MAX_EXPANDED_BYTES = 8 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 100;
const MAX_INSPECTION_MS = 100;

export const DEFAULT_INSPECTION_LIMITS: InspectionLimits = {
  maxDepth: MAX_DEPTH,
  maxEntries: MAX_ENTRIES,
  maxExpandedBytes: MAX_EXPANDED_BYTES,
  maxCompressionRatio: MAX_COMPRESSION_RATIO,
  timeoutMs: MAX_INSPECTION_MS
};

function resolveLimits(limits: Partial<InspectionLimits>): InspectionLimits {
  return {
    maxDepth: limits.maxDepth && limits.maxDepth > 0 ? limits.maxDepth : DEFAULT_INSPECTION_LIMITS.maxDepth,
    maxEntries: limits.maxEntries && limits.maxEntries > 0 ? limits.maxEntries : DEFAULT_INSPECTION_LIMITS.maxEntries,
    maxExpandedBytes: limits.maxExpandedBytes && limits.maxExpandedBytes > 0 ? limits.maxExpandedBytes : DEFAULT_INSPECTION_LIMITS.maxExpandedBytes,
    maxCompressionRatio: limits.maxCompressionRatio && limits.maxCompressionRatio > 0 ? limits.maxCompressionRatio : DEFAULT_INSPECTION_LIMITS.maxCompressionRatio,
    timeoutMs: limits.timeoutMs && limits.timeoutMs > 0 ? limits.timeoutMs : DEFAULT_INSPECTION_LIMITS.timeoutMs
  };
}

const PDF_DANGEROUS_NAMES = new Set(["JavaScript", "JS", "OpenAction", "AA", "Launch", "EmbeddedFile", "RichMedia", "GoToR"]);

export function hasObfuscatedPdfActionName(text: string): boolean {
  const nameToken = /\/((?:[A-Za-z0-9._-]|#[0-9A-Fa-f]{2}){1,64})/g;
  let match: RegExpExecArray | null;
  while ((match = nameToken.exec(text)) !== null) {
    if (!match[1].includes("#")) continue;
    const decoded = match[1].replace(/#([0-9A-Fa-f]{2})/g, (_full, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
    if (PDF_DANGEROUS_NAMES.has(decoded)) return true;
  }
  return false;
}

const CFB_END_OF_CHAIN = 0xfffffffe;
const CFB_FREE_SECT = 0xffffffff;
const CFB_MAX_FAT_SECTORS = 512;
const CFB_MAX_DIR_ENTRIES = 4096;

function isCompoundFileBinary(buffer: Buffer): boolean {
  return buffer.length >= 512 && buffer.readUInt32BE(0) === 0xd0cf11e0 && buffer.readUInt32BE(4) === 0xa1b11ae1;
}

export function inspectCompoundFileBinary(buffer: Buffer): string[] {
  if (!isCompoundFileBinary(buffer)) return [];
  const indicators: string[] = [];
  try {
    const sectorShift = buffer.readUInt16LE(30);
    if (sectorShift !== 9 && sectorShift !== 12) return indicators;
    const sectorSize = 1 << sectorShift;
    const sectorOffset = (sector: number): number => 512 + sector * sectorSize;
    const entriesPerFatSector = sectorSize / 4;
    const fat: number[] = [];
    const declaredFatSectors = buffer.readUInt32LE(44);
    const fatSectorCount = Math.min(declaredFatSectors, 109, CFB_MAX_FAT_SECTORS);
    for (let i = 0; i < fatSectorCount; i++) {
      const fatSector = buffer.readUInt32LE(76 + i * 4);
      if (fatSector === CFB_FREE_SECT || fatSector === CFB_END_OF_CHAIN) break;
      const base = sectorOffset(fatSector);
      if (base + sectorSize > buffer.length) break;
      for (let j = 0; j < entriesPerFatSector; j++) fat.push(buffer.readUInt32LE(base + j * 4));
    }
    const entriesPerDirSector = Math.floor(sectorSize / 128);
    const visited = new Set<number>();
    let sector = buffer.readUInt32LE(48);
    let inspectedEntries = 0;
    while (sector !== CFB_END_OF_CHAIN && sector !== CFB_FREE_SECT && !visited.has(sector) && inspectedEntries < CFB_MAX_DIR_ENTRIES) {
      visited.add(sector);
      const base = sectorOffset(sector);
      if (base + sectorSize > buffer.length) break;
      for (let e = 0; e < entriesPerDirSector && inspectedEntries < CFB_MAX_DIR_ENTRIES; e++, inspectedEntries++) {
        const entryOffset = base + e * 128;
        const objectType = buffer.readUInt8(entryOffset + 66);
        if (objectType !== 1 && objectType !== 2 && objectType !== 5) continue;
        const nameLength = buffer.readUInt16LE(entryOffset + 64);
        if (nameLength < 4 || nameLength > 64) continue;
        const name = buffer.subarray(entryOffset, entryOffset + nameLength - 2).toString("utf16le");
        const normalized = name.toLowerCase();
        if (normalized === "macros" || normalized === "vba" || normalized === "_vba_project" || normalized === "vbaproject") {
          indicators.push("macro VBA in document OLE (parser structural CFB)");
        }
        if (normalized === "ole10native" || normalized === "objectpool" || normalized === "package") {
          indicators.push("obiect OLE incorporat in document OLE (parser structural CFB)");
        }
      }
      sector = sector < fat.length ? fat[sector] : CFB_END_OF_CHAIN;
    }
  } catch {
    return [...new Set(indicators)];
  }
  return [...new Set(indicators)];
}

function uncertain(reason: string, indicators: string[] = []): PassiveArchiveFinding {
  return { status: "uncertain", indicators, reason };
}

function inspected(indicators: string[]): PassiveArchiveFinding {
  return {
    status: "inspected",
    indicators: [...new Set(indicators)],
    reason: indicators.length > 0 ? "arhiva inspectata pasiv cu indicatori interni" : "arhiva inspectata pasiv fara indicatori interni"
  };
}

function enforceBudget(budget: InspectionBudget, compressedBytes: number, expandedBytes: number): string | null {
  budget.entries++;
  budget.expandedBytes += expandedBytes;
  if (budget.entries > budget.limits.maxEntries) return `arhiva depaseste limita de ${budget.limits.maxEntries} intrari`;
  if (budget.expandedBytes > budget.limits.maxExpandedBytes) return `arhiva depaseste limita de ${budget.limits.maxExpandedBytes} bytes decomprimati`;
  if (compressedBytes > 0 && expandedBytes / compressedBytes > budget.limits.maxCompressionRatio) return `arhiva depaseste raportul maxim de compresie ${budget.limits.maxCompressionRatio}:1`;
  if (Date.now() - budget.startedAt > budget.limits.timeoutMs) return `inspectia arhivei a depasit ${budget.limits.timeoutMs} ms`;
  return null;
}

const PDF_MAX_STREAMS = 64;
const PDF_DICT_LOOKBEHIND = 4096;

function isPdfDocument(buffer: Buffer): boolean {
  return buffer.length >= 5 && buffer.subarray(0, 5).toString("latin1") === "%PDF-";
}

function inflateZlib(data: Buffer, maxOutput: number): Buffer | null {
  try {
    return inflateSync(data, { maxOutputLength: maxOutput });
  } catch {
    return null;
  }
}

function pdfStreamPayload(buffer: Buffer, keywordEnd: number): { payload: Buffer; nextOffset: number } | null {
  let start = keywordEnd;
  if (start < buffer.length && buffer[start] === 0x0d) start++;
  if (start < buffer.length && buffer[start] === 0x0a) start++;
  const end = buffer.indexOf("endstream", start, "latin1");
  if (end === -1) return null;
  return { payload: buffer.subarray(start, end), nextOffset: end + 9 };
}

function pdfActionIndicators(text: string): boolean {
  return /\/JavaScript\b/.test(text)
    || /\/JS\b/.test(text)
    || text.includes("/OpenAction")
    || text.includes("/Launch")
    || /\/AA\b/.test(text)
    || text.includes("/EmbeddedFile")
    || text.includes("/RichMedia")
    || hasObfuscatedPdfActionName(text);
}

function pdfStructuralIndicators(buffer: Buffer, budget: InspectionBudget): string[] {
  if (!isPdfDocument(buffer)) return [];
  const indicators: string[] = [];
  let streams = 0;
  let offset = 0;
  while (streams < PDF_MAX_STREAMS) {
    const keywordStart = buffer.indexOf("stream", offset, "latin1");
    if (keywordStart === -1) break;
    const keywordEnd = keywordStart + 6;
    if (keywordStart >= 3 && buffer.subarray(keywordStart - 3, keywordStart).toString("latin1") === "end") {
      offset = keywordEnd;
      continue;
    }
    const stream = pdfStreamPayload(buffer, keywordEnd);
    if (!stream) break;
    const dictionary = buffer.subarray(Math.max(0, keywordStart - PDF_DICT_LOOKBEHIND), keywordStart).toString("latin1");
    if (dictionary.includes("/FlateDecode") || dictionary.includes("/Fl")) {
      streams++;
      const decoded = inflateZlib(stream.payload, budget.limits.maxExpandedBytes);
      if (decoded) {
        budget.expandedBytes += decoded.length;
        if (budget.expandedBytes > budget.limits.maxExpandedBytes) break;
        const text = decoded.toString("latin1");
        if (pdfActionIndicators(text)) {
          indicators.push("actiune automata sau script PDF in flux comprimat (parser structural PDF)");
        }
        if (text.includes("/Launch") || text.includes("/EmbeddedFile") || text.includes("/RichMedia") || text.includes("/GoToR")) {
          indicators.push("indicator de lansare de proces sau continut incorporat");
        }
        if (text.includes("DDEAUTO") || /\bDDE\s/.test(text)) {
          indicators.push("indicator de camp DDE (executie externa)");
        }
        if (text.includes("/XFA")) {
          indicators.push("formular XFA cu potential de script");
        }
      }
      if (Date.now() - budget.startedAt > budget.limits.timeoutMs) break;
    }
    offset = stream.nextOffset;
  }
  return [...new Set(indicators)];
}

function xmlAttribute(element: string, name: string): string | null {
  const pattern = new RegExp(`(?:^|[^A-Za-z0-9_])${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
  const match = pattern.exec(element);
  if (!match) return null;
  return match[2] ?? match[3] ?? "";
}

function isRemoteTarget(target: string): boolean {
  const lower = target.toLowerCase();
  return lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("ftp://") || lower.startsWith("file://") || lower.startsWith("\\\\");
}

function ooxmlRelationshipIndicators(buffer: Buffer): string[] {
  const text = buffer.toString("latin1");
  const indicators: string[] = [];
  let offset = 0;
  let parsed = 0;
  while (parsed < 512) {
    const start = text.indexOf("<Relationship", offset);
    if (start === -1) break;
    const close = text.indexOf(">", start);
    if (close === -1) break;
    const element = text.slice(start, close);
    parsed++;
    offset = close + 1;
    const relationType = (xmlAttribute(element, "type") ?? "").toLowerCase();
    const target = xmlAttribute(element, "target") ?? "";
    const external = (xmlAttribute(element, "targetmode") ?? "").toLowerCase() === "external";
    if (relationType.endsWith("/vbaproject")) indicators.push("macro sau script Office intern");
    if (relationType.endsWith("/oleobject") || relationType.endsWith("/package")) {
      indicators.push("obiect OLE incorporat in document Office");
    }
    if (external && (relationType.endsWith("/attachedtemplate") || relationType.endsWith("/frame"))) {
      indicators.push("sablon sau cadru Office incarcat dintr-o sursa externa (relatie OOXML)");
    }
    if (external || isRemoteTarget(target)) indicators.push("referinta externa in document Office");
  }
  return [...new Set(indicators)];
}

function nameIndicators(name: string): string[] {
  const normalized = name.replaceAll("\\", "/").toLowerCase();
  const indicators: string[] = [];
  if (normalized.endsWith("vbaproject.bin") || normalized.includes("/macros/") || normalized.endsWith(".vbs")) {
    indicators.push("macro sau script Office intern");
  }
  if (normalized.includes("/embeddings/") || /(?:^|\/)oleobject\d*\.bin$/.test(normalized) || normalized.endsWith(".ole")) {
    indicators.push("obiect OLE incorporat in document Office");
  }
  if (/\.(?:exe|dll|scr|com|bat|cmd|ps1|sh|js|jar)$/i.test(normalized)) {
    indicators.push("fisier executabil sau script intern");
  }
  return indicators;
}

function contentIndicators(name: string, buffer: Buffer, budget: InspectionBudget): string[] {
  const normalized = name.replaceAll("\\", "/").toLowerCase();
  const indicators: string[] = nameIndicators(name);
  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) indicators.push("executabil PE intern");
  if (buffer.length >= 4 && buffer[0] === 0x7f && buffer.subarray(1, 4).toString("ascii") === "ELF") indicators.push("executabil ELF intern");
  const text = buffer.subarray(0, Math.min(buffer.length, 1_048_576)).toString("latin1");
  if (/\/JavaScript\b/.test(text) || /\/JS\b/.test(text) || text.includes("/OpenAction") || text.includes("/Launch") || /\/AA\b/.test(text) || text.includes("/EmbeddedFile") || text.includes("/RichMedia") || hasObfuscatedPdfActionName(text)) {
    indicators.push("actiune automata sau script PDF intern");
  }
  if (text.includes("DDEAUTO") || /\bDDE\s/.test(text)) {
    indicators.push("camp DDE intern (executie externa)");
  }
  if (normalized.endsWith(".rels")) {
    indicators.push(...ooxmlRelationshipIndicators(buffer));
    if (/TargetMode\s*=\s*["']External["']/i.test(text)) {
      indicators.push("referinta externa in document Office");
    }
  }
  indicators.push(...inspectCompoundFileBinary(buffer));
  indicators.push(...pdfStructuralIndicators(buffer, budget));
  return indicators;
}

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

function decodeOemName(raw: Buffer): string {
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? raw.length : end).toString("latin1");
}

function readVint(buffer: Buffer, offset: number): { value: number; used: number } | null {
  let value = 0;
  let shift = 1;
  let cursor = offset;
  while (cursor < buffer.length && cursor - offset < 10) {
    const byte = buffer[cursor];
    value += (byte & 0x7f) * shift;
    cursor++;
    if ((byte & 0x80) === 0) return { value, used: cursor - offset };
    shift *= 128;
  }
  return null;
}

function scanRar4Headers(buffer: Buffer, budget: InspectionBudget): HeaderScan {
  const scan: HeaderScan = { entries: [], encryptedHeaders: false, truncated: null };
  let offset = 7;
  while (offset + 7 <= buffer.length) {
    const headFlags = buffer.readUInt16LE(offset + 3);
    const headSize = buffer.readUInt16LE(offset + 5);
    if (headSize < 7) {
      scan.truncated = "structura RAR trunchiata sau necunoscuta";
      return scan;
    }
    const headType = buffer[offset + 2];
    if (headType === 0x7b) return scan;
    let dataSize = 0;
    if ((headFlags & 0x8000) !== 0) {
      dataSize = offset + 11 <= buffer.length ? buffer.readUInt32LE(offset + 7) : 0;
    }
    if (headType === 0x74) {
      if (offset + 32 > buffer.length) {
        scan.truncated = "header RAR trunchiat";
        return scan;
      }
      const nameSize = buffer.readUInt16LE(offset + 26);
      const nameOffset = offset + 32 + ((headFlags & 0x0100) !== 0 ? 8 : 0);
      if (nameOffset + nameSize > buffer.length) {
        scan.truncated = "nume de intrare RAR trunchiat";
        return scan;
      }
      const limitFailure = enforceBudget(budget, 0, 0);
      if (limitFailure) {
        scan.truncated = limitFailure;
        return scan;
      }
      scan.entries.push({
        name: decodeOemName(buffer.subarray(nameOffset, nameOffset + nameSize)),
        encrypted: (headFlags & 0x0004) !== 0,
        directory: (headFlags & 0x00e0) === 0x00e0
      });
    }
    const advance = headSize + dataSize;
    if (advance <= 0) {
      scan.truncated = "structura RAR trunchiata sau necunoscuta";
      return scan;
    }
    offset += advance;
  }
  if (offset < buffer.length) scan.truncated = "header RAR trunchiat";
  return scan;
}

function readRar5FileName(buffer: Buffer, offset: number): { name: string; fileFlags: number } | null {
  let cursor = offset;
  const fileFlags = readVint(buffer, cursor);
  if (!fileFlags) return null;
  cursor += fileFlags.used;
  const unpackedSize = readVint(buffer, cursor);
  if (!unpackedSize) return null;
  cursor += unpackedSize.used;
  const attributes = readVint(buffer, cursor);
  if (!attributes) return null;
  cursor += attributes.used;
  if ((fileFlags.value & 0x0002) !== 0) cursor += 4;
  if ((fileFlags.value & 0x0004) !== 0) cursor += 4;
  const compression = readVint(buffer, cursor);
  if (!compression) return null;
  cursor += compression.used;
  const hostOs = readVint(buffer, cursor);
  if (!hostOs) return null;
  cursor += hostOs.used;
  const nameLength = readVint(buffer, cursor);
  if (!nameLength) return null;
  cursor += nameLength.used;
  const end = cursor + nameLength.value;
  if (end > buffer.length) return null;
  return { name: buffer.subarray(cursor, end).toString("utf8"), fileFlags: fileFlags.value };
}

function scanRar5Headers(buffer: Buffer, budget: InspectionBudget): HeaderScan {
  const scan: HeaderScan = { entries: [], encryptedHeaders: false, truncated: null };
  let offset = 8;
  const fail = (reason: string): HeaderScan => {
    scan.truncated = reason;
    return scan;
  };
  while (offset + 5 <= buffer.length) {
    let cursor = offset + 4;
    const headerSize = readVint(buffer, cursor);
    if (!headerSize) return fail("structura RAR trunchiata sau necunoscuta");
    cursor += headerSize.used;
    const headerStart = cursor;
    const headerType = readVint(buffer, cursor);
    if (!headerType) return fail("structura RAR trunchiata sau necunoscuta");
    cursor += headerType.used;
    const headerFlags = readVint(buffer, cursor);
    if (!headerFlags) return fail("structura RAR trunchiata sau necunoscuta");
    cursor += headerFlags.used;
    if ((headerFlags.value & 0x0001) !== 0) {
      const extra = readVint(buffer, cursor);
      if (!extra) return fail("structura RAR trunchiata sau necunoscuta");
      cursor += extra.used;
    }
    let dataSize = 0;
    if ((headerFlags.value & 0x0002) !== 0) {
      const declared = readVint(buffer, cursor);
      if (!declared) return fail("structura RAR trunchiata sau necunoscuta");
      dataSize = declared.value;
      cursor += declared.used;
    }
    if (headerType.value === 4) {
      scan.encryptedHeaders = true;
      return scan;
    }
    if (headerType.value === 5) return scan;
    if (headerType.value === 2 || headerType.value === 3) {
      const parsed = readRar5FileName(buffer, cursor);
      if (!parsed) return fail("nume de intrare RAR trunchiat");
      if (headerType.value === 2) {
        const limitFailure = enforceBudget(budget, 0, 0);
        if (limitFailure) return fail(limitFailure);
        scan.entries.push({ name: parsed.name, encrypted: false, directory: (parsed.fileFlags & 0x0001) !== 0 });
      }
    }
    const advance = headerStart - offset + headerSize.value + dataSize;
    if (advance <= 0) return fail("structura RAR trunchiata sau necunoscuta");
    offset += advance;
  }
  if (offset < buffer.length) scan.truncated = "header RAR trunchiat";
  return scan;
}

function scanSevenZipHeaders(buffer: Buffer): HeaderScan {
  const scan: HeaderScan = { entries: [], encryptedHeaders: false, truncated: null };
  const nextOffset = Number(buffer.readBigUInt64LE(12));
  const nextSize = Number(buffer.readBigUInt64LE(20));
  const start = nextOffset + 32;
  const end = start + nextSize;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || nextSize === 0 || end > buffer.length) {
    scan.truncated = "structura 7z trunchiata sau necunoscuta";
    return scan;
  }
  if (buffer[start] === 0x17) {
    scan.encryptedHeaders = true;
    return scan;
  }
  if (buffer[start] !== 0x01) scan.truncated = "structura 7z trunchiata sau necunoscuta";
  return scan;
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
  const indicators = [...new Set([...documentIndicators(buffer), ...pdfStructuralIndicators(buffer, budget)])];
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

export async function inspectUntrustedContent(
  buffer: Buffer,
  filename: string,
  mime: string,
  mode: InspectionMode = "auto",
  limits: Partial<InspectionLimits> = {}
): Promise<InspectionReport> {
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
        if (typeof report.uninspectableFormat === "string") recordUninspectableFormat(report.uninspectableFormat);
        return {
          status: report.status,
          indicators: Array.isArray(report.indicators) ? report.indicators.map(indicator => String(indicator)) : [],
          reason: String(report.reason || ""),
          entriesInspected: Number(report.entriesInspected) || 0,
          expandedBytes: Number(report.expandedBytes) || 0,
          elapsedMs: Number(report.elapsedMs) || 0,
          uninspectableFormat: typeof report.uninspectableFormat === "string" ? report.uninspectableFormat : undefined
        };
      }
      recordNativeFallback("inspectUntrustedContent", new Error("raport nativ invalid"));
    } catch (error) {
      recordNativeFallback("inspectUntrustedContent", error);
    }
  }
  return inspectUntrustedContentFallback(buffer, filename, mime, mode, limits);
}

export default { inspectArchivePassively, inspectUntrustedContent };
