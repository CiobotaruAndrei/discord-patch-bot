"use strict";

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


import { inflateSync } from "node:zlib";
import { enforceBudget, inspected, uncertain } from "./archiveInspectionBudget.js";
import type { InspectionBudget, PassiveArchiveFinding } from "./archiveInspectionBudget.js";

const PDF_MAX_STREAMS = 64;
const PDF_DICT_LOOKBEHIND = 4096;

export function isPdfDocument(buffer: Buffer): boolean {
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

export function pdfStructuralIndicators(buffer: Buffer, budget: InspectionBudget): string[] {
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
