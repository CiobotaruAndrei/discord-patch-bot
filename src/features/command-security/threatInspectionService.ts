"use strict";

import type { DirectAttachment } from "../moderation/moderationInputPolicy.js";
import { inspectArchivePassively } from "./passiveArchiveInspection.js";

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

export type ReputationVerdict = "malware" | "phishing" | "fraud" | "data-theft" | "exploit" | "clean" | "unknown";

export interface ReputationScanInput {
  url?: string;
  mime: string;
  buffer: Buffer | null;
  kind: "executable" | "archive" | "document" | "script" | "other";
  complete: boolean;
  totalLength?: number | null;
}

export type ReputationScan = (input: ReputationScanInput) => Promise<ReputationVerdict>;

const LOCAL_INSPECTION_MAX_BYTES = 1_048_576;

function completenessHeader(headers: Record<string, unknown> | undefined, name: string): string | null {
  if (!headers) return null;
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== target) continue;
    if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : null;
    return typeof value === "string" ? value : typeof value === "number" ? String(value) : null;
  }
  return null;
}

export function describeResponseCompleteness(
  status: number | undefined,
  headers: Record<string, unknown> | undefined,
  receivedBytes: number,
  requestedMaxBytes: number
): { complete: boolean; totalLength: number | null } {
  let total: number | null = null;
  const contentRange = completenessHeader(headers, "content-range");
  if (contentRange) {
    const match = /\/\s*(\d+)\s*$/.exec(contentRange.trim());
    if (match) total = Number(match[1]);
  }
  if (total === null && status !== 206) {
    const contentLength = completenessHeader(headers, "content-length");
    if (contentLength && /^\d+$/.test(contentLength.trim())) total = Number(contentLength.trim());
  }
  if (total !== null) return { complete: receivedBytes >= total, totalLength: total };
  if (status === 206) return { complete: false, totalLength: null };
  if (receivedBytes >= requestedMaxBytes) return { complete: false, totalLength: null };
  return { complete: true, totalLength: null };
}

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
    if (buffer && kind === "archive") {
      const archive = inspectArchivePassively(buffer);
      const details = archive.indicators.length > 0 ? `; ${archive.indicators.join(" si ")}` : "";
      return {
        verdict: archive.indicators.some(indicator => /executabil|script/i.test(indicator)) ? "risky-file" : "uncertain",
        reason: `${archive.reason}${details}; confirmarea externa ramane obligatorie inainte de orice actiune`,
        source: "attachment",
        kind
      };
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

async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runnerCount = Math.max(1, Math.min(limit, items.length));
  const runners = Array.from({ length: runnerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

type ScanCandidate = { url?: string; mime: string; buffer: Buffer | null; kind: ResourceKind; complete: boolean; totalLength: number | null };
type ClassifiedResource = { base: ThreatInspectionResult; scan: ScanCandidate | null };
type ResourceRef = { type: "url"; url: string } | { type: "attachment"; attachment: DirectAttachment };

function attachmentPriority(attachment: DirectAttachment): number {
  const mime = normalizeMime(attachment.contentType);
  if (EXECUTABLE_MIME.has(mime)) return 0;
  if (ARCHIVE_MIME.has(mime)) return 1;
  if (DOCUMENT_MIME.has(mime)) return 2;
  return 3;
}

export function createThreatInspectionService(deps: ThreatInspectionDeps) {
  const maxResources = Math.max(1, deps.maxResources ?? 8);

  async function confirmWithReputation(base: ThreatInspectionResult, input: ScanCandidate): Promise<ThreatInspectionResult> {
    if (!deps.reputationScan) return base;
    try {
      const verdict = await deps.reputationScan(input);
      if (["malware", "phishing", "fraud", "data-theft", "exploit"].includes(verdict)) {
        if (!input.complete) {
          return base.verdict === "safe"
            ? { verdict: "uncertain", reason: "motorul extern a semnalat continut periculos, dar numai fragmentul descarcat a fost analizat; obiectul complet nu poate fi confirmat local", source: base.source }
            : base;
        }
        const label: Record<Exclude<ReputationVerdict, "clean" | "unknown">, string> = {
          malware: "malware",
          phishing: "phishing",
          fraud: "frauda",
          "data-theft": "furt de date",
          exploit: "exploit"
        };
        return { verdict: "confirmed", reason: `${label[verdict as keyof typeof label]} confirmat de motorul extern de reputatie`, source: base.source };
      }
    } catch {
      return base;
    }
    return base;
  }

  async function classifyUrl(url: string): Promise<ClassifiedResource> {
    if (!deps.httpReq) return { base: { verdict: "uncertain", reason: "serviciul de inspectie HTTP nu este disponibil", source: "link" }, scan: null };
    try {
      const response = await deps.httpReq("GET", url, {
        timeout: 8000,
        responseType: "arraybuffer",
        maxContentLength: LOCAL_INSPECTION_MAX_BYTES,
        maxBodyLength: LOCAL_INSPECTION_MAX_BYTES,
        headers: { Range: `bytes=0-${LOCAL_INSPECTION_MAX_BYTES - 1}` }
      }, 0);
      const mime = contentType(response.headers);
      const buffer = toBuffer(response.data);
      const { complete, totalLength } = describeResponseCompleteness(response.status, response.headers, buffer?.length ?? 0, LOCAL_INSPECTION_MAX_BYTES);
      const { kind, ...result } = classifyResource(mime, buffer);
      const base: ThreatInspectionResult = !complete && result.verdict === "safe"
        ? { verdict: "uncertain", reason: "resursa depaseste limita locala de inspectie; a fost verificat doar primul fragment", source: "link" }
        : { ...result, source: "link" };
      return { base, scan: { url, mime, buffer, kind, complete, totalLength } };
    } catch {
      return { base: { verdict: "uncertain", reason: "resursa externa nu a putut fi inspectata in siguranta", source: "link" }, scan: null };
    }
  }

  async function classifyAttachment(attachment: DirectAttachment): Promise<ClassifiedResource> {
    const declaredMime = normalizeMime(attachment.contentType);
    const { kind: declaredKind, ...declaredResult } = classifyResource(declaredMime, null);
    const declaredScan: ScanCandidate = { url: attachment.url, mime: declaredMime, buffer: null, kind: declaredKind, complete: false, totalLength: null };
    if (!attachment.url || !deps.httpReq) {
      const base: ThreatInspectionResult = declaredResult.verdict === "safe"
        ? { verdict: "uncertain", reason: "atasamentul nu a putut fi descarcat pentru verificarea continutului", source: "attachment" }
        : { ...declaredResult, source: "attachment" };
      return { base, scan: declaredScan };
    }
    const remote = await classifyUrl(attachment.url);
    if (remote.base.verdict !== "safe") {
      return { base: { ...remote.base, source: "attachment" }, scan: remote.scan ?? declaredScan };
    }
    return { base: { ...declaredResult, source: "attachment" }, scan: remote.scan ?? declaredScan };
  }

  async function confirmClassified(classified: ClassifiedResource): Promise<ThreatInspectionResult> {
    return classified.scan ? confirmWithReputation(classified.base, classified.scan) : classified.base;
  }

  async function inspectMessage(content: string, attachments: readonly DirectAttachment[]): Promise<ThreatInspectionResult> {
    const seenUrls = new Set<string>();
    const refs: ResourceRef[] = [];
    const prioritizedAttachments = attachments
      .map((attachment, index) => ({ attachment, index }))
      .sort((left, right) => attachmentPriority(left.attachment) - attachmentPriority(right.attachment) || left.index - right.index);
    for (const { attachment } of prioritizedAttachments) {
      if (attachment.url && seenUrls.has(attachment.url)) continue;
      if (attachment.url) seenUrls.add(attachment.url);
      refs.push({ type: "attachment", attachment });
    }
    for (const url of extractUrls(content)) {
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);
      refs.push({ type: "url", url });
    }

    const capped = refs.slice(0, maxResources);
    const omittedCount = refs.length - capped.length;
    const concurrency = Math.max(1, Math.min(capped.length, maxResources - 1));
    const inspected = await mapWithConcurrency(capped, concurrency, async ref =>
      confirmClassified(ref.type === "url" ? await classifyUrl(ref.url) : await classifyAttachment(ref.attachment))
    );

    const omitted: ThreatInspectionResult[] = omittedCount > 0
      ? [{ verdict: "uncertain", reason: `${omittedCount} resurse suplimentare nu au fost inspectate (plafon de ${maxResources} resurse pe mesaj)`, source: "content" }]
      : [];

    const results = [...policyThreats(content), ...inspected, ...omitted];
    const findings = results
      .filter(result => result.verdict !== "safe")
      .sort((left, right) => VERDICT_SEVERITY[right.verdict] - VERDICT_SEVERITY[left.verdict]);
    if (!findings.length) {
      return capped.length
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
