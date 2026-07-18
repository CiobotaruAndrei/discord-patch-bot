"use strict";

import { normalizeGameKey } from "../../config/gameCatalog.js";

export function resolveWatchedGames<G extends { key: string }>(
  enabledGames: readonly string[] | null | undefined,
  allGames: readonly G[]
): G[] {
  if (!Array.isArray(enabledGames) || enabledGames.length === 0) return [...allGames];
  const enabled = new Set(enabledGames.map(normalizeGameKey));
  return allGames.filter(game => enabled.has(normalizeGameKey(game.key)));
}

export function watchlistGameFilter(gameKey: string): Record<string, unknown> {
  return { $or: [{ enabledGames: gameKey }, { enabledGames: { $size: 0 } }, { enabledGames: null }] };
}
