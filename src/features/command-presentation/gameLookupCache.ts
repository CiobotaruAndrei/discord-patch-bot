"use strict";

import type { GameConfig } from "../../types.js";
import { findGameKeys } from "../../native/fuzzy.js";

export type FindGameResult = {
  game: GameConfig | null;
  suggestion: GameConfig | null;
};

export interface GameLookupCacheDeps {
  MAX_FUZZY_SEARCH_INPUT: number;
}

const FIND_GAME_CACHE_MAX = 200;

export function createGameLookupCache({ MAX_FUZZY_SEARCH_INPUT }: GameLookupCacheDeps) {
  const findGameCache = new Map<string, FindGameResult>();
  const findGameCacheGuard: {
    hash: string;
    gamesRef: GameConfig[] | null;
    gamesByKey: Map<string, GameConfig>;
  } = { hash: "", gamesRef: null, gamesByKey: new Map() };

  function refreshGuard(games: GameConfig[]): string {
    if (findGameCacheGuard.gamesRef === games && findGameCacheGuard.hash) {
      return findGameCacheGuard.hash;
    }
    if (findGameCacheGuard.hash) findGameCache.clear();
    const hash = games.map(game => String(game.key)).join("|");
    const byKey = new Map<string, GameConfig>();
    for (const game of games) byKey.set(String(game.key), game);
    findGameCacheGuard.hash = hash;
    findGameCacheGuard.gamesRef = games;
    findGameCacheGuard.gamesByKey = byKey;
    return hash;
  }

  function rememberFindGameResult(cacheKey: string, result: FindGameResult): FindGameResult {
    if (findGameCache.size >= FIND_GAME_CACHE_MAX) {
      const oldest = findGameCache.keys().next().value;
      if (oldest !== undefined) findGameCache.delete(oldest);
    }
    findGameCache.set(cacheKey, result);
    return result;
  }

  function findGameAndSuggestion(text: unknown, games: GameConfig[]): FindGameResult {
    const hash = refreshGuard(games);
    const search = String(text || "").toLowerCase().replace(/[-_]/g, " ").trim().slice(0, MAX_FUZZY_SEARCH_INPUT);
    const cacheKey = `${hash}::${search}`;
    const cached = findGameCache.get(cacheKey);
    if (cached !== undefined) {
      findGameCache.delete(cacheKey);
      findGameCache.set(cacheKey, cached);
      return cached;
    }

    const { gameKey, suggestionKey } = findGameKeys(text, games, MAX_FUZZY_SEARCH_INPUT);
    const lookup = findGameCacheGuard.gamesByKey;
    const result: FindGameResult = {
      game: gameKey ? lookup.get(gameKey) || null : null,
      suggestion: suggestionKey ? lookup.get(suggestionKey) || null : null
    };
    return rememberFindGameResult(cacheKey, result);
  }

  function getFindGameCacheSize(): number {
    return findGameCache.size;
  }

  function clearFindGameCache(): void {
    findGameCache.clear();
    findGameCacheGuard.hash = "";
    findGameCacheGuard.gamesRef = null;
    findGameCacheGuard.gamesByKey = new Map();
  }

  return { findGameAndSuggestion, getFindGameCacheSize, clearFindGameCache };
}
