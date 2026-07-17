"use strict";

import type { DirectAttachment } from "../moderation/moderationInputPolicy.js";

export type ThreatVerdict = "safe" | "uncertain" | "policy-violation" | "risky-file" | "confirmed";

export interface ThreatInspectionResult {
  verdict: ThreatVerdict;
  reason: string;
  source: "content" | "link" | "attachment";
  detectedVerdicts?: ThreatVerdict[];
}

const VERDICT_SEVERITY: Record<ThreatVerdict, number> = {
  safe: 0,
  uncertain: 1,
  "policy-violation": 2,
  "risky-file": 3,
  confirmed: 4
};

type HttpResponse = {
  data?: unknown;
  headers?: Record<string, unknown>;
  status?: number;
};

type HttpRequest = (
  method: string,
  url: string,
  options?: Record<string, unknown>,
  retries?: number
) => Promise<HttpResponse>;

export type ReputationVerdict = "malware" | "clean" | "unknown";

export interface ReputationScanInput {
  url?: string;
  mime: string;
  buffer: Buffer | null;
  kind: "executable" | "archive" | "document" | "script" | "other";
}

export type ReputationScan = (input: ReputationScanInput) => Promise<ReputationVerdict>;

export interface ThreatInspectionDeps {
  httpReq?: HttpRequest;
  maxResources?: number;
  reputationScan?: ReputationScan;
}

export function reputationEngineConfigured(deps: ThreatInspectionDeps): boolean {
  return typeof deps.reputationScan === "function";
}

const EXECUTABLE_MIME = new Set([
  "application/x-msdownload",
  "application/x-msdos-program",
  "application/x-executable",
  "application/x-elf",
  "application/vnd.microsoft.portable-executable",
  "application/x-sh",
  "application/x-shellscript",
  "text/x-shellscript",
  "application/x-bat",
  "application/x-powershell"
]);
const ARCHIVE_MIME = new Set([
  "application/zip",
  "application/x-7z-compressed",
  "application/x-rar-compressed",
  "application/vnd.rar",
  "application/x-tar",
  "application/gzip"
]);
const DOCUMENT_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);

function normalizeMime(value: unknown): string {
  return typeof value === "string" ? value.split(";")[0].trim().toLowerCase() : "";
}

function toBuffer(value: unknown): Buffer | null {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === "string") return Buffer.from(value);
  return null;
}

function magicKind(buffer: Buffer): "executable" | "archive" | "document" | "script" | "other" {
  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) return "executable";
  if (buffer.length >= 4 && buffer[0] === 0x7f && buffer.subarray(1, 4).toString("ascii") === "ELF") return "executable";
  const firstFour = buffer.length >= 4 ? buffer.readUInt32BE(0) : 0;
  if ([0xfeedface, 0xfeedfacf, 0xcafebabe, 0xcefaedfe, 0xcffaedfe].includes(firstFour)) return "executable";
  if (buffer.length >= 2 && buffer[0] === 0x23 && buffer[1] === 0x21) return "script";
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("binary") === "PK\u0003\u0004") return "archive";
  if (
    buffer.length >= 6
    && buffer[0] === 0x37
    && buffer[1] === 0x7a
    && buffer[2] === 0xbc
    && buffer[3] === 0xaf
    && buffer[4] === 0x27
    && buffer[5] === 0x1c
  ) return "archive";
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii") === "%PDF") return "document";
  if (buffer.length >= 8 && buffer.readUInt32BE(0) === 0xd0cf11e0 && buffer.readUInt32BE(4) === 0xa1b11ae1) return "document";
  return "other";
}

type ResourceKind = "executable" | "archive" | "document" | "script" | "other";

function isEncryptedZip(buffer: Buffer): boolean {
  if (buffer.length < 8 || buffer.subarray(0, 4).toString("binary") !== "PK") return false;
  return (buffer.readUInt16LE(6) & 0x0001) === 0x0001;
}

function passiveDocumentIndicators(buffer: Buffer): string[] {
  const window = buffer.subarray(0, Math.min(buffer.length, 1_048_576));
  const ascii = window.toString("latin1");
  const indicators: string[] = [];
  if (ascii.includes("vbaProject.bin") || ascii.includes("word/vbaProject") || ascii.includes("macros/vba")) {
    indicators.push("indicator de macro VBA");
  }
  if (/\/JavaScript\b/.test(ascii) || /\/JS\b/.test(ascii) || ascii.includes("/OpenAction") || ascii.includes("/Launch")) {
    indicators.push("indicator de script/actiune automata in document");
  }
  return indicators;
}

function classifyResource(mime: string, buffer: Buffer | null): ThreatInspectionResult & { kind: ResourceKind } {
  const magic = buffer ? magicKind(buffer) : "other";
  if (magic === "executable" || magic === "script") {
    return { verdict: "risky-file", reason: "tip de fisier executabil sau script confirmat prin continut (tipul e confirmat, nu si intentia malware)", source: "attachment", kind: magic };
  }
  if (EXECUTABLE_MIME.has(mime)) {
    return { verdict: "uncertain", reason: "MIME executabil declarat fara confirmare suficienta prin continut", source: "attachment", kind: "executable" };
  }
  if (ARCHIVE_MIME.has(mime) || DOCUMENT_MIME.has(mime) || magic === "document" || magic === "archive") {
    const kind: ResourceKind = magic === "other" ? (ARCHIVE_MIME.has(mime) ? "archive" : "document") : magic;
    if (buffer && kind === "archive" && isEncryptedZip(buffer)) {
      return { verdict: "uncertain", reason: "arhiva criptata - continutul nu poate fi inspectat pasiv, ramane unknown (nu se declara periculoasa automat)", source: "attachment", kind };
    }
    const indicators = buffer ? passiveDocumentIndicators(buffer) : [];
    if (indicators.length > 0) {
      return { verdict: "uncertain", reason: `document/arhiva cu ${indicators.join(" si ")} - necesita confirmare de motor antivirus extern inainte de orice actiune`, source: "attachment", kind };
    }
    return { verdict: "uncertain", reason: "document sau arhiva care necesita analiza antivirus externa", source: "attachment", kind };
  }
  return { verdict: "safe", reason: "nu au fost identificate semnaturi periculoase", source: "attachment", kind: magic };
}

function extractUrls(content: string): string[] {
  const raw = content.match(/\bhttps?:\/\/[^\s<>()]+|\bwww\.[^\s<>()]+/gi) ?? [];
  return [...new Set(raw.map(value => value.startsWith("www.") ? `https://${value}` : value))];
}

function policyThreats(content: string): ThreatInspectionResult[] {
  const findings: ThreatInspectionResult[] = [];
  if (/@everyone|@here/i.test(content)) {
    findings.push({ verdict: "policy-violation", reason: "mentionare in masa interzisa de politica de protectie", source: "content" });
  }
  if (/(?:discord(?:app)?\.com\/invite\/|discord\.gg\/)/i.test(content)) {
    findings.push({ verdict: "policy-violation", reason: "invitatie Discord externa interzisa de politica de protectie", source: "content" });
  }
  return findings;
}

function contentType(headers: Record<string, unknown> | undefined): string {
  if (!headers) return "";
  return normalizeMime(headers["content-type"] ?? headers["Content-Type"]);
}

export function createThreatInspectionService(deps: ThreatInspectionDeps) {
  const maxResources = Math.max(1, deps.maxResources ?? 8);

  async function confirmWithReputation(
    base: ThreatInspectionResult,
    input: { url?: string; mime: string; buffer: Buffer | null; kind: ResourceKind }
  ): Promise<ThreatInspectionResult> {
    if (!deps.reputationScan) return base;
    try {
      const verdict = await deps.reputationScan(input);
      if (verdict === "malware") {
        return { verdict: "confirmed", reason: "malware confirmat de motorul extern de reputatie/antivirus", source: base.source };
      }
    } catch {
      return base;
    }
    return base;
  }

  async function inspectUrl(url: string): Promise<ThreatInspectionResult> {
    if (!deps.httpReq) return { verdict: "uncertain", reason: "serviciul de inspectie HTTP nu este disponibil", source: "link" };
    try {
      const response = await deps.httpReq("GET", url, {
        timeout: 8000,
        responseType: "arraybuffer",
        maxContentLength: 1_048_576,
        maxBodyLength: 1_048_576,
        headers: { Range: "bytes=0-1048575" }
      }, 0);
      const mime = contentType(response.headers);
      const buffer = toBuffer(response.data);
      const { kind, ...result } = classifyResource(mime, buffer);
      return confirmWithReputation({ ...result, source: "link" }, { url, mime, buffer, kind });
    } catch {
      return { verdict: "uncertain", reason: "resursa externa nu a putut fi inspectata in siguranta", source: "link" };
    }
  }

  async function inspectAttachment(attachment: DirectAttachment): Promise<ThreatInspectionResult> {
    const declaredMime = normalizeMime(attachment.contentType);
    if (!attachment.url || !deps.httpReq) {
      const { kind, ...declared } = classifyResource(declaredMime, null);
      const base: ThreatInspectionResult = declared.verdict === "safe"
        ? { verdict: "uncertain", reason: "atasamentul nu a putut fi descarcat pentru verificarea continutului", source: "attachment" }
        : { ...declared, source: "attachment" };
      return confirmWithReputation(base, { url: attachment.url, mime: declaredMime, buffer: null, kind });
    }
    const remote = await inspectUrl(attachment.url);
    if (remote.verdict !== "safe") return { ...remote, source: "attachment" };
    const { kind, ...declared } = classifyResource(declaredMime, null);
    return confirmWithReputation({ ...declared, source: "attachment" }, { url: attachment.url, mime: declaredMime, buffer: null, kind });
  }

  async function inspectMessage(content: string, attachments: readonly DirectAttachment[]): Promise<ThreatInspectionResult> {
    const resources: Array<Promise<ThreatInspectionResult>> = [
      ...extractUrls(content).slice(0, maxResources).map(inspectUrl),
      ...attachments.slice(0, maxResources).map(inspectAttachment)
    ];
    const results = [...policyThreats(content), ...await Promise.all(resources)];
    const findings = results
      .filter(result => result.verdict !== "safe")
      .sort((left, right) => VERDICT_SEVERITY[right.verdict] - VERDICT_SEVERITY[left.verdict]);
    if (!findings.length) {
      return resources.length
        ? { verdict: "safe", reason: "toate resursele inspectate au trecut verificarile", source: "content" }
        : { verdict: "safe", reason: "mesaj fara resurse inspectabile", source: "content" };
    }
    const top = findings[0];
    return {
      verdict: top.verdict,
      reason: [...new Set(findings.map(finding => finding.reason))].join("; "),
      source: top.source,
      detectedVerdicts: [...new Set(findings.map(finding => finding.verdict))]
    };
  }

  return Object.freeze({ inspectMessage });
}

export default { createThreatInspectionService };
