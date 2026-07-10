"use strict";

import { NOTIFICATION_DEAD_LETTER_LIMIT, type DeadLetterEntry, type DeadLetterKind } from "./deadLetter";

export interface GuildDeadLetterRecord {
  _id?: unknown;
  guildId: string;
  kind?: DeadLetterKind;
  itemId?: string;
  title?: string;
  channelId?: string;
  dedupeKey?: string;
  reason?: string;
  attempts?: number;
  failedAt?: Date | string;
}

export interface DeadLetterQueryLike {
  sort(spec: Record<string, 1 | -1>): DeadLetterQueryLike;
  skip(count: number): DeadLetterQueryLike;
  limit(count: number): DeadLetterQueryLike;
  lean(): Promise<GuildDeadLetterRecord[]>;
}

export interface DeadLetterModelLike {
  insertMany(docs: GuildDeadLetterRecord[], options?: Record<string, unknown>): Promise<unknown>;
  deleteMany(filter: Record<string, unknown>): Promise<{ deletedCount?: number }>;
  countDocuments(filter: Record<string, unknown>): Promise<number>;
  find(filter: Record<string, unknown>): DeadLetterQueryLike;
}

function toEntryDate(value: Date | string | undefined): Date {
  const date = value instanceof Date ? value : new Date(value ?? Number.NaN);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function toEntry(doc: GuildDeadLetterRecord): DeadLetterEntry {
  return {
    kind: doc.kind ?? "update",
    itemId: doc.itemId || "",
    title: doc.title || "",
    channelId: doc.channelId || "",
    dedupeKey: doc.dedupeKey || "",
    reason: doc.reason || "",
    attempts: doc.attempts ?? 0,
    failedAt: toEntryDate(doc.failedAt)
  };
}

export async function recordDeadLetters(
  model: Pick<DeadLetterModelLike, "insertMany" | "find" | "deleteMany">,
  guildId: string,
  entries: DeadLetterEntry[]
): Promise<void> {
  if (!entries.length) return;
  await model.insertMany(entries.map(entry => ({ guildId, ...entry })), { ordered: false });
  const overflow = await model.find({ guildId }).sort({ failedAt: -1 }).skip(NOTIFICATION_DEAD_LETTER_LIMIT).limit(NOTIFICATION_DEAD_LETTER_LIMIT).lean();
  if (overflow.length > 0) {
    await model.deleteMany({ _id: { $in: overflow.map(doc => doc._id) } });
  }
}

export async function listDeadLetters(
  model: Pick<DeadLetterModelLike, "find">,
  guildId: string,
  limit = NOTIFICATION_DEAD_LETTER_LIMIT
): Promise<DeadLetterEntry[]> {
  const docs = await model.find({ guildId }).sort({ failedAt: -1 }).skip(0).limit(Math.max(0, limit)).lean();
  return docs.map(toEntry);
}

export async function countDeadLetters(model: Pick<DeadLetterModelLike, "countDocuments">, guildId: string): Promise<number> {
  return model.countDocuments({ guildId });
}

export async function clearDeadLetters(model: Pick<DeadLetterModelLike, "deleteMany">, guildId: string): Promise<void> {
  await model.deleteMany({ guildId });
}

export async function deleteDeadLettersByDedupeKeys(
  model: Pick<DeadLetterModelLike, "deleteMany">,
  guildId: string,
  dedupeKeys: string[]
): Promise<void> {
  if (!dedupeKeys.length) return;
  await model.deleteMany({ guildId, dedupeKey: { $in: dedupeKeys } });
}
