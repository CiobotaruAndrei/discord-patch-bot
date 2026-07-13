"use strict";

import type { GameConfig } from "../../types";

import { errorMessage } from "../../shared/errors";
import ________shared_utilities from "../../shared/utilities";
const { mapWithConcurrency } = ________shared_utilities;

interface PlayerCountSnapshot {
  appId: string;
  gameKey: string;
  playerCount: number;
  fetchedAt: Date;
}

interface PlayerCountSnapshotLeanDoc {
  _id: string;
  gameKey?: string;
  playerCount?: number;
  fetchedAt?: Date | string;
}

interface PlayerCountSnapshotModelLike {
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  find(filter: Record<string, unknown>): { lean(): Promise<PlayerCountSnapshotLeanDoc[]> };
}

interface SteamCurrentPlayersLike {
  appId: string;
  playerCount: number;
  success: boolean;
}

interface PlayerCountSnapshotDeps {
  PlayerCountSnapshotModel: PlayerCountSnapshotModelLike;
  fetchSteamCurrentPlayers(appId: string | number): Promise<SteamCurrentPlayersLike>;
  logger(level: string, context: string, message: string, meta?: unknown): void;
}

interface PlayerCountRefreshResult {
  refreshed: number;
  failed: number;
}

const REFRESH_CONCURRENCY = 5;

function createPlayerCountSnapshotService(deps: PlayerCountSnapshotDeps) {
  const { PlayerCountSnapshotModel, fetchSteamCurrentPlayers, logger } = deps;

  async function refreshPlayerCountSnapshots(games: GameConfig[], shouldAbort: (() => boolean) | null = null): Promise<PlayerCountRefreshResult> {
    const candidates = (Array.isArray(games) ? games : []).filter(game => Boolean(game.appId));
    let refreshed = 0;
    let failed = 0;
    if (!candidates.length) return { refreshed, failed };
    await mapWithConcurrency(candidates, REFRESH_CONCURRENCY, async game => {
      if (shouldAbort && shouldAbort()) return null;
      const appId = String(game.appId);
      try {
        const players = await fetchSteamCurrentPlayers(appId);
        if (!players.success) {
          failed += 1;
          return null;
        }
        await PlayerCountSnapshotModel.updateOne(
          { _id: appId },
          { $set: { gameKey: String(game.key || ""), playerCount: players.playerCount, fetchedAt: new Date() } },
          { upsert: true }
        );
        refreshed += 1;
      } catch (err: unknown) {
        failed += 1;
        logger("WARN", "PLAYER_COUNT_SNAPSHOT", `Snapshot player-count esuat pentru appId ${appId}`, errorMessage(err));
      }
      return null;
    });
    return { refreshed, failed };
  }

  async function readPlayerCountSnapshots(appIds: readonly (string | number)[]): Promise<Map<string, PlayerCountSnapshot>> {
    const ids = appIds.map(String).filter(Boolean);
    const snapshots = new Map<string, PlayerCountSnapshot>();
    if (!ids.length) return snapshots;
    const docs = await PlayerCountSnapshotModel.find({ _id: { $in: ids } }).lean();
    for (const doc of docs) {
      const fetchedAt = doc.fetchedAt ? new Date(doc.fetchedAt) : null;
      if (!fetchedAt || Number.isNaN(fetchedAt.getTime())) continue;
      const playerCount = Number(doc.playerCount);
      if (!Number.isFinite(playerCount) || playerCount < 0) continue;
      snapshots.set(String(doc._id), {
        appId: String(doc._id),
        gameKey: String(doc.gameKey || ""),
        playerCount: Math.floor(playerCount),
        fetchedAt
      });
    }
    return snapshots;
  }

  return { refreshPlayerCountSnapshots, readPlayerCountSnapshots };
}

type PlayerCountSnapshotContext = PlayerCountSnapshotDeps & Record<string, unknown>;

const attachPlayerCountSnapshots = ((target: PlayerCountSnapshotContext): void => {
  Object.assign(target, createPlayerCountSnapshotService(target));
}) as ((target: PlayerCountSnapshotContext) => void) & {
  createPlayerCountSnapshotService: typeof createPlayerCountSnapshotService;
};

attachPlayerCountSnapshots.createPlayerCountSnapshotService = createPlayerCountSnapshotService;

export default attachPlayerCountSnapshots;
