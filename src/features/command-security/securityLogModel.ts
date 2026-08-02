"use strict";

export type SecurityLogSource = "audit" | "raid" | "ad" | "approval";

export interface SecurityLogEntry {
  source: SecurityLogSource;
  at: Date;
  action: string;
  actorId: string | null;
  summary: string;
}

export const SECURITY_LOG_PAGE_SIZE = 10;

const ID_PATTERN = /\b\d{17,20}\b/g;
const TOKEN_PATTERN = /\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}\b/g;
const URL_PATTERN = /https?:\/\/\S+/g;

export function redact(text: string): string {
  return text
    .replace(TOKEN_PATTERN, "[token redactat]")
    .replace(URL_PATTERN, "[link redactat]")
    .replace(ID_PATTERN, match => `${match.slice(0, 4)}…${match.slice(-2)}`);
}

export function mergeSecurityLog(entries: readonly SecurityLogEntry[]): SecurityLogEntry[] {
  return [...entries].sort((left, right) => right.at.getTime() - left.at.getTime());
}

export function pageOf(entries: readonly SecurityLogEntry[], page: number): SecurityLogEntry[] {
  const start = Math.max(0, page - 1) * SECURITY_LOG_PAGE_SIZE;
  return entries.slice(start, start + SECURITY_LOG_PAGE_SIZE);
}

export function pageCount(entries: readonly SecurityLogEntry[]): number {
  return Math.max(1, Math.ceil(entries.length / SECURITY_LOG_PAGE_SIZE));
}

const SOURCE_LABELS: Readonly<Record<SecurityLogSource, string>> = {
  audit: "audit",
  raid: "anti-raid",
  ad: "reclame",
  approval: "aprobari"
};

export function renderSecurityLog(entries: readonly SecurityLogEntry[], page: number): string {
  if (entries.length === 0) return "Nu exista incidente de securitate inregistrate pentru acest server.";

  const total = pageCount(entries);
  const current = Math.min(Math.max(1, page), total);
  const rows = pageOf(entries, current).map(entry => {
    const actor = entry.actorId ? `<@${entry.actorId}>` : "actor nedetectat";
    return `\`${entry.at.toISOString()}\` **${SOURCE_LABELS[entry.source]}** ${entry.action} — ${actor}: ${redact(entry.summary)}`;
  });

  return [`Incidente de securitate (pagina ${current}/${total}, cele mai recente primele):`, ...rows].join("\n");
}
