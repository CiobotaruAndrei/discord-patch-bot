"use strict";

import { AD_STRIKE_LIMIT } from "../command-security/adRequestTypes.js";

import type { AdAttemptRecord, AdRequestRecord } from "../command-security/adRequestTypes.js";

const STATUS_ORDER: Record<string, number> = {
  pending: 0, approved: 1, rejected: 2, used: 3, expired: 4, cancelled: 5
};

function moment(value: Date | null): string {
  return value ? new Date(value).toISOString().replace("T", " ").slice(0, 19) : "-";
}

function summary(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed || "(fara text)";
}

export function displayAdRequest(record: AdRequestRecord): string {
  const parts = [
    `\`${record._id}\` — <@${record.requesterId}> — **${record.status}**`,
    `Reclama: ${summary(record.adText)}`
  ];
  if (record.invite) parts.push(`Invitatie: ${record.invite}`);
  if (record.link) parts.push(`Link: ${record.link}`);
  if (record.attachmentUrl) parts.push("Atasament: da");
  if (record.target) parts.push(`Tinta promovata: ${record.target}`);
  parts.push(`Ceruta: ${moment(record.requestedAt)}; decisa: ${moment(record.respondedAt)}${record.ownerId ? ` de <@${record.ownerId}>` : ""}`);
  parts.push(`Expira: ${moment(record.expiresAt)}; folosita: ${moment(record.usedAt)}`);
  return parts.join("\n");
}

export function orderAdRequests(records: readonly AdRequestRecord[]): AdRequestRecord[] {
  return [...records].sort((left, right) => {
    const byStatus = (STATUS_ORDER[left.status] ?? 9) - (STATUS_ORDER[right.status] ?? 9);
    if (byStatus !== 0) return byStatus;
    return new Date(right.requestedAt).getTime() - new Date(left.requestedAt).getTime();
  });
}

export function adRequestLines(records: readonly AdRequestRecord[]): string[] {
  if (records.length === 0) return [];
  const active = records.filter(record => record.status === "pending" || record.status === "approved").length;
  return [
    `Cereri de reclama: ${records.length} (active: ${active})`,
    ...orderAdRequests(records).map(displayAdRequest)
  ];
}

export function adAttemptLines(userId: string, record: AdAttemptRecord | null): string[] {
  if (!record) {
    return [`<@${userId}> nu are nicio tentativa de reclama neautorizata. Contor: 0/${AD_STRIKE_LIMIT}.`];
  }
  const lines = [
    `<@${userId}> — contor activ: **${record.strikes}/${AD_STRIKE_LIMIT}**`,
    `Reclame sterse in total: ${record.totalDeleted}; warn-uri automate: ${record.totalWarns}`,
    `Ultima tentativa: ${moment(record.lastAttemptAt)}${record.lastChannelId ? ` in <#${record.lastChannelId}>` : ""}`
  ];
  if (record.history.length > 0) {
    lines.push("Istoric (cele mai recente ultimele):");
    for (const entry of record.history.slice(-15)) {
      lines.push(`  - ${moment(entry.at)}${entry.channelId ? ` <#${entry.channelId}>` : ""}: ${entry.summary}${entry.warned ? " (warn emis)" : ""}`);
    }
  }
  return lines;
}

export function adRequestButtons(requestId: string): Array<Record<string, unknown>> {
  return [{
    type: 1,
    components: [
      { type: 2, style: 3, label: "Aproba", custom_id: `ad-request:approve:${requestId}` },
      { type: 2, style: 4, label: "Respinge", custom_id: `ad-request:reject:${requestId}` }
    ]
  }];
}
