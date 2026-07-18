"use strict";

import type { GuildSettings, FetchResult, PendingUpdate } from "../../types.js";
import { watchlistFilter } from "../guild-config/watchlistResolver.js";

export type { PendingUpdate };

export type UpdateFetchResult = FetchResult;

export interface BuildPendingUpdatesQueueDeps {
  normalizePendingUpdateArray: (arr: unknown) => PendingUpdate[];
  toEntries: (map: Map<string, unknown> | Record<string, unknown> | undefined) => Array<[string, unknown]>;
  PENDING_UPDATE_MAX_AGE_MS: number;
  PENDING_UPDATE_MAX_ATTEMPTS: number;
  PENDING_UPDATES_PER_GAME_LIMIT: number;
}

export interface BuildPendingUpdatesQueueInput {
  guild: GuildSettings;
  latestResults: UpdateFetchResult[];
  now?: number;
}

export interface BuildPendingUpdatesQueueResult {
  pendingByGame: Map<string, PendingUpdate[]>;
  resultByGameKey: Map<string, UpdateFetchResult>;
  enabledSet: Set<string> | null;
}

export function buildPendingUpdatesQueue(
  deps: BuildPendingUpdatesQueueDeps,
  input: BuildPendingUpdatesQueueInput
): BuildPendingUpdatesQueueResult {
  const {
    normalizePendingUpdateArray, toEntries,
    PENDING_UPDATE_MAX_AGE_MS, PENDING_UPDATE_MAX_ATTEMPTS,
    PENDING_UPDATES_PER_GAME_LIMIT
  } = deps;
  const { guild, latestResults } = input;
  const now = input.now ?? Date.now();

  const resultByGameKey = new Map<string, UpdateFetchResult>();
  for (const result of latestResults) {
    if (result?.game?.key) resultByGameKey.set(result.game.key, result);
  }

  const enabledSet = watchlistFilter(guild.enabledGames);
  const hasGameFilter = enabledSet !== null;

  const pendingByGame = new Map<string, PendingUpdate[]>();
  for (const [gameKey, arr] of toEntries(guild.pendingUpdates)) {
    if (hasGameFilter && enabledSet && !enabledSet.has(gameKey)) continue;
    const cleaned = normalizePendingUpdateArray(arr).filter(item => {
      const age = now - new Date(item.createdAt ?? now).getTime();
      return age <= PENDING_UPDATE_MAX_AGE_MS
        && (item.attempts ?? 0) < PENDING_UPDATE_MAX_ATTEMPTS;
    }).slice(-PENDING_UPDATES_PER_GAME_LIMIT);
    if (cleaned.length) pendingByGame.set(gameKey, cleaned);
  }

  for (const result of latestResults) {
    if (!result?.game?.key || !result.latest) continue;
    const gameKey = result.game.key;
    if (hasGameFilter && enabledSet && !enabledSet.has(gameKey)) continue;
    const queue = pendingByGame.get(gameKey) || [];
    if (!queue.some(item => item.id === result.latest!.id)) {
      queue.push({ ...result.latest, createdAt: new Date(now), attempts: 0 });
      pendingByGame.set(gameKey, queue.slice(-PENDING_UPDATES_PER_GAME_LIMIT));
    }
  }

  return { pendingByGame, resultByGameKey, enabledSet };
}
