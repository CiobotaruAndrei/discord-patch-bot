"use strict";

import type { ModerationRecord, WarningRecord } from "./moderationRepository.js";

export function mention(userId: string, name?: string): string {
  return name ? `${name} (<@${userId}>)` : `<@${userId}>`;
}

export function formatModerationRecord(record: ModerationRecord, now: number = Date.now()): string {
  const applied = Math.floor(new Date(record.appliedAt).getTime() / 1000);
  const expiryDate = record.expiresAt ? new Date(record.expiresAt) : null;
  const expiry = expiryDate ? `<t:${Math.floor(expiryDate.getTime() / 1000)}:F> (<t:${Math.floor(expiryDate.getTime() / 1000)}:R>)` : "permanent";
  const remaining = expiryDate ? Math.max(0, expiryDate.getTime() - now) : null;
  const remainingLabel = remaining === null ? "permanent" : remaining >= 3_600_000 ? `${Math.ceil(remaining / 3_600_000)}h` : `${Math.ceil(remaining / 60_000)}m`;
  const reason = record.reason && record.reason.trim() ? record.reason.trim() : "-";
  return `${mention(record.userId, record.username)} | ID ${record.userId} | aplicat de <@${record.moderatorId}> la <t:${applied}:F> (<t:${applied}:R>) | expira ${expiry} | ramas ${remainingLabel} | motiv: ${reason}`;
}

export function summarizeWarnings(warnings: readonly WarningRecord[]): string[] {
  const totalsByUser = new Map<string, { userId: string; username?: string; count: number; lastWarnedAt: number }>();
  for (const warning of warnings) {
    const warnedAt = new Date(warning.warnedAt).getTime();
    const entry = totalsByUser.get(warning.userId);
    if (!entry) {
      totalsByUser.set(warning.userId, { userId: warning.userId, username: warning.username, count: 1, lastWarnedAt: warnedAt });
    } else {
      entry.count += 1;
      if (warnedAt > entry.lastWarnedAt) {
        entry.lastWarnedAt = warnedAt;
        entry.username = warning.username;
      }
    }
  }
  return [...totalsByUser.values()]
    .sort((left, right) => right.count - left.count || right.lastWarnedAt - left.lastWarnedAt)
    .map(entry =>
      `${mention(entry.userId, entry.username)} | ${entry.count === 1 ? "1 warn activ" : `${entry.count} warn-uri active`} | ultimul <t:${Math.floor(entry.lastWarnedAt / 1000)}:R>`
    );
}
