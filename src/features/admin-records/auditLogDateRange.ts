"use strict";

const DAY_MS = 24 * 60 * 60 * 1000;

export type AuditDateRange = { start: Date; end: Date; label: string };

function parseMonth(raw: string): AuditDateRange | null {
  const match = /^(\d{4})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)), label: raw };
}

export function parseAuditDateRange(period: string | null, start: string | null): AuditDateRange | null {
  const normalizedPeriod = String(period || "").trim().toLowerCase();
  const raw = String(start || "").trim();
  if (normalizedPeriod === "luna") return parseMonth(raw);

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const from = new Date(Date.UTC(year, month - 1, day));
  if (from.getUTCFullYear() !== year || from.getUTCMonth() !== month - 1 || from.getUTCDate() !== day) return null;

  const days = normalizedPeriod === "zi" ? 1 : normalizedPeriod === "saptamana" ? 7 : 0;
  if (days === 0) return null;
  return { start: from, end: new Date(from.getTime() + days * DAY_MS), label: normalizedPeriod === "zi" ? raw : `${raw} + 7 zile` };
}
