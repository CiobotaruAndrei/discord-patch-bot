"use strict";

import type { GameConfig, GuildSettings } from "../../types.js";

export function normalizeGameAlias(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase("ro-RO").slice(0, 100);
}

export function gameAliasRecord(value: GuildSettings["gameAliases"]): Record<string, string[]> {
  const entries = value instanceof Map ? Array.from(value.entries()) : Object.entries(value || {});
  const record: Record<string, string[]> = {};
  for (const [gameKey, aliases] of entries) {
    const clean = Array.isArray(aliases) ? Array.from(new Set(aliases.map(normalizeGameAlias).filter(Boolean))) : [];
    if (clean.length) record[String(gameKey)] = clean;
  }
  return record;
}

export function mergeGuildGameAliases(games: GameConfig[], settings: GuildSettings | null): GameConfig[] {
  const aliases = gameAliasRecord(settings?.gameAliases);
  return games.map(game => ({
    ...game,
    aliases: Array.from(new Set([...(game.aliases || []), ...(aliases[game.key] || [])]))
  }));
}

export function aliasOwner(alias: string, games: GameConfig[], dynamic: Record<string, string[]>): string | null {
  const normalized = normalizeGameAlias(alias);
  for (const game of games) {
    const candidates = [game.key, game.name, ...(game.aliases || []), ...(dynamic[game.key] || [])].map(normalizeGameAlias);
    if (candidates.includes(normalized)) return game.key;
  }
  return null;
}
