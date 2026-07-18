"use strict";

import { createHash } from "node:crypto";

export type ThreatResource = {
  kind: "attachment" | "url";
  url: string;
  name?: string;
  risk?: number;
};

export type ThreatVerdict = {
  confirmed: boolean;
  hash: string;
  scanId?: string;
  complete: boolean;
  reason?: string;
};

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function selectThreatResources(attachments: ThreatResource[], urls: ThreatResource[], max = 8): ThreatResource[] {
  const ordered = [...attachments.map(item => ({ ...item, kind: "attachment" as const })), ...urls.map(item => ({ ...item, kind: "url" as const }))]
    .sort((left, right) => (right.risk ?? (left.kind === "attachment" ? 2 : 1)) - (left.risk ?? (right.kind === "attachment" ? 2 : 1)));
  const seen = new Set<string>();
  return ordered.filter(item => {
    const key = item.url.trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, Math.max(1, max));
}

export function bindThreatVerdict(bytes: Uint8Array, verdict: ThreatVerdict | null | undefined): ThreatVerdict {
  const hash = sha256Bytes(bytes);
  if (!verdict || !verdict.complete || verdict.hash.toLowerCase() !== hash.toLowerCase()) {
    return { confirmed: false, hash, complete: false, scanId: verdict?.scanId, reason: "verdict-ul nu corespunde exact bytes-ilor descarcati" };
  }
  return { ...verdict, hash, confirmed: verdict.confirmed === true };
}

export function classifyJoinRisk(input: { accountAgeDays?: number | null; isBot?: boolean; hasPriorMembership?: boolean }): "normal" | "suspicious" {
  if (input.isBot) return "normal";
  if (input.hasPriorMembership) return "normal";
  return input.accountAgeDays !== null && input.accountAgeDays !== undefined && input.accountAgeDays <= 7 ? "suspicious" : "normal";
}

export function classifyConfirmedActivity(input: { suspiciousContent: boolean; confirmedThreat: boolean }): "normal" | "suspicious" | "dangerous" {
  if (input.confirmedThreat) return "dangerous";
  return input.suspiciousContent ? "suspicious" : "normal";
}

export default { sha256Bytes, selectThreatResources, bindThreatVerdict, classifyJoinRisk, classifyConfirmedActivity };
