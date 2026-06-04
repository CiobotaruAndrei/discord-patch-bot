"use strict";

export const NOTIFICATION_DEAD_LETTER_LIMIT = 50;

export type DeadLetterKind = "update" | "discount";

export interface DeadLetterEntry {
  kind: DeadLetterKind;
  itemId: string;
  title: string;
  channelId: string;
  dedupeKey: string;
  reason: string;
  attempts: number;
  failedAt: Date;
}

export interface DeadLetterInput {
  kind: DeadLetterKind;
  itemId: unknown;
  title?: unknown;
  channelId?: unknown;
  dedupeKey?: unknown;
  reason: string;
  attempts: number;
}

export function buildDeadLetterEntry(input: DeadLetterInput): DeadLetterEntry {
  return {
    kind: input.kind,
    itemId: String(input.itemId ?? ""),
    title: String(input.title ?? "").slice(0, 200),
    channelId: String(input.channelId ?? ""),
    dedupeKey: String(input.dedupeKey ?? ""),
    reason: input.reason,
    attempts: input.attempts,
    failedAt: new Date()
  };
}

export function deadLetterPush(entries: DeadLetterEntry[]): Record<string, unknown> | null {
  if (!entries.length) return null;
  return { notificationDeadLetter: { $each: entries, $slice: -NOTIFICATION_DEAD_LETTER_LIMIT } };
}
