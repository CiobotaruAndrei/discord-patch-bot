
import type { Model } from "mongoose";
import type { GuildSettings } from "../../types";

type MongoWriteResult = { matchedCount?: number; modifiedCount?: number };
type GuildModelLike = Pick<Model<GuildSettings>, "updateOne">;
type WithMongoRetry = <T>(fn: () => Promise<T>, opts?: { label?: string; retries?: number }) => Promise<T>;

export interface SeenRepositoryDeps {
  GuildModel: GuildModelLike;
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
  disableDiscountsForChannelError(guildId: string, channelId: string, message: string): Promise<MongoWriteResult>;
}

export function createSeenRepository(deps: SeenRepositoryDeps): SeenRepository {
  const { GuildModel, withMongoRetry, SEEN_PER_GAME_LIMIT, DEALS_HISTORY_LIMIT, OP_UPDATE_OPTS } = deps;

  // ---- /start updates path ----------------------------------------------
  async function claimSeenUpdate(guildId: string, channelId: string, gameKey: string, updateId: string): Promise<MongoWriteResult> {
    return withMongoRetry(() => GuildModel.updateOne(
      {
        _id: guildId,
        subscribed: true,
        notificationChannelId: channelId,
        updatesInitializing: { $ne: true },
        [`seen.${gameKey}`]: { $ne: updateId }
      },
      {
        $push: { [`seen.${gameKey}`]: { $each: [updateId], $slice: -SEEN_PER_GAME_LIMIT } },
        $pull: { [`pendingUpdates.${gameKey}`]: { id: updateId } },
        $set: { lastProcessedGameKey: gameKey }
      },
      OP_UPDATE_OPTS
    ), { label: "claimSeenUpdate" });
  }

  async function rollbackSeenUpdate(guildId: string, gameKey: string, updateId: string): Promise<MongoWriteResult> {
    // Retry indispensabil: vezi PR #98. Fara retry, un blip Mongo intre claim
    // si rollback (dupa channel.send esuat) lasa hash-ul in `seen`, iar
    // urmatorul ciclu cron sare update-ul "deja vazut" — notificare definitiv
    // pierduta.
    return withMongoRetry(() => GuildModel.updateOne(
      { _id: guildId },
      { $pull: { [`seen.${gameKey}`]: updateId } }
    ), { label: "rollbackSeenUpdate" });
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

  // ---- /start reduceri path ---------------------------------------------
  async function claimSeenDiscount(guildId: string, channelId: string, hash: string): Promise<MongoWriteResult> {
    return withMongoRetry(() => GuildModel.updateOne(
      {
        _id: guildId,
        discountsSubscribed: true,
        discountChannelId: channelId,
        discountsInitializing: { $ne: true },
        seenDiscounts: { $ne: hash }
      },
      {
        $push: { seenDiscounts: { $each: [hash], $slice: -DEALS_HISTORY_LIMIT } },
        $pull: { pendingDiscounts: { hash } }
      },
      OP_UPDATE_OPTS
    ), { label: "claimSeenDiscount" });
  }

  async function rollbackSeenDiscount(guildId: string, hash: string): Promise<MongoWriteResult> {
    // Acelasi rationament de retry ca rollbackSeenUpdate.
    return withMongoRetry(() => GuildModel.updateOne(
      { _id: guildId },
      { $pull: { seenDiscounts: hash } }
    ), { label: "rollbackSeenDiscount" });
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
    disableDiscountsForChannelError
  };
}
