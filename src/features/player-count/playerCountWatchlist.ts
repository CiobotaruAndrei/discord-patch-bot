"use strict";

import { catalogFor } from "../../config/gameCatalog.js";

export function resolveWatchedGames<G extends { key: string; name: string }>(
  enabledGames: readonly string[] | null | undefined,
  allGames: readonly G[]
): G[] {
  return [...catalogFor(allGames).enabledSubset(enabledGames)];
}

export function watchlistGameFilter(gameKey: string): Record<string, unknown> {
  return { $or: [{ enabledGames: gameKey }, { enabledGames: { $size: 0 } }, { enabledGames: null }] };
}
