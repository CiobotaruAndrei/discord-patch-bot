import type { GameConfig } from "./configTypes.js";

export function normalizeGameKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function findGameByKey(games: GameConfig[], key: string | null | undefined): GameConfig | null {
  if (!key) return null;
  return games.find(game => game.key === key) || null;
}

export function findGameByKeyOrAlias(games: GameConfig[], value: string | null | undefined): GameConfig | null {
  const input = normalizeGameKey(String(value || ""));
  if (!input) return null;
  return games.find(game =>
    normalizeGameKey(game.key) === input
    || normalizeGameKey(game.name) === input
    || (Array.isArray(game.aliases) && game.aliases.some(alias => normalizeGameKey(String(alias)) === input))
  ) || null;
}
