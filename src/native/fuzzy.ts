import crypto = require("crypto");
import fs = require("fs");
import path = require("path");
import type { DealInfo, GameConfig } from "../types";

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
  normalizeTitleForDedupe?(value: string): string;
  normalize_title_for_dedupe?(value: string): string;
  stableUpdateId?(title: string, link: string): string;
  stable_update_id?(title: string, link: string): string;
  normalizeDealState?(salePrice: string, normalPrice: string, savings: string): string;
  normalize_deal_state?(salePrice: string, normalPrice: string, savings: string): string;
  dealHash?(store: string, steamAppId: string, id: string, title: string, salePrice: string, normalPrice: string, savings: string): string;
  deal_hash?(store: string, steamAppId: string, id: string, title: string, salePrice: string, normalPrice: string, savings: string): string;
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

function nativeStringFn(name: keyof NativeFuzzyModule, snakeName: keyof NativeFuzzyModule): ((...args: string[]) => string) | null {
  const native = loadNativeFuzzy();
  if (!native) return null;
  const fn = typeof native[name] === "function" ? native[name] : native[snakeName];
  return typeof fn === "function" ? fn.bind(native) as (...args: string[]) => string : null;
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

function normalizeTitleForDedupeFallback(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[\u00ae\u00a9\u2122]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stableUpdateIdFallback(title: unknown, link: unknown): string {
  const base = `${String(title || "")}|${String(link || "")}`;
  return crypto.createHash("sha1").update(base).digest("hex").substring(0, 16);
}

function normalizeDealStateFallback(deal: DealInfo): string {
  return [
    deal.salePrice ?? "",
    deal.normalPrice ?? "",
    deal.savings ?? ""
  ].map(value => String(value).trim().toLowerCase()).join(":");
}

function dealHashFallback(deal: DealInfo): string {
  let stableKey;
  if (deal.store === "Steam" && deal.steamAppID) {
    stableKey = `steam:${deal.steamAppID}:${normalizeDealStateFallback(deal)}`;
  } else if (deal.store === "Epic Games" && deal.id) {
    const rawId = String(deal.id).replace(/^epic_/, "");
    stableKey = `epic:${rawId}:${normalizeDealStateFallback(deal)}`;
  } else {
    stableKey = `${deal.store}:${normalizeTitleForDedupeFallback(deal.title)}:${normalizeDealStateFallback(deal)}`;
  }
  return crypto.createHash("sha1").update(stableKey).digest("hex");
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

export function normalizeTitleForDedupe(value: unknown): string {
  const fn = nativeStringFn("normalizeTitleForDedupe", "normalize_title_for_dedupe");
  return fn ? fn(String(value || "")) : normalizeTitleForDedupeFallback(value);
}

export function stableUpdateId(title: unknown, link: unknown): string {
  const fn = nativeStringFn("stableUpdateId", "stable_update_id");
  return fn ? fn(String(title || ""), String(link || "")) : stableUpdateIdFallback(title, link);
}

export function normalizeDealState(deal: DealInfo): string {
  const salePrice = String(deal.salePrice ?? "");
  const normalPrice = String(deal.normalPrice ?? "");
  const savings = String(deal.savings ?? "");
  const fn = nativeStringFn("normalizeDealState", "normalize_deal_state");
  return fn ? fn(salePrice, normalPrice, savings) : normalizeDealStateFallback(deal);
}

export function dealHash(deal: DealInfo): string {
  const store = String(deal.store);
  const steamAppId = deal.steamAppID ? String(deal.steamAppID) : "";
  const id = String(deal.id || "");
  const title = String(deal.title || "");
  const salePrice = String(deal.salePrice ?? "");
  const normalPrice = String(deal.normalPrice ?? "");
  const savings = String(deal.savings ?? "");
  const fn = nativeStringFn("dealHash", "deal_hash");
  return fn ? fn(store, steamAppId, id, title, salePrice, normalPrice, savings) : dealHashFallback(deal);
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
