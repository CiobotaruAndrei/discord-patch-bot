"use strict";

export type { PlayerCountSnapshot, PlayerCountHistoryPoint, PlayerCountRecord } from "./playerCountTypes.js";

import type { GameConfig } from "../../config/configTypes.js";
import type { NotificationDiscordClient } from "../notifications/outboundChannel.js";
import { errorMessage } from "../../shared/errors.js";
import ________shared_utilities from "../../shared/utilities.js";
import { evaluatePlayerCountChange, type PlayerCountChange } from "./playerCountChangeSignal.js";
import { createPlayerCountNotifier } from "./playerCountNotifier.js";
import { createPlayerCountQueryService } from "./playerCountQueryService.js";
import { validCount, validDate } from "./playerCountTypes.js";
import type {
  GuildModelLike,
  MilestoneGuildDoc,
  PlayerCountHistoryModelLike,
  PlayerCountHistoryPoint,
  PlayerCountLogger,
  PlayerCountRecord,
  PlayerCountRecordModelLike,
  PlayerCountSnapshot,
  PlayerCountSnapshotModelLike,
  SteamCurrentPlayersLike
} from "./playerCountTypes.js";
import { watchlistGameFilter } from "./playerCountWatchlist.js";
import { updatedDocument } from "../../shared/persistenceOutcome.js";
import type { MissingDependencyKeys, ExtraDependencyKeys, ExactDependencyKeys } from "../../shared/dependencyKeyContract.js";
import { createPlayerCountWatchRepository } from "./playerCountWatchRepository.js";
import type { PlayerCountWatchModelLike, PlayerCountWatchRecord } from "./playerCountWatchRepository.js";
const { mapWithConcurrency } = ________shared_utilities;

interface PlayerCountSnapshotDeps {
  PlayerCountSnapshotModel: PlayerCountSnapshotModelLike;
  PlayerCountWatchModel: PlayerCountWatchModelLike;
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




function createPlayerCountSnapshotService(deps: PlayerCountSnapshotDeps) {
  const {
    PlayerCountSnapshotModel,
    fetchSteamCurrentPlayers,
    logger
  } = deps;
  const watchRepository = createPlayerCountWatchRepository(deps.PlayerCountWatchModel);
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
    fetchedAt: Date,
    watched: PlayerCountWatchRecord | undefined
  ): Promise<PlayerCountChange | null> {
    const appId = String(game.appId);
    if (!watched) {
      await watchRepository.startWatching({ guildId: guild._id, gameKey: game.key, appId, playerCount, fetchedAt });
      return null;
    }
    const previousAt = validDate(watched.fetchedAt);
    const previousCount = validCount(watched.playerCount);
    if (!previousAt || previousCount === null) return null;
    const change = evaluatePlayerCountChange(previousCount, playerCount);
    const lastNotifiedAt = validDate(watched.lastNotifiedAt ?? undefined);
    const cooldownActive = change.direction === watched.lastDirection
      && Boolean(lastNotifiedAt && fetchedAt.getTime() - lastNotifiedAt.getTime() < CHANGE_COOLDOWN_MS);
    const notify = change.significant && change.direction !== "flat" && !cooldownActive;
    const claimed = await watchRepository.claimObservation(
      guild._id,
      game.key,
      { playerCount: previousCount, fetchedAt: previousAt },
      { playerCount, fetchedAt, appId, notifiedDirection: notify && change.direction !== "flat" ? change.direction : null }
    );
    return notify && claimed ? change : null;
  }

  const notifier = createPlayerCountNotifier({
    GuildModel,
    logger,
    concurrency: REFRESH_CONCURRENCY,
    listWatched: (guildIds, gameKey) => watchRepository.listForGuilds(guildIds, gameKey),
    claimChange: claimPlayerCountChange
  });
  const { notifyPlayerCountChanges, notifyMilestone } = notifier;

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

  const queries = createPlayerCountQueryService({
    PlayerCountSnapshotModel,
    PlayerCountHistoryModel,
    PlayerCountRecordModel
  });
  const { readPlayerCountSnapshots, readPlayerCountHistory, readPlayerCountRecords } = queries;

  return { refreshPlayerCountSnapshots, readPlayerCountSnapshots, readPlayerCountHistory, readPlayerCountRecords };
}

const playerCountSnapshotModule = { createPlayerCountSnapshotService };

export default playerCountSnapshotModule;

export const PLAYER_COUNT_SNAPSHOT_KEYS = [
  "PlayerCountSnapshotModel",
  "PlayerCountWatchModel",
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
