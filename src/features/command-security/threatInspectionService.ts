"use strict";

import type { DirectAttachment } from "../moderation/moderationInputPolicy.js";

type ThreatVerdict = "safe" | "uncertain" | "confirmed";

export interface ThreatInspectionResult {
  verdict: ThreatVerdict;
  reason: string;
  source: "content" | "link" | "attachment";
}

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

export interface ThreatInspectionDeps {
  httpReq?: HttpRequest;
  maxResources?: number;
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
  return "other";
}

function classifyResource(mime: string, buffer: Buffer | null): ThreatInspectionResult {
  const magic = buffer ? magicKind(buffer) : "other";
  if (magic === "executable" || magic === "script") {
    return { verdict: "confirmed", reason: "resursa executabila sau script confirmat prin continut", source: "attachment" };
  }
  if (EXECUTABLE_MIME.has(mime)) {
    return { verdict: "uncertain", reason: "MIME executabil declarat fara confirmare suficienta prin continut", source: "attachment" };
  }
  if (ARCHIVE_MIME.has(mime) || DOCUMENT_MIME.has(mime) || magic === "document" || magic === "archive") {
    return { verdict: "uncertain", reason: "document sau arhiva care necesita analiza antivirus externa", source: "attachment" };
  }
  return { verdict: "safe", reason: "nu au fost identificate semnaturi periculoase", source: "attachment" };
}

function extractUrls(content: string): string[] {
  const raw = content.match(/\bhttps?:\/\/[^\s<>()]+|\bwww\.[^\s<>()]+/gi) ?? [];
  return [...new Set(raw.map(value => value.startsWith("www.") ? `https://${value}` : value))];
}

function policyThreat(content: string): ThreatInspectionResult | null {
  if (/@everyone|@here/i.test(content)) {
    return { verdict: "confirmed", reason: "mentionare in masa interzisa de politica de protectie", source: "content" };
  }
  if (/(?:discord(?:app)?\.com\/invite\/|discord\.gg\/)/i.test(content)) {
    return { verdict: "confirmed", reason: "invitatie Discord externa interzisa de politica de protectie", source: "content" };
  }
  return null;
}

function contentType(headers: Record<string, unknown> | undefined): string {
  if (!headers) return "";
  return normalizeMime(headers["content-type"] ?? headers["Content-Type"]);
}

export function createThreatInspectionService(deps: ThreatInspectionDeps) {
  const maxResources = Math.max(1, deps.maxResources ?? 8);

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
      const result = classifyResource(contentType(response.headers), toBuffer(response.data));
      return { ...result, source: "link" };
    } catch {
      return { verdict: "uncertain", reason: "resursa externa nu a putut fi inspectata in siguranta", source: "link" };
    }
  }

  async function inspectAttachment(attachment: DirectAttachment): Promise<ThreatInspectionResult> {
    const declaredMime = normalizeMime(attachment.contentType);
    if (!attachment.url || !deps.httpReq) {
      const declared = classifyResource(declaredMime, null);
      return declared.verdict === "safe"
        ? { verdict: "uncertain", reason: "atasamentul nu a putut fi descarcat pentru verificarea continutului", source: "attachment" }
        : declared;
    }
    const remote = await inspectUrl(attachment.url);
    if (remote.verdict !== "safe") return { ...remote, source: "attachment" };
    return { ...classifyResource(declaredMime, null), source: "attachment" };
  }

  async function inspectMessage(content: string, attachments: readonly DirectAttachment[]): Promise<ThreatInspectionResult> {
    const policy = policyThreat(content);
    if (policy) return policy;
    const resources: Array<Promise<ThreatInspectionResult>> = [
      ...extractUrls(content).slice(0, maxResources).map(inspectUrl),
      ...attachments.slice(0, maxResources).map(inspectAttachment)
    ];
    if (!resources.length) return { verdict: "safe", reason: "mesaj fara resurse inspectabile", source: "content" };
    const results = await Promise.all(resources);
    return results.find(result => result.verdict === "confirmed")
      ?? results.find(result => result.verdict === "uncertain")
      ?? { verdict: "safe", reason: "toate resursele inspectate au trecut verificarile", source: "content" };
  }

  return Object.freeze({ inspectMessage });
}

export default { createThreatInspectionService };
