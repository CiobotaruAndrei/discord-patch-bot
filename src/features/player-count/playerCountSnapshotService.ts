"use strict";

import type { GameConfig } from "../../config/configTypes.js";
import type { NotificationDiscordClient } from "../notifications/outboundChannel.js";
import { errorMessage } from "../../shared/errors.js";
import ________shared_utilities from "../../shared/utilities.js";
import { evaluatePlayerCountChange, type PlayerCountChange } from "./playerCountChangeSignal.js";
import { watchlistGameFilter } from "./playerCountWatchlist.js";
import { updatedDocument } from "../../shared/persistenceOutcome.js";
import type { MissingDependencyKeys, ExtraDependencyKeys, ExactDependencyKeys } from "../../shared/dependencyKeyContract.js";
const { mapWithConcurrency } = ________shared_utilities;

export interface PlayerCountSnapshot {
  appId: string;
  gameKey: string;
  playerCount: number;
  fetchedAt: Date;
}

export interface PlayerCountHistoryPoint extends PlayerCountSnapshot {}

export interface PlayerCountRecord {
  appId: string;
  gameKey: string;
  playerCount: number;
  reachedAt: Date;
}

interface PlayerCountSnapshotLeanDoc {
  _id: string;
  gameKey?: string;
  playerCount?: number;
  fetchedAt?: Date | string;
}

interface PlayerCountHistoryLeanDoc {
  appId?: string;
  gameKey?: string;
  playerCount?: number;
  fetchedAt?: Date | string;
}

interface PlayerCountRecordLeanDoc {
  _id: string;
  gameKey?: string;
  playerCount?: number;
  reachedAt?: Date | string;
}

interface PlayerCountSnapshotModelLike {
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  find(filter: Record<string, unknown>): { lean(): Promise<PlayerCountSnapshotLeanDoc[]> };
}

interface PlayerCountHistoryModelLike {
  create(doc: Record<string, unknown>): Promise<unknown>;
  find(filter: Record<string, unknown>): { sort(spec: Record<string, 1 | -1>): { lean(): Promise<PlayerCountHistoryLeanDoc[]> } };
}

interface PlayerCountRecordModelLike {
  findById(id: string): { lean(): Promise<PlayerCountRecordLeanDoc | null> };
  find(filter: Record<string, unknown>): { lean(): Promise<PlayerCountRecordLeanDoc[]> };
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

interface MilestoneGuildDoc {
  _id: string;
  playerCountChannelId?: string | null;
  enabledGames?: string[];
  playerCountSubscribed?: boolean;
  playerCountWatchState?: Array<{
    gameKey: string;
    appId: string;
    playerCount: number;
    fetchedAt: Date | string;
    lastNotifiedAt?: Date | string | null;
    lastDirection?: "up" | "down" | null;
  }>;
}

interface GuildModelLike {
  find(filter: Record<string, unknown>): { lean(): Promise<MilestoneGuildDoc[]> };
  updateOne?(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<{ modifiedCount?: number }>;
}

interface SteamCurrentPlayersLike {
  appId: string;
  playerCount: number;
  success: boolean;
}

interface PlayerCountSnapshotDeps {
  PlayerCountSnapshotModel: PlayerCountSnapshotModelLike;
  PlayerCountHistoryModel?: PlayerCountHistoryModelLike;
  PlayerCountRecordModel?: PlayerCountRecordModelLike;
  GuildModel?: GuildModelLike;
  fetchSteamCurrentPlayers(appId: string | number): Promise<SteamCurrentPlayersLike>;
  logger(level: string, context: string, message: string, meta?: unknown): void;
}

interface PlayerCountRefreshResult {
  refreshed: number;
  failed: number;
  milestones: number;
}

const REFRESH_CONCURRENCY = 5;
const CHANGE_COOLDOWN_MS = 6 * 60 * 60_000;

function validDate(value: Date | string | undefined): Date | null {
  if (value === undefined) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function validCount(value: unknown): number | null {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : null;
}

function sendableChannel(value: unknown): value is { send(payload: unknown): Promise<unknown> } {
  return Boolean(value) && typeof (value as { send?: unknown }).send === "function";
}

function createPlayerCountSnapshotService(deps: PlayerCountSnapshotDeps) {
  const {
    PlayerCountSnapshotModel,
    fetchSteamCurrentPlayers,
    logger
  } = deps;
  const PlayerCountHistoryModel: PlayerCountHistoryModelLike = deps.PlayerCountHistoryModel || {
    create: async () => undefined,
    find: () => ({ sort: () => ({ lean: async () => [] }) })
  };
  const PlayerCountRecordModel: PlayerCountRecordModelLike = deps.PlayerCountRecordModel || {
    findById: () => ({ lean: async () => null }),
    find: () => ({ lean: async () => [] }),
    updateOne: async () => undefined
  };
  const GuildModel: GuildModelLike = deps.GuildModel || {
    find: () => ({ lean: async () => [] })
  };

  async function claimPlayerCountChange(
    guild: MilestoneGuildDoc,
    game: GameConfig,
    playerCount: number,
    fetchedAt: Date
  ): Promise<PlayerCountChange | null> {
    if (!GuildModel.updateOne) return null;
    const state = guild.playerCountWatchState?.find(entry => entry.gameKey === game.key);
    if (!state) {
      await GuildModel.updateOne(
        {
          _id: guild._id,
          playerCountSubscribed: true,
          "playerCountWatchState.gameKey": { $ne: game.key },
          ...watchlistGameFilter(game.key)
        },
        {
          $push: {
            playerCountWatchState: {
              gameKey: game.key,
              appId: String(game.appId),
              playerCount,
              fetchedAt
            }
          }
        }
      );
      return null;
    }
    const previousAt = validDate(state.fetchedAt);
    const previousCount = validCount(state.playerCount);
    if (!previousAt || previousCount === null) return null;
    const change = evaluatePlayerCountChange(previousCount, playerCount);
    const lastNotifiedAt = validDate(state.lastNotifiedAt ?? undefined);
    const cooldownActive = change.direction === state.lastDirection
      && Boolean(lastNotifiedAt && fetchedAt.getTime() - lastNotifiedAt.getTime() < CHANGE_COOLDOWN_MS);
    const notify = change.significant && change.direction !== "flat" && !cooldownActive;
    const set: Record<string, unknown> = {
      "playerCountWatchState.$[entry].appId": String(game.appId),
      "playerCountWatchState.$[entry].playerCount": playerCount,
      "playerCountWatchState.$[entry].fetchedAt": fetchedAt
    };
    if (notify) {
      set["playerCountWatchState.$[entry].lastNotifiedAt"] = fetchedAt;
      set["playerCountWatchState.$[entry].lastDirection"] = change.direction;
    }
    const result = await GuildModel.updateOne(
      {
        _id: guild._id,
        playerCountSubscribed: true,
        playerCountWatchState: {
          $elemMatch: {
            gameKey: game.key,
            playerCount: previousCount,
            fetchedAt: previousAt
          }
        },
        ...watchlistGameFilter(game.key)
      },
      { $set: set },
      { arrayFilters: [{ "entry.gameKey": game.key, "entry.playerCount": previousCount, "entry.fetchedAt": previousAt }] }
    );
    return notify && updatedDocument(result) ? change : null;
  }

  async function notifyPlayerCountChanges(
    client: NotificationDiscordClient | null | undefined,
    game: GameConfig,
    playerCount: number,
    fetchedAt: Date
  ): Promise<void> {
    const guilds = await GuildModel.find({
      playerCountSubscribed: true,
      playerCountChannelId: { $ne: null },
      ...watchlistGameFilter(game.key)
    }).lean();
    await mapWithConcurrency(guilds, REFRESH_CONCURRENCY, async guild => {
      const change = await claimPlayerCountChange(guild, game, playerCount, fetchedAt);
      if (!change || !client) return null;
      let channel = null;
      try {
        channel = await client.channels.fetch(String(guild.playerCountChannelId || ""));
      } catch {
        return null;
      }
      if (!sendableChannel(channel)) return null;
      const sign = change.absoluteChange > 0 ? "+" : "";
      await channel.send({
        embeds: [{
          title: `Schimbare mare de player-count: ${game.name}`,
          color: change.direction === "up" ? 0x2ecc71 : 0xe74c3c,
          description: `Anterior: **${(playerCount - change.absoluteChange).toLocaleString("en-US")}**\nAcum: **${playerCount.toLocaleString("en-US")}**\nSchimbare: **${sign}${change.absoluteChange.toLocaleString("en-US")} (${sign}${change.percentChange.toFixed(1)}%)**`
        }]
      });
      return null;
    });
  }

  async function notifyMilestone(client: NotificationDiscordClient | null | undefined, game: GameConfig, previous: number, current: number, reachedAt: Date): Promise<void> {
    if (!client) return;
    const guilds = await GuildModel.find({
      playerCountSubscribed: true,
      playerCountChannelId: { $ne: null },
      ...watchlistGameFilter(game.key)
    }).lean();
    await mapWithConcurrency(guilds, REFRESH_CONCURRENCY, async guild => {
      const channelId = String(guild.playerCountChannelId || "");
      if (!channelId) return null;
      try {
        const channel = await client.channels.fetch(channelId);
        if (!sendableChannel(channel)) return null;
        await channel.send({
          embeds: [{
            title: `Record nou de jucatori: ${game.name}`,
            color: 0x2ecc71,
            description: `Record vechi: **${previous.toLocaleString("en-US")}**\nRecord nou: **${current.toLocaleString("en-US")}**\nDiferenta: **+${(current - previous).toLocaleString("en-US")}**\nData: <t:${Math.floor(reachedAt.getTime() / 1000)}:F>`
          }]
        });
      } catch (err: unknown) {
        logger("WARN", "PLAYER_COUNT_MILESTONE", `Notificarea milestone a esuat pentru guild ${guild._id}`, errorMessage(err));
      }
      return null;
    });
  }

  async function persistPoint(game: GameConfig, players: SteamCurrentPlayersLike, client?: NotificationDiscordClient | null): Promise<boolean> {
    const appId = String(game.appId);
    const fetchedAt = new Date();
    await Promise.all([
      PlayerCountSnapshotModel.updateOne(
        { _id: appId },
        { $set: { gameKey: game.key, playerCount: players.playerCount, fetchedAt } },
        { upsert: true }
      ),
      PlayerCountHistoryModel.create({ appId, gameKey: game.key, playerCount: players.playerCount, fetchedAt })
    ]);
    await notifyPlayerCountChanges(client, game, players.playerCount, fetchedAt);
    const previous = await PlayerCountRecordModel.findById(appId).lean();
    const previousCount = validCount(previous?.playerCount);
    if (previousCount !== null && players.playerCount <= previousCount) return false;
    await PlayerCountRecordModel.updateOne(
      { _id: appId },
      { $set: { gameKey: game.key, playerCount: players.playerCount, reachedAt: fetchedAt } },
      { upsert: true }
    );
    if (previousCount !== null) await notifyMilestone(client, game, previousCount, players.playerCount, fetchedAt);
    return previousCount !== null;
  }

  async function refreshPlayerCountSnapshots(
    games: GameConfig[],
    shouldAbort: (() => boolean) | null = null,
    client?: NotificationDiscordClient | null
  ): Promise<PlayerCountRefreshResult> {
    const candidates = (Array.isArray(games) ? games : []).filter(game => Boolean(game.appId));
    let refreshed = 0;
    let failed = 0;
    let milestones = 0;
    if (!candidates.length) return { refreshed, failed, milestones };
    await mapWithConcurrency(candidates, REFRESH_CONCURRENCY, async game => {
      if (shouldAbort?.()) return null;
      const appId = String(game.appId);
      try {
        const players = await fetchSteamCurrentPlayers(appId);
        if (!players.success) {
          failed += 1;
          return null;
        }
        if (await persistPoint(game, players, client)) milestones += 1;
        refreshed += 1;
      } catch (err: unknown) {
        failed += 1;
        logger("WARN", "PLAYER_COUNT_SNAPSHOT", `Snapshot player-count esuat pentru appId ${appId}`, errorMessage(err));
      }
      return null;
    });
    return { refreshed, failed, milestones };
  }

  async function readPlayerCountSnapshots(appIds: readonly (string | number)[]): Promise<Map<string, PlayerCountSnapshot>> {
    const ids = appIds.map(String).filter(Boolean);
    const snapshots = new Map<string, PlayerCountSnapshot>();
    if (!ids.length) return snapshots;
    const docs = await PlayerCountSnapshotModel.find({ _id: { $in: ids } }).lean();
    for (const doc of docs) {
      const fetchedAt = validDate(doc.fetchedAt);
      const playerCount = validCount(doc.playerCount);
      if (!fetchedAt || playerCount === null) continue;
      snapshots.set(String(doc._id), { appId: String(doc._id), gameKey: String(doc.gameKey || ""), playerCount, fetchedAt });
    }
    return snapshots;
  }

  async function readPlayerCountHistory(appIds: readonly (string | number)[], since: Date): Promise<PlayerCountHistoryPoint[]> {
    const ids = appIds.map(String).filter(Boolean);
    if (!ids.length || !Number.isFinite(since.getTime())) return [];
    const docs = await PlayerCountHistoryModel.find({ appId: { $in: ids }, fetchedAt: { $gte: since } }).sort({ fetchedAt: 1 }).lean();
    const points: PlayerCountHistoryPoint[] = [];
    for (const doc of docs) {
      const fetchedAt = validDate(doc.fetchedAt);
      const playerCount = validCount(doc.playerCount);
      const appId = String(doc.appId || "");
      if (!appId || !fetchedAt || playerCount === null) continue;
      points.push({ appId, gameKey: String(doc.gameKey || ""), playerCount, fetchedAt });
    }
    return points;
  }

  async function readPlayerCountRecords(appIds: readonly (string | number)[]): Promise<Map<string, PlayerCountRecord>> {
    const ids = appIds.map(String).filter(Boolean);
    const records = new Map<string, PlayerCountRecord>();
    if (!ids.length) return records;
    const docs = await PlayerCountRecordModel.find({ _id: { $in: ids } }).lean();
    for (const doc of docs) {
      const reachedAt = validDate(doc.reachedAt);
      const playerCount = validCount(doc.playerCount);
      if (!reachedAt || playerCount === null) continue;
      records.set(String(doc._id), { appId: String(doc._id), gameKey: String(doc.gameKey || ""), playerCount, reachedAt });
    }
    return records;
  }

  return { refreshPlayerCountSnapshots, readPlayerCountSnapshots, readPlayerCountHistory, readPlayerCountRecords };
}

type PlayerCountSnapshotContext = PlayerCountSnapshotDeps & Record<string, unknown>;

const attachPlayerCountSnapshots = ((target: PlayerCountSnapshotContext): void => {
  Object.assign(target, createPlayerCountSnapshotService(target));
}) as ((target: PlayerCountSnapshotContext) => void) & {
  createPlayerCountSnapshotService: typeof createPlayerCountSnapshotService;
};

attachPlayerCountSnapshots.createPlayerCountSnapshotService = createPlayerCountSnapshotService;

export default attachPlayerCountSnapshots;

export const PLAYER_COUNT_SNAPSHOT_KEYS = [
  "PlayerCountSnapshotModel",
  "PlayerCountHistoryModel",
  "PlayerCountRecordModel",
  "GuildModel",
  "fetchSteamCurrentPlayers",
  "logger"
] as const;

type PlayerCountSnapshotKeyCheckDeps = Parameters<typeof createPlayerCountSnapshotService>[0];
type PlayerCountSnapshotMissing = MissingDependencyKeys<PlayerCountSnapshotKeyCheckDeps, (typeof PLAYER_COUNT_SNAPSHOT_KEYS)[number] & string>;
type PlayerCountSnapshotExtra = ExtraDependencyKeys<PlayerCountSnapshotKeyCheckDeps, (typeof PLAYER_COUNT_SNAPSHOT_KEYS)[number] & string>;
const playercountsnapshotKeysComplete: ExactDependencyKeys<Exclude<Extract<keyof PlayerCountSnapshotKeyCheckDeps, string>, (typeof PLAYER_COUNT_SNAPSHOT_KEYS)[number] & string>, PlayerCountSnapshotExtra> = true;
