"use strict";

import type { GuildSettings } from "../../types";

export interface PendingUpdate {
  id: string;
  title?: string;
  link?: string;
  excerpt?: string;
  thumbnail?: unknown;
  image?: unknown;
  timestamp?: string;
  createdAt: Date;
  attempts: number;
}

export interface UpdateFetchResult {
  game: { key: string; name: string } & Record<string, unknown>;
  latest: ({ id: string } & Record<string, unknown>) | null;
}

export interface BuildPendingUpdatesQueueDeps {
  normalizePendingUpdateArray: (arr: unknown) => PendingUpdate[];
  toEntries: <K, V>(map: Map<K, V> | Record<string, V> | undefined) => Array<[K, V]>;
  PENDING_UPDATE_MAX_AGE_MS: number;
  PENDING_UPDATE_MAX_ATTEMPTS: number;
  PENDING_UPDATES_PER_GAME_LIMIT: number;
}

export interface BuildPendingUpdatesQueueInput {
  guild: GuildSettings & Record<string, unknown>;
  latestResults: UpdateFetchResult[];
  now?: number;
}

export interface BuildPendingUpdatesQueueResult {
  pendingByGame: Map<string, PendingUpdate[]>;
  resultByGameKey: Map<string, UpdateFetchResult>;
  enabledSet: Set<string> | null;
}

type UnknownEntrySource = Map<string, unknown> | Record<string, unknown> | undefined;

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

  const enabledGames = Array.isArray(guild.enabledGames) ? guild.enabledGames : [];
  const hasGameFilter = enabledGames.length > 0;
  const enabledSet = hasGameFilter ? new Set(enabledGames as string[]) : null;

  const pendingByGame = new Map<string, PendingUpdate[]>();
  for (const [gameKey, arr] of toEntries<string, unknown>(guild.pendingUpdates as UnknownEntrySource)) {
    if (enabledSet && !enabledSet.has(gameKey)) continue;
    const cleaned = normalizePendingUpdateArray(arr).filter(item => {
      const age = now - new Date(item.createdAt).getTime();
      return age <= PENDING_UPDATE_MAX_AGE_MS
        && item.attempts < PENDING_UPDATE_MAX_ATTEMPTS;
    }).slice(-PENDING_UPDATES_PER_GAME_LIMIT);
    if (cleaned.length) pendingByGame.set(gameKey, cleaned);
  }

  for (const result of latestResults) {
    if (!result?.game?.key || !result.latest) continue;
    const gameKey = result.game.key;
    if (enabledSet && !enabledSet.has(gameKey)) continue;
    const queue = pendingByGame.get(gameKey) || [];
    if (!queue.some(item => item.id === result.latest!.id)) {
      queue.push({ ...result.latest, createdAt: new Date(now), attempts: 0 } as PendingUpdate);
      pendingByGame.set(gameKey, queue.slice(-PENDING_UPDATES_PER_GAME_LIMIT));
    }
  }

  return { pendingByGame, resultByGameKey, enabledSet };
}
