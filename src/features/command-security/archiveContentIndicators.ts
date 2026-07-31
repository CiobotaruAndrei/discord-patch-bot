"use strict";

import { pdfStructuralIndicators, isPdfDocument, hasObfuscatedPdfActionName } from "./pdfInspection.js";
import { ooxmlRelationshipIndicators } from "./ooxmlInspection.js";
import { inspectCompoundFileBinary, isCompoundFileBinary } from "./compoundFileInspection.js";
import { enforceBudget, inspected, uncertain } from "./archiveInspectionBudget.js";
import type { InspectionBudget, PassiveArchiveFinding } from "./archiveInspectionBudget.js";

export function nameIndicators(name: string): string[] {
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

const TEXT_LINK_SCAN_BYTES = 256 * 1024;

const STANDARDS_HOSTS = [
  "schemas.openxmlformats.org",
  "schemas.microsoft.com",
  "purl.org",
  "www.w3.org",
  "w3.org",
  "ns.adobe.com",
  "iptc.org",
  "xmlns.com",
  "docs.oasis-open.org",
  "relaxng.org"
];

export function isStandardsHost(host: string): boolean {
  return STANDARDS_HOSTS.some(known => host === known || host.endsWith(`.${known}`));
}

export function textLinkIndicators(buffer: Buffer): string[] {
  const window = buffer.subarray(0, Math.min(buffer.length, TEXT_LINK_SCAN_BYTES));
  if (!window.includes("http")) return [];
  const text = window.toString("utf8");
  const hosts: string[] = [];
  const pattern = new RegExp("(?:https?|ftp)://([^\\s/?#)\"'>,\\\\]+)", "gi");
  for (const match of text.matchAll(pattern)) {
    const raw = match[1].split("@").pop() ?? "";
    const host = raw.split(":")[0].replace(/\.+$/, "").toLowerCase();
    if (host.length === 0 || !host.includes(".") || host.length > 253) continue;
    if (isStandardsHost(host)) continue;
    if (!hosts.includes(host)) hosts.push(host);
    if (hosts.length >= 32) break;
  }
  return hosts.map(host => `link in textul documentului catre ${host}`);
}

export function contentIndicators(name: string, buffer: Buffer, budget: InspectionBudget): string[] {
  const normalized = name.replaceAll("\\", "/").toLowerCase();
  const indicators: string[] = nameIndicators(name);
  indicators.push(...textLinkIndicators(buffer));
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
