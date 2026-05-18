import fs = require("fs");
import path = require("path");
import type { GameConfig } from "../types";

interface NativeGameCandidate {
  key: string;
  name: string;
  aliases?: string[];
}

interface FuzzyMatchKeys {
  gameKey: string | null;
  suggestionKey: string | null;
}

interface NativeFuzzyModule {
  levenshtein(a: string, b: string): number;
  findGameKeys(text: string, games: NativeGameCandidate[], maxInput: number): unknown;
  find_game_keys?(text: string, games: NativeGameCandidate[], maxInput: number): unknown;
}

let nativeModule: NativeFuzzyModule | null | undefined;

function loadNativeFuzzy(): NativeFuzzyModule | null {
  if (nativeModule !== undefined) return nativeModule;

  const searchDirs = [
    path.resolve(__dirname, "..", "..", "native"),
    path.resolve(__dirname)
  ];

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir)
      .filter(file => file.startsWith("discord_patch_bot_core") && file.endsWith(".node"))
      .sort();
    for (const file of files) {
      try {
        const loaded = require(path.join(dir, file)) as NativeFuzzyModule;
        if (typeof loaded.levenshtein === "function") {
          nativeModule = loaded;
          return nativeModule;
        }
      } catch {
        // Fallback below keeps local development usable if the native addon is absent or stale.
      }
    }
  }

  nativeModule = null;
  return nativeModule;
}

function normalizeCommandText(value: unknown): string {
  return String(value || "").toLowerCase().replace(/[-_]/g, " ").trim();
}

function normalizeNativeResult(result: unknown): FuzzyMatchKeys {
  const value = result && typeof result === "object" ? result as Record<string, unknown> : {};
  const gameKey = typeof value.gameKey === "string"
    ? value.gameKey
    : typeof value.game_key === "string" ? value.game_key : null;
  const suggestionKey = typeof value.suggestionKey === "string"
    ? value.suggestionKey
    : typeof value.suggestion_key === "string" ? value.suggestion_key : null;
  return { gameKey, suggestionKey };
}

function toNativeCandidates(games: GameConfig[]): NativeGameCandidate[] {
  return games.map(game => ({
    key: String(game.key || ""),
    name: String(game.name || ""),
    aliases: Array.isArray(game.aliases) ? game.aliases.map(alias => String(alias)) : []
  }));
}

function levenshteinFallback(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 0; i < a.length; i++) {
    let prevDiag = row[0];
    row[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const prevAbove = row[j + 1];
      const insertion = row[j] + 1;
      const deletion = prevAbove + 1;
      const substitution = prevDiag + (a[i] === b[j] ? 0 : 1);
      row[j + 1] = Math.min(insertion, deletion, substitution);
      prevDiag = prevAbove;
    }
  }
  return row[b.length];
}

function findGameKeysFallback(text: unknown, games: GameConfig[], maxInput: number): FuzzyMatchKeys {
  let search = normalizeCommandText(text);
  if (search.length > maxInput) search = search.substring(0, maxInput);

  if (search.length < 2) {
    const exact = games.find(game => String(game.key).toLowerCase() === search);
    return { gameKey: exact?.key || null, suggestionKey: null };
  }

  const candidates: Array<{ game: GameConfig; dist: number; isStartsWith: boolean; isIncludes: boolean }> = [];
  for (const game of games) {
    const identifiers = [
      normalizeCommandText(game.key),
      normalizeCommandText(game.name),
      ...(Array.isArray(game.aliases) ? game.aliases.map(alias => normalizeCommandText(alias)) : [])
    ];
    if (identifiers.includes(search)) return { gameKey: game.key, suggestionKey: null };

    let bestDistForGame = Infinity;
    let isStartsWith = false;
    let isIncludes = false;
    for (const value of identifiers) {
      if (value.startsWith(search)) isStartsWith = true;
      if (value.includes(search)) isIncludes = true;
      bestDistForGame = Math.min(bestDistForGame, levenshteinFallback(search, value));
    }
    candidates.push({ game, dist: bestDistForGame, isStartsWith, isIncludes });
  }

  candidates.sort((a, b) => {
    if (a.isStartsWith !== b.isStartsWith) return a.isStartsWith ? -1 : 1;
    if (a.dist !== b.dist) return a.dist - b.dist;
    if (a.isIncludes !== b.isIncludes) return a.isIncludes ? -1 : 1;
    return 0;
  });

  const best = candidates[0];
  if (!best) return { gameKey: null, suggestionKey: null };
  const dynamicThreshold = Math.max(1, Math.floor(search.length * 0.3));
  if (best.dist <= 1) return { gameKey: best.game.key, suggestionKey: null };
  if (best.dist <= dynamicThreshold || best.isStartsWith || best.isIncludes) {
    return { gameKey: null, suggestionKey: best.game.key };
  }
  return { gameKey: null, suggestionKey: null };
}

export function isRustFuzzyAvailable(): boolean {
  return loadNativeFuzzy() !== null;
}

export function levenshtein(a: string, b: string): number {
  const native = loadNativeFuzzy();
  if (native) return native.levenshtein(a, b);
  return levenshteinFallback(a, b);
}

export function findGameKeys(text: unknown, games: GameConfig[], maxInput: number): FuzzyMatchKeys {
  const native = loadNativeFuzzy();
  if (native) {
    try {
      const fn = typeof native.findGameKeys === "function" ? native.findGameKeys : native.find_game_keys;
      if (typeof fn === "function") {
        return normalizeNativeResult(fn(String(text || ""), toNativeCandidates(games), maxInput));
      }
    } catch {
      // The TypeScript fallback mirrors the Rust behavior and keeps the bot running.
    }
  }
  return findGameKeysFallback(text, games, maxInput);
}
