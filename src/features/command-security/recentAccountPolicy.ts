"use strict";

const RECENT_ACCOUNT_MONTHS = 3;

export function recentAccountCutoff(now: Date): Date {
  const cutoff = new Date(now);
  const day = cutoff.getUTCDate();
  cutoff.setUTCDate(1);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - RECENT_ACCOUNT_MONTHS);
  const lastDay = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0)).getUTCDate();
  cutoff.setUTCDate(Math.min(day, lastDay));
  return cutoff;
}

export function isRecentAccount(createdTimestamp: number | undefined, now = new Date()): boolean {
  if (typeof createdTimestamp !== "number" || !Number.isFinite(createdTimestamp)) return true;
  return createdTimestamp >= recentAccountCutoff(now).getTime();
}

export function accountAgeLabel(createdTimestamp: number | undefined, now = Date.now()): string {
  if (typeof createdTimestamp !== "number" || !Number.isFinite(createdTimestamp)) return "varsta necunoscuta";
  const days = Math.max(0, (now - createdTimestamp) / 86_400_000);
  return `${days.toFixed(1)} zile`;
}

export default { recentAccountCutoff, isRecentAccount, accountAgeLabel };
