"use strict";

import type { GameConfig } from "../../types.js";

export function isImplicitWatchlist(enabledGames?: readonly string[] | null): boolean {
  return !Array.isArray(enabledGames) || enabledGames.length === 0;
}

export function resolveWatchlistKeys(allGames: readonly GameConfig[], enabledGames?: readonly string[] | null): string[] {
  if (isImplicitWatchlist(enabledGames)) return allGames.map(game => game.key);
  const configured = new Set(enabledGames!.map(String));
  return allGames.filter(game => configured.has(game.key)).map(game => game.key);
}

export function resolveWatchlistGames(allGames: readonly GameConfig[], enabledGames?: readonly string[] | null): GameConfig[] {
  const keys = new Set(resolveWatchlistKeys(allGames, enabledGames));
  return allGames.filter(game => keys.has(game.key));
}

export function watchlistFilter(enabledGames?: readonly string[] | null): Set<string> | null {
  return isImplicitWatchlist(enabledGames) ? null : new Set(enabledGames!.map(String));
}

export default { isImplicitWatchlist, resolveWatchlistKeys, resolveWatchlistGames, watchlistFilter };
