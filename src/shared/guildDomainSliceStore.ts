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

export type SliceCopyWriter = (guildId: string, update: SliceUpdate) => Promise<void>;

export interface SplitUpdate {
  own: Record<string, unknown> | null;
  rest: Record<string, unknown> | null;
}

export function splitUpdateBySlice(fields: readonly string[], update: SliceUpdate): SplitUpdate {
  if (Array.isArray(update)) return { own: null, rest: null };
  const own: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [operator, operand] of Object.entries(update)) {
    if (!operator.startsWith("$") || !operand || typeof operand !== "object" || Array.isArray(operand)) {
      rest[operator] = operand;
      continue;
    }
    const ownInner: Record<string, unknown> = {};
    const restInner: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(operand as Record<string, unknown>)) {
      if (!ownedRoot(fields, key)) {
        restInner[key] = value;
        continue;
      }
      ownInner[key] = value;
      if (operator === "$unset") restInner[key] = value;
    }
    if (Object.keys(ownInner).length > 0) own[operator] = ownInner;
    if (Object.keys(restInner).length > 0) rest[operator] = restInner;
  }
  return {
    own: Object.keys(own).length > 0 ? own : null,
    rest: Object.keys(rest).length > 0 ? rest : null
  };
}

export interface SliceStoreReporters {
  onBackfill?: (guildId: string) => void;
  onCopied?: (guildId: string) => void;
  onCopyFailed?: (guildId: string, error: unknown) => void;
}

export async function writeCanonicalThenCopy<T>(
  guildId: string | null,
  touchesSlice: boolean,
  canonical: () => Promise<T>,
  copy: () => Promise<unknown>,
  reporters?: SliceStoreReporters
): Promise<T> {
  const result = await canonical();
  if (!guildId || !touchesSlice) return result;
  try {
    await copy();
    reporters?.onCopied?.(guildId);
  } catch (error: unknown) {
    reporters?.onCopyFailed?.(guildId, error);
  }
  return result;
}

export function createGuildDomainSliceStore(
  fields: readonly string[],
  legacyModel: GuildSliceModel,
  dedicatedModel: GuildSliceModel,
  reporters?: ((guildId: string) => void) | SliceStoreReporters,
  journaledCopy?: SliceCopyWriter
) {
  const { onBackfill, onCopied, onCopyFailed } = typeof reporters === "function" ? { onBackfill: reporters, onCopied: undefined, onCopyFailed: undefined } : (reporters ?? {});

  async function copyToDedicated(guildId: string, write: () => Promise<unknown>): Promise<void> {
    try {
      await write();
      onCopied?.(guildId);
    } catch (error: unknown) {
      onCopyFailed?.(guildId, error);
    }
  }

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
      if (!guildId || !updateTouchesSlice(fields, update)) {
        return resolve(legacyModel.findOneAndUpdate(filter, update, options));
      }
      const { own, rest } = splitUpdateBySlice(fields, update);
      if (!own) {
        const result = await resolve(legacyModel.findOneAndUpdate(filter, update, options));
        await copyToDedicated(guildId, () => journaledCopy
          ? journaledCopy(guildId, update)
          : Promise.resolve(dedicatedModel.findOneAndUpdate({ _id: guildId }, update, { ...options, upsert: true })));
        return result;
      }
      const written = await resolve(dedicatedModel.findOneAndUpdate({ _id: guildId }, own, { ...options, upsert: true }));
      onCopied?.(guildId);
      if (!rest) return written;
      await resolve(legacyModel.findOneAndUpdate(filter, rest, options));
      return written;
    },

    async updateOne(
      filter: Record<string, unknown>,
      update: SliceUpdate,
      options?: Record<string, unknown>
    ): Promise<WriteCounts | null | undefined> {
      const guildId = guildIdOf(filter);
      if (!guildId || !updateTouchesSlice(fields, update)) return legacyModel.updateOne(filter, update, options);
      const { own, rest } = splitUpdateBySlice(fields, update);
      if (!own) {
        const result = await legacyModel.updateOne(filter, update, options);
        await copyToDedicated(guildId, () => journaledCopy
          ? journaledCopy(guildId, update)
          : dedicatedModel.updateOne({ _id: guildId }, update, { ...options, upsert: true }));
        return result;
      }
      const written = await dedicatedModel.updateOne({ _id: guildId }, own, { ...options, upsert: true });
      onCopied?.(guildId);
      return rest ? legacyModel.updateOne(filter, rest, options) : written;
    },

    async updateMany(filter: Record<string, unknown>, update: SliceUpdate): Promise<WriteCounts | null | undefined> {
      const result = legacyModel.updateMany ? await legacyModel.updateMany(filter, update) : null;
      if (updateTouchesSlice(fields, update) && dedicatedModel.updateMany) {
        await copyToDedicated(guildIdOf(filter) ?? "*", async () => {
          if (dedicatedModel.updateMany) await dedicatedModel.updateMany(filter, update);
        });
      }
      return result;
    }
  };
}
