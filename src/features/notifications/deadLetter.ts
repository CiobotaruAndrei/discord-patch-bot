"use strict";

export const NOTIFICATION_DEAD_LETTER_LIMIT = 50;

import type { NotificationKind } from "./notificationKinds.js";

export type DeadLetterKind = NotificationKind;

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

export function deadLetterTitleFromPayload(payload: unknown): string {
  const p = payload && typeof payload === "object" ? payload as { embeds?: Array<{ title?: unknown }>; content?: unknown } : {};
  const embedTitle = Array.isArray(p.embeds) && p.embeds[0] ? p.embeds[0].title : undefined;
  const raw = embedTitle ?? p.content ?? "";
  return String(raw ?? "").slice(0, 200);
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

