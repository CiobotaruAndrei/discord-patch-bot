"use strict";

import type { ModerationGuildModel } from "./moderationRepository.js";

type Doc = Record<string, unknown> | null;
type Update = Record<string, unknown> | readonly Record<string, unknown>[];

export const MODERATION_FIELDS = [
  "moderationTimeouts",
  "moderationMutes",
  "moderationWarnings",
  "moderationWarnBanLimit"
] as const;

type ModerationField = (typeof MODERATION_FIELDS)[number];

function isModerationField(key: string): key is ModerationField {
  return (MODERATION_FIELDS as readonly string[]).includes(key);
}

async function resolve(value: unknown): Promise<Doc> {
  if (value && typeof value === "object" && "lean" in value && typeof (value as { lean: unknown }).lean === "function") {
    return await (value as { lean: () => Promise<Doc> }).lean();
  }
  return (await value) as Doc;
}

function touchesModeration(update: Update): boolean {
  const stages = Array.isArray(update) ? update : [update];
  return stages.some(stage =>
    Object.values(stage as Record<string, unknown>).some(operand =>
      operand && typeof operand === "object"
        ? Object.keys(operand as Record<string, unknown>).some(key => isModerationField(key.split(".")[0]))
        : false
    ) || Object.keys(stage as Record<string, unknown>).some(key => isModerationField(key.split(".")[0]))
  );
}

function moderationSlice(document: Doc): Record<string, unknown> {
  const slice: Record<string, unknown> = {};
  if (!document) return slice;
  for (const field of MODERATION_FIELDS) {
    if (document[field] !== undefined) slice[field] = document[field];
  }
  return slice;
}

export function createModerationStore(
  guildModel: ModerationGuildModel,
  moderationModel: ModerationGuildModel,
  onBackfill?: (guildId: string) => void
): ModerationGuildModel {
  function guildIdOf(filter: Record<string, unknown>): string | null {
    const raw = filter._id ?? filter.guildId;
    return typeof raw === "string" ? raw : null;
  }

  return {
    async findOne(filter: Record<string, unknown>): Promise<Doc> {
      const dedicated = await resolve(moderationModel.findOne(filter));
      if (dedicated && Object.keys(moderationSlice(dedicated)).length > 0) return dedicated;

      const legacy = await resolve(guildModel.findOne(filter));
      const slice = moderationSlice(legacy);
      const guildId = guildIdOf(filter);
      if (guildId && Object.keys(slice).length > 0) {
        await moderationModel.updateOne({ _id: guildId }, { $set: slice }, { upsert: true });
        onBackfill?.(guildId);
      }
      return legacy;
    },

    async findOneAndUpdate(filter: Record<string, unknown>, update: Update, options?: Record<string, unknown>): Promise<Doc> {
      const guildId = guildIdOf(filter);
      if (guildId && touchesModeration(update)) {
        await moderationModel.findOneAndUpdate({ _id: guildId }, update, { ...options, upsert: true });
      }
      return await resolve(guildModel.findOneAndUpdate(filter, update, options));
    },

    async updateOne(filter: Record<string, unknown>, update: Update, options?: Record<string, unknown>) {
      const guildId = guildIdOf(filter);
      if (guildId && touchesModeration(update)) {
        await moderationModel.updateOne({ _id: guildId }, update, { ...options, upsert: true });
      }
      return await guildModel.updateOne(filter, update, options);
    },

    async updateMany(filter: Record<string, unknown>, update: Update) {
      if (touchesModeration(update) && moderationModel.updateMany) {
        await moderationModel.updateMany(filter, update);
      }
      return guildModel.updateMany ? await guildModel.updateMany(filter, update) : null;
    }
  };
}
