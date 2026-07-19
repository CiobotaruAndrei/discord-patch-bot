"use strict";

import { gunzipSync, inflateRawSync } from "node:zlib";

export interface PassiveArchiveFinding {
  status: "inspected" | "uncertain";
  indicators: string[];
  reason: string;
}

interface InspectionBudget {
  entries: number;
  expandedBytes: number;
  startedAt: number;
}

const MAX_DEPTH = 3;
const MAX_ENTRIES = 64;
const MAX_EXPANDED_BYTES = 8 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 100;
const MAX_INSPECTION_MS = 100;

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
  if (budget.entries > MAX_ENTRIES) return `arhiva depaseste limita de ${MAX_ENTRIES} intrari`;
  if (budget.expandedBytes > MAX_EXPANDED_BYTES) return `arhiva depaseste limita de ${MAX_EXPANDED_BYTES} bytes decomprimati`;
  if (compressedBytes > 0 && expandedBytes / compressedBytes > MAX_COMPRESSION_RATIO) return `arhiva depaseste raportul maxim de compresie ${MAX_COMPRESSION_RATIO}:1`;
  if (Date.now() - budget.startedAt > MAX_INSPECTION_MS) return `inspectia arhivei a depasit ${MAX_INSPECTION_MS} ms`;
  return null;
}

function contentIndicators(name: string, buffer: Buffer): string[] {
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
  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) indicators.push("executabil PE intern");
  if (buffer.length >= 4 && buffer[0] === 0x7f && buffer.subarray(1, 4).toString("ascii") === "ELF") indicators.push("executabil ELF intern");
  const text = buffer.subarray(0, Math.min(buffer.length, 1_048_576)).toString("latin1");
  if (/\/JavaScript\b/.test(text) || /\/JS\b/.test(text) || text.includes("/OpenAction") || text.includes("/Launch") || /\/AA\b/.test(text) || text.includes("/EmbeddedFile") || text.includes("/RichMedia") || hasObfuscatedPdfActionName(text)) {
    indicators.push("actiune automata sau script PDF intern");
  }
  if (text.includes("DDEAUTO") || /\bDDE\s/.test(text)) {
    indicators.push("camp DDE intern (executie externa)");
  }
  if (/(?:TargetMode\s*=\s*["']External["']|https?:\/\/)/i.test(text) && normalized.endsWith(".rels")) {
    indicators.push("referinta externa in document Office");
  }
  return indicators;
}

function zipEntryData(buffer: Buffer, offset: number, compressedSize: number, uncompressedSize: number, method: number): Buffer {
  const compressed = buffer.subarray(offset, offset + compressedSize);
  if (method === 0) return Buffer.from(compressed);
  if (method === 8) return inflateRawSync(compressed, { maxOutputLength: Math.min(uncompressedSize || MAX_EXPANDED_BYTES, MAX_EXPANDED_BYTES) });
  throw new Error(`metoda ZIP ${method} nu este suportata pasiv`);
}

function inspectZip(buffer: Buffer, depth: number, budget: InspectionBudget): PassiveArchiveFinding {
  if (depth > MAX_DEPTH) return uncertain(`arhiva depaseste adancimea maxima ${MAX_DEPTH}`);
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
        entry = zipEntryData(buffer, dataOffset, compressedSize, uncompressedSize, method);
      } catch (error) {
        return uncertain(error instanceof Error ? error.message : "intrarea ZIP nu a putut fi decomprimata", indicators);
      }
      if (uncompressedSize !== 0 && entry.length !== uncompressedSize) return uncertain("dimensiunea decomprimata ZIP nu corespunde headerului", indicators);
      indicators.push(...contentIndicators(name, entry));
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
  if (depth > MAX_DEPTH) return uncertain(`arhiva depaseste adancimea maxima ${MAX_DEPTH}`);
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
    indicators.push(...contentIndicators(name, entry));
    const nested = inspectNested(name, entry, depth + 1, budget);
    indicators.push(...nested.indicators);
    if (nested.status === "uncertain") return uncertain(nested.reason, indicators);
    entries++;
    offset = dataOffset + Math.ceil(size / 512) * 512;
  }
  return entries > 0 ? inspected(indicators) : uncertain("arhiva TAR nu contine intrari inspectabile", indicators);
}

function inspectGzip(buffer: Buffer, depth: number, budget: InspectionBudget): PassiveArchiveFinding {
  if (depth > MAX_DEPTH) return uncertain(`arhiva depaseste adancimea maxima ${MAX_DEPTH}`);
  let expanded: Buffer;
  try {
    expanded = gunzipSync(buffer, { maxOutputLength: MAX_EXPANDED_BYTES });
  } catch {
    return uncertain("arhiva GZIP este trunchiata, invalida sau depaseste limita decomprimata");
  }
  const limitFailure = enforceBudget(budget, buffer.length, expanded.length);
  if (limitFailure) return uncertain(limitFailure);
  const tar = inspectTar(expanded, depth + 1, budget);
  if (tar.status === "inspected") return tar;
  const indicators = contentIndicators("payload", expanded);
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
  const budget: InspectionBudget = { entries: 0, expandedBytes: 0, startedAt: Date.now() };
  if (buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50) return inspectZip(buffer, 0, budget);
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) return inspectGzip(buffer, 0, budget);
  if (buffer.length >= 262 && buffer.subarray(257, 262).toString("ascii") === "ustar") return inspectTar(buffer, 0, budget);
  return uncertain("formatul arhivei nu are un decodor pasiv local; verdictul ramane neconfirmat");
}

export default { inspectArchivePassively };
