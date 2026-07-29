
type MongoWriteResult = MongoWriteOutcome;
interface GuildModelLike {
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, opts?: Record<string, unknown>): Promise<MongoWriteResult>;
  exists(filter: Record<string, unknown>): Promise<{ _id: unknown } | null>;
}
type WithMongoRetry = <T>(fn: () => Promise<T>, opts?: { label?: string; retries?: number }) => Promise<T>;
import type { MongoWriteOutcome, PriceAlertRule } from "../../types.js";
import { createdDocument } from "../../shared/persistenceOutcome.js";
type MongoFilter = Record<string, unknown>;
type MongoUpdate = Record<string, unknown>;
type MongoProjection = Record<string, unknown>;
type MongoQueryOptions = Record<string, unknown>;

interface GuildSeenDiscountModelLike {
  updateOne(filter: MongoFilter, update: MongoUpdate, opts?: MongoQueryOptions): Promise<{ upsertedCount?: number; matchedCount?: number }>;
  deleteOne(filter: MongoFilter): Promise<{ deletedCount?: number }>;
  find(filter: MongoFilter, projection?: MongoProjection): { lean(): Promise<Array<{ dealHash?: unknown }>> };
  bulkWrite(ops: unknown[], opts?: MongoQueryOptions): Promise<unknown>;
}

interface GuildSeenUpdateModelLike {
  updateOne(filter: MongoFilter, update: MongoUpdate, opts?: MongoQueryOptions): Promise<{ upsertedCount?: number; matchedCount?: number }>;
  deleteOne(filter: MongoFilter): Promise<{ deletedCount?: number }>;
  bulkWrite(ops: unknown[], opts?: MongoQueryOptions): Promise<unknown>;
}

interface GuildSeenDlcModelLike {
  updateOne(filter: MongoFilter, update: MongoUpdate, opts?: MongoQueryOptions): Promise<{ upsertedCount?: number; matchedCount?: number }>;
  deleteOne(filter: MongoFilter): Promise<{ deletedCount?: number }>;
  find(filter: MongoFilter, projection?: MongoProjection): { lean(): Promise<Array<{ dlcKey?: unknown }>> };
  bulkWrite(ops: unknown[], opts?: MongoQueryOptions): Promise<unknown>;
}

export interface SeenRepositoryDeps {
  GuildModel: GuildModelLike;
  GuildSeenDiscountModel: GuildSeenDiscountModelLike;
  GuildSeenUpdateModel: GuildSeenUpdateModelLike;
  GuildSeenDlcModel?: GuildSeenDlcModelLike;
  withMongoRetry: WithMongoRetry;
  SEEN_PER_GAME_LIMIT: number;
  DEALS_HISTORY_LIMIT: number;
  OP_UPDATE_OPTS: Record<string, unknown>;
  adminAlert?: (kind: string, title: string, body: unknown, guildId?: string) => Promise<unknown>;
}

export interface SeenRepository {
  claimSeenUpdate(guildId: string, channelId: string, gameKey: string, updateId: string): Promise<MongoWriteResult>;
  rollbackSeenUpdate(guildId: string, gameKey: string, updateId: string): Promise<MongoWriteResult>;
  seedSeenUpdates(guildId: string, entries: Array<{ gameKey: string; updateId: string }>): Promise<void>;
  disableUpdatesForChannelError(guildId: string, channelId: string, message: string): Promise<MongoWriteResult>;
  claimSeenDiscount(guildId: string, channelId: string, hash: string): Promise<MongoWriteResult>;
  rollbackSeenDiscount(guildId: string, hash: string): Promise<MongoWriteResult>;
  seedSeenDiscounts(guildId: string, hashes: string[]): Promise<void>;
  loadSeenDiscountHashes(guildId: string, candidateHashes?: string[]): Promise<string[]>;
  disableDiscountsForChannelError(guildId: string, channelId: string, message: string): Promise<MongoWriteResult>;
  claimSeenDlc(guildId: string, channelId: string, gameKey: string, dlcKey: string): Promise<MongoWriteResult>;
  rollbackSeenDlc(guildId: string, gameKey: string, dlcKey: string): Promise<MongoWriteResult>;
  seedSeenDlcs(guildId: string, entries: Array<{ gameKey: string; dlcKey: string }>): Promise<void>;
  loadSeenDlcKeys(guildId: string, gameKey?: string): Promise<string[]>;
  disableDlcForChannelError(guildId: string, channelId: string, message: string): Promise<MongoWriteResult>;
  setSeenHashVersion(guildId: string, field: "seenHashVersionUpdates" | "seenHashVersionDiscounts", version: number): Promise<MongoWriteResult>;
  rollbackTriggeredAlert(guildId: string, alert: PriceAlertRule): Promise<MongoWriteResult>;
}

export function dlcSeenDedupKey(gameKey: string, dlcKey: string): string {
  return JSON.stringify([gameKey, dlcKey]);
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
    return { matchedCount: createdDocument(res) ? 1 : 0 };
  }

  async function rollbackSeenUpdate(guildId: string, gameKey: string, updateId: string): Promise<MongoWriteResult> {
    const res = await withMongoRetry(
      () => GuildSeenUpdateModel.deleteOne({ guildId, gameKey, updateId }),
      { label: "rollbackSeenUpdate" }
    );
    return { matchedCount: res.deletedCount ?? 0 };
  }

  async function seedSeenUpdates(guildId: string, entries: Array<{ gameKey: string; updateId: string }>): Promise<void> {
    const ops = entries
      .filter(entry => entry && entry.gameKey && entry.updateId)
      .map(entry => ({
        updateOne: {
          filter: { guildId, gameKey: entry.gameKey, updateId: entry.updateId },
          update: { $setOnInsert: { guildId, gameKey: entry.gameKey, updateId: entry.updateId, seenAt: new Date() } },
          upsert: true
        }
      }));
    if (!ops.length) return;
    await withMongoRetry(() => GuildSeenUpdateModel.bulkWrite(ops, { ordered: false }), { label: "seedSeenUpdates" });
  }

  async function disableUpdatesForChannelError(guildId: string, channelId: string, message: string): Promise<MongoWriteResult> {
    const result = await GuildModel.updateOne(
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
    deps.adminAlert?.(
      "discord:updates-channel-disabled",
      "Notificarile de update-uri au fost oprite automat",
      `Canal: ${channelId}\nMotiv: ${message}`,
      guildId
    ).catch(() => undefined);
    return result;
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
    return { matchedCount: createdDocument(res) ? 1 : 0 };
  }

  async function rollbackSeenDiscount(guildId: string, hash: string): Promise<MongoWriteResult> {
    const res = await withMongoRetry(
      () => GuildSeenDiscountModel.deleteOne({ guildId, dealHash: hash }),
      { label: "rollbackSeenDiscount" }
    );
    return { matchedCount: res.deletedCount ?? 0 };
  }

  async function seedSeenDiscounts(guildId: string, hashes: string[]): Promise<void> {
    const ops = Array.from(new Set(hashes.filter(hash => typeof hash === "string" && hash.length > 0)))
      .map(hash => ({
        updateOne: {
          filter: { guildId, dealHash: hash },
          update: { $setOnInsert: { guildId, dealHash: hash, seenAt: new Date() } },
          upsert: true
        }
      }));
    if (!ops.length) return;
    await withMongoRetry(() => GuildSeenDiscountModel.bulkWrite(ops, { ordered: false }), { label: "seedSeenDiscounts" });
  }

  async function loadSeenDiscountHashes(guildId: string, candidateHashes?: string[]): Promise<string[]> {
    const filter: Record<string, unknown> = { guildId };
    if (Array.isArray(candidateHashes)) {
      const unique = Array.from(new Set(candidateHashes.filter(hash => typeof hash === "string" && hash.length > 0)));
      if (!unique.length) return [];
      filter.dealHash = { $in: unique };
    }
    const docs = await withMongoRetry(
      () => GuildSeenDiscountModel.find(filter, { dealHash: 1 }).lean(),
      { label: "loadSeenDiscountHashes" }
    );
    return docs.map(doc => String(doc.dealHash || "")).filter(Boolean);
  }

  async function disableDiscountsForChannelError(guildId: string, channelId: string, message: string): Promise<MongoWriteResult> {
    const result = await GuildModel.updateOne(
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
    deps.adminAlert?.(
      "discord:discounts-channel-disabled",
      "Alertele de reduceri au fost oprite automat",
      `Canal: ${channelId}\nMotiv: ${message}`,
      guildId
    ).catch(() => undefined);
    return result;
  }

  async function claimSeenDlc(guildId: string, channelId: string, gameKey: string, dlcKey: string): Promise<MongoWriteResult> {
    if (!deps.GuildSeenDlcModel) return { matchedCount: 0 };
    const subscribed = await withMongoRetry(() => GuildModel.exists({
      _id: guildId,
      dlcSubscribed: true,
      dlcChannelId: channelId,
      dlcInitializing: { $ne: true }
    }), { label: "claimSeenDlc:guard" });
    if (!subscribed) return { matchedCount: 0 };

    const res = await withMongoRetry(() => deps.GuildSeenDlcModel!.updateOne(
      { guildId, gameKey, dlcKey },
      { $setOnInsert: { guildId, gameKey, dlcKey, seenAt: new Date() } },
      { upsert: true }
    ), { label: "claimSeenDlc:seen" });
    return { matchedCount: createdDocument(res) ? 1 : 0 };
  }

  async function seedSeenDlcs(guildId: string, entries: Array<{ gameKey: string; dlcKey: string }>): Promise<void> {
    if (!deps.GuildSeenDlcModel) return;
    const seen = new Set<string>();
    const ops = entries
      .filter(entry => entry && entry.gameKey && entry.dlcKey && !seen.has(dlcSeenDedupKey(entry.gameKey, entry.dlcKey)) && seen.add(dlcSeenDedupKey(entry.gameKey, entry.dlcKey)))
      .map(entry => ({
        updateOne: {
          filter: { guildId, gameKey: entry.gameKey, dlcKey: entry.dlcKey },
          update: { $setOnInsert: { guildId, gameKey: entry.gameKey, dlcKey: entry.dlcKey, seenAt: new Date() } },
          upsert: true
        }
      }));
    if (!ops.length) return;
    await withMongoRetry(() => deps.GuildSeenDlcModel!.bulkWrite(ops, { ordered: false }), { label: "seedSeenDlcs" });
  }

  async function loadSeenDlcKeys(guildId: string, gameKey?: string): Promise<string[]> {
    if (!deps.GuildSeenDlcModel) return [];
    const filter: Record<string, unknown> = { guildId };
    if (typeof gameKey === "string" && gameKey.length > 0) filter.gameKey = gameKey;
    const docs = await withMongoRetry(
      () => deps.GuildSeenDlcModel!.find(filter, { dlcKey: 1 }).lean(),
      { label: "loadSeenDlcKeys" }
    );
    return docs.map(doc => String(doc.dlcKey || "")).filter(Boolean);
  }

  async function rollbackSeenDlc(guildId: string, gameKey: string, dlcKey: string): Promise<MongoWriteResult> {
    if (!deps.GuildSeenDlcModel) return { matchedCount: 0 };
    const res = await withMongoRetry(
      () => deps.GuildSeenDlcModel!.deleteOne({ guildId, gameKey, dlcKey }),
      { label: "rollbackSeenDlc" }
    );
    return { matchedCount: res.deletedCount ?? 0 };
  }

  async function disableDlcForChannelError(guildId: string, channelId: string, message: string): Promise<MongoWriteResult> {
    const result = await GuildModel.updateOne(
      { _id: guildId },
      {
        $set: {
          dlcSubscribed: false,
          dlcChannelId: null,
          dlcInitializing: false,
          dlcLastError: { message, channelId, at: new Date() }
        }
      },
      OP_UPDATE_OPTS
    );
    deps.adminAlert?.(
      "discord:dlc-channel-disabled",
      "Notificarile DLC au fost oprite automat",
      `Canal: ${channelId}\nMotiv: ${message}`,
      guildId
    ).catch(() => undefined);
    return result;
  }

  async function setSeenHashVersion(guildId: string, field: "seenHashVersionUpdates" | "seenHashVersionDiscounts", version: number): Promise<MongoWriteResult> {
    return withMongoRetry(
      () => GuildModel.updateOne({ _id: guildId }, { $set: { [field]: version } }, OP_UPDATE_OPTS),
      { label: "setSeenHashVersion" }
    );
  }

  async function rollbackTriggeredAlert(guildId: string, alert: PriceAlertRule): Promise<MongoWriteResult> {
    return GuildModel.updateOne(
      { _id: guildId },
      { $set: { "priceAlerts.$[alert].triggeredAt": null } },
      {
        ...OP_UPDATE_OPTS,
        arrayFilters: [{ "alert.gameKey": alert.gameKey, "alert.currency": alert.currency }]
      }
    );
  }

  return {
    claimSeenUpdate,
    rollbackSeenUpdate,
    seedSeenUpdates,
    disableUpdatesForChannelError,
    claimSeenDiscount,
    rollbackSeenDiscount,
    seedSeenDiscounts,
    loadSeenDiscountHashes,
    disableDiscountsForChannelError,
    claimSeenDlc,
    rollbackSeenDlc,
    seedSeenDlcs,
    loadSeenDlcKeys,
    disableDlcForChannelError,
    setSeenHashVersion,
    rollbackTriggeredAlert
  };
}
