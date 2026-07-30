import type { WriteCounts } from "./persistenceOutcome.js";

export type SliceDoc = Record<string, unknown> | null;
export type SliceUpdate = Record<string, unknown> | readonly Record<string, unknown>[];

export interface GuildSliceModel {
  findOne(filter: Record<string, unknown>): unknown;
  findOneAndUpdate(filter: Record<string, unknown>, update: SliceUpdate, options?: Record<string, unknown>): unknown;
  updateOne(filter: Record<string, unknown>, update: SliceUpdate, options?: Record<string, unknown>): Promise<WriteCounts | null | undefined>;
  updateMany?(filter: Record<string, unknown>, update: SliceUpdate): Promise<WriteCounts | null | undefined>;
}

async function resolve(value: unknown): Promise<SliceDoc> {
  if (value && typeof value === "object" && "lean" in value && typeof (value as { lean: unknown }).lean === "function") {
    return await (value as { lean: () => Promise<SliceDoc> }).lean();
  }
  return (await value) as SliceDoc;
}

function ownedRoot(fields: readonly string[], key: string): boolean {
  return fields.includes(key.split(".")[0]);
}

export function updateTouchesSlice(fields: readonly string[], update: SliceUpdate): boolean {
  const stages = Array.isArray(update) ? update : [update];
  return stages.some(stage => {
    const entries = stage as Record<string, unknown>;
    if (Object.keys(entries).some(key => ownedRoot(fields, key))) return true;
    return Object.values(entries).some(operand =>
      operand && typeof operand === "object"
        ? Object.keys(operand as Record<string, unknown>).some(key => ownedRoot(fields, key))
        : false
    );
  });
}

export function sliceOf(fields: readonly string[], document: SliceDoc): Record<string, unknown> {
  const slice: Record<string, unknown> = {};
  if (!document) return slice;
  for (const field of fields) {
    if (document[field] !== undefined) slice[field] = document[field];
  }
  return slice;
}

export function createGuildDomainSliceStore(
  fields: readonly string[],
  legacyModel: GuildSliceModel,
  dedicatedModel: GuildSliceModel,
  onBackfill?: (guildId: string) => void
) {
  function guildIdOf(filter: Record<string, unknown>): string | null {
    const raw = filter._id ?? filter.guildId;
    return typeof raw === "string" ? raw : null;
  }

  return {
    async findOne(filter: Record<string, unknown>): Promise<SliceDoc> {
      const dedicated = await resolve(dedicatedModel.findOne(filter));
      if (dedicated && Object.keys(sliceOf(fields, dedicated)).length > 0) return dedicated;

      const legacy = await resolve(legacyModel.findOne(filter));
      const slice = sliceOf(fields, legacy);
      const guildId = guildIdOf(filter);
      if (guildId && Object.keys(slice).length > 0) {
        await dedicatedModel.updateOne({ _id: guildId }, { $set: slice }, { upsert: true });
        onBackfill?.(guildId);
      }
      return legacy;
    },

    async findOneAndUpdate(filter: Record<string, unknown>, update: SliceUpdate, options?: Record<string, unknown>): Promise<SliceDoc> {
      const guildId = guildIdOf(filter);
      if (guildId && updateTouchesSlice(fields, update)) {
        await dedicatedModel.findOneAndUpdate({ _id: guildId }, update, { ...options, upsert: true });
      }
      return await resolve(legacyModel.findOneAndUpdate(filter, update, options));
    },

    async updateOne(
      filter: Record<string, unknown>,
      update: SliceUpdate,
      options?: Record<string, unknown>
    ): Promise<WriteCounts | null | undefined> {
      const guildId = guildIdOf(filter);
      if (guildId && updateTouchesSlice(fields, update)) {
        await dedicatedModel.updateOne({ _id: guildId }, update, { ...options, upsert: true });
      }
      return await legacyModel.updateOne(filter, update, options);
    },

    async updateMany(filter: Record<string, unknown>, update: SliceUpdate): Promise<WriteCounts | null | undefined> {
      if (updateTouchesSlice(fields, update) && dedicatedModel.updateMany) {
        await dedicatedModel.updateMany(filter, update);
      }
      return legacyModel.updateMany ? await legacyModel.updateMany(filter, update) : null;
    }
  };
}
