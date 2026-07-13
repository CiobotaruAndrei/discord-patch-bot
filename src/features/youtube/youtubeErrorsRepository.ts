"use strict";

import type { YouTubeErrorEntry } from "../../types.js";

export interface GuildYoutubeErrorRecord {
  _id?: unknown;
  guildId: string;
  channelId?: string;
  channelName?: string;
  message?: string;
  at?: Date | string;
}

export interface YoutubeErrorQueryLike {
  sort(spec: Record<string, 1 | -1>): YoutubeErrorQueryLike;
  skip(count: number): YoutubeErrorQueryLike;
  limit(count: number): YoutubeErrorQueryLike;
  lean(): Promise<GuildYoutubeErrorRecord[]>;
}

export interface YoutubeErrorModelLike {
  create(doc: GuildYoutubeErrorRecord): Promise<unknown>;
  deleteMany(filter: Record<string, unknown>): Promise<{ deletedCount?: number }>;
  countDocuments(filter: Record<string, unknown>): Promise<number>;
  find(filter: Record<string, unknown>): YoutubeErrorQueryLike;
}

export const YOUTUBE_ERROR_LIMIT = 20;

function toEntryDate(value: Date | string | undefined): Date {
  const date = value instanceof Date ? value : new Date(value ?? Number.NaN);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function toEntry(doc: GuildYoutubeErrorRecord): YouTubeErrorEntry {
  return {
    channelId: doc.channelId || "",
    channelName: doc.channelName || "",
    message: doc.message || "",
    at: toEntryDate(doc.at)
  };
}

export async function recordYoutubeError(
  model: Pick<YoutubeErrorModelLike, "create" | "find" | "deleteMany">,
  guildId: string,
  entry: Omit<YouTubeErrorEntry, "at">
): Promise<void> {
  await model.create({
    guildId,
    channelId: entry.channelId || "",
    channelName: entry.channelName || "",
    message: entry.message || "",
    at: new Date()
  });
  const overflow = await model.find({ guildId }).sort({ at: -1 }).skip(YOUTUBE_ERROR_LIMIT).limit(YOUTUBE_ERROR_LIMIT).lean();
  if (overflow.length > 0) {
    await model.deleteMany({ _id: { $in: overflow.map(doc => doc._id) } });
  }
}

export async function listYoutubeErrors(
  model: Pick<YoutubeErrorModelLike, "find">,
  guildId: string,
  limit = YOUTUBE_ERROR_LIMIT
): Promise<YouTubeErrorEntry[]> {
  const docs = await model.find({ guildId }).sort({ at: -1 }).skip(0).limit(Math.max(0, limit)).lean();
  return docs.map(toEntry);
}

export async function countYoutubeErrors(model: Pick<YoutubeErrorModelLike, "countDocuments">, guildId: string): Promise<number> {
  return model.countDocuments({ guildId });
}

export async function clearYoutubeErrors(model: Pick<YoutubeErrorModelLike, "deleteMany">, guildId: string): Promise<void> {
  await model.deleteMany({ guildId });
}
