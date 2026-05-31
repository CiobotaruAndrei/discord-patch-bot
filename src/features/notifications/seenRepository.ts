
import type { Model } from "mongoose";
import type { GuildSettings } from "../../types";

type MongoWriteResult = { matchedCount?: number; modifiedCount?: number };
type GuildModelLike = Pick<Model<GuildSettings>, "updateOne" | "exists">;
type WithMongoRetry = <T>(fn: () => Promise<T>, opts?: { label?: string; retries?: number }) => Promise<T>;

interface GuildSeenDiscountModelLike {
  updateOne(filter: unknown, update: unknown, opts?: unknown): Promise<{ upsertedCount?: number; matchedCount?: number }>;
  deleteOne(filter: unknown): Promise<{ deletedCount?: number }>;
  find(filter: unknown, projection?: unknown): { lean(): Promise<Array<{ dealHash?: unknown }>> };
}

interface GuildSeenUpdateModelLike {
  updateOne(filter: unknown, update: unknown, opts?: unknown): Promise<{ upsertedCount?: number; matchedCount?: number }>;
  deleteOne(filter: unknown): Promise<{ deletedCount?: number }>;
}

export interface SeenRepositoryDeps {
  GuildModel: GuildModelLike;
  GuildSeenDiscountModel: GuildSeenDiscountModelLike;
  GuildSeenUpdateModel: GuildSeenUpdateModelLike;
  withMongoRetry: WithMongoRetry;
  SEEN_PER_GAME_LIMIT: number;
  DEALS_HISTORY_LIMIT: number;
  OP_UPDATE_OPTS: Record<string, unknown>;
}

export interface SeenRepository {
  claimSeenUpdate(guildId: string, channelId: string, gameKey: string, updateId: string): Promise<MongoWriteResult>;
  rollbackSeenUpdate(guildId: string, gameKey: string, updateId: string): Promise<MongoWriteResult>;
  disableUpdatesForChannelError(guildId: string, channelId: string, message: string): Promise<MongoWriteResult>;
  claimSeenDiscount(guildId: string, channelId: string, hash: string): Promise<MongoWriteResult>;
  rollbackSeenDiscount(guildId: string, hash: string): Promise<MongoWriteResult>;
  loadSeenDiscountHashes(guildId: string): Promise<string[]>;
  disableDiscountsForChannelError(guildId: string, channelId: string, message: string): Promise<MongoWriteResult>;
}

export function createSeenRepository(deps: SeenRepositoryDeps): SeenRepository {
  const { GuildModel, GuildSeenDiscountModel, GuildSeenUpdateModel, withMongoRetry, OP_UPDATE_OPTS } = deps;

  async function claimSeenUpdate(guildId: string, channelId: string, gameKey: string, updateId: string): Promise<MongoWriteResult> {
    const subscribed = await withMongoRetry(() => GuildModel.exists({
      _id: guildId,
      subscribed: true,
      notificationChannelId: channelId,
      updatesInitializing: { $ne: true }
    }), { label: "claimSeenUpdate:guard" });
    if (!subscribed) return { matchedCount: 0 };

    const res = await withMongoRetry(() => GuildSeenUpdateModel.updateOne(
      { guildId, gameKey, updateId },
      { $setOnInsert: { guildId, gameKey, updateId, seenAt: new Date() } },
      { upsert: true }
    ), { label: "claimSeenUpdate:seen" });
    return { matchedCount: (res.upsertedCount ?? 0) > 0 ? 1 : 0 };
  }

  async function rollbackSeenUpdate(guildId: string, gameKey: string, updateId: string): Promise<MongoWriteResult> {
    const res = await withMongoRetry(
      () => GuildSeenUpdateModel.deleteOne({ guildId, gameKey, updateId }),
      { label: "rollbackSeenUpdate" }
    );
    return { matchedCount: res.deletedCount ?? 0 };
  }

  async function disableUpdatesForChannelError(guildId: string, channelId: string, message: string): Promise<MongoWriteResult> {
    return GuildModel.updateOne(
      { _id: guildId },
      {
        $set: {
          subscribed: false,
          notificationChannelId: null,
          updatesInitializing: false,
          updatesLastError: { message, channelId, at: new Date() }
        }
      },
      OP_UPDATE_OPTS
    );
  }

  async function claimSeenDiscount(guildId: string, channelId: string, hash: string): Promise<MongoWriteResult> {
    const subscribed = await withMongoRetry(() => GuildModel.exists({
      _id: guildId,
      discountsSubscribed: true,
      discountChannelId: channelId,
      discountsInitializing: { $ne: true }
    }), { label: "claimSeenDiscount:guard" });
    if (!subscribed) return { matchedCount: 0 };

    const res = await withMongoRetry(() => GuildSeenDiscountModel.updateOne(
      { guildId, dealHash: hash },
      { $setOnInsert: { guildId, dealHash: hash, seenAt: new Date() } },
      { upsert: true }
    ), { label: "claimSeenDiscount:seen" });
    return { matchedCount: (res.upsertedCount ?? 0) > 0 ? 1 : 0 };
  }

  async function rollbackSeenDiscount(guildId: string, hash: string): Promise<MongoWriteResult> {
    const res = await withMongoRetry(
      () => GuildSeenDiscountModel.deleteOne({ guildId, dealHash: hash }),
      { label: "rollbackSeenDiscount" }
    );
    return { matchedCount: res.deletedCount ?? 0 };
  }

  async function loadSeenDiscountHashes(guildId: string): Promise<string[]> {
    const docs = await withMongoRetry(
      () => GuildSeenDiscountModel.find({ guildId }, { dealHash: 1 }).lean(),
      { label: "loadSeenDiscountHashes" }
    );
    return docs.map(doc => String(doc.dealHash || "")).filter(Boolean);
  }

  async function disableDiscountsForChannelError(guildId: string, channelId: string, message: string): Promise<MongoWriteResult> {
    return GuildModel.updateOne(
      { _id: guildId },
      {
        $set: {
          discountsSubscribed: false,
          discountChannelId: null,
          discountsInitializing: false,
          discountsLastError: { message, channelId, at: new Date() }
        }
      },
      OP_UPDATE_OPTS
    );
  }

  return {
    claimSeenUpdate,
    rollbackSeenUpdate,
    disableUpdatesForChannelError,
    claimSeenDiscount,
    rollbackSeenDiscount,
    loadSeenDiscountHashes,
    disableDiscountsForChannelError
  };
}
