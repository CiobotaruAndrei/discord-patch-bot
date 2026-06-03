import crypto = require("crypto");
import fs = require("fs");
import path = require("path");
import type { DealInfo, GameConfig, GuildSettings } from "../types";

export const HASH_VERSION = 2;

interface NativeGameCandidate {
  key: string;
  name: string;
  aliases?: string[];
}

interface NativeAutocompleteChoice {
  name: string;
  value: string;
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
  dealPassesFilters?(salePriceNum: number, savingsNum: number, store: string, minDiscountPercent: number, includeFreeGames: boolean, includePaidDiscounts: boolean, maxAbsolutePrice: number, enabledStores: string[]): boolean;
  deal_passes_filters?(salePriceNum: number, savingsNum: number, store: string, minDiscountPercent: number, includeFreeGames: boolean, includePaidDiscounts: boolean, maxAbsolutePrice: number, enabledStores: string[]): boolean;
  dealHash?(store: string, steamAppId: string, id: string, title: string, salePrice: string, normalPrice: string, savings: string): string;
  deal_hash?(store: string, steamAppId: string, id: string, title: string, salePrice: string, normalPrice: string, savings: string): string;
  cleanText?(text: string): string;
  clean_text?(text: string): string;
  classifyPatchNote?(title: string, contents: string, tags: string[]): boolean;
  classify_patch_note?(title: string, contents: string, tags: string[]): boolean;
  scoreListingCandidate?(href: string, text: string, keywords: string[]): number;
  score_listing_candidate?(href: string, text: string, keywords: string[]): number;
  buildAutocompleteChoices?(games: NativeGameCandidate[], input: string, useNameAsValue: boolean, minRelevantScore: number, maxChoices: number, maxNameLen: number, maxValueLen: number): NativeAutocompleteChoice[];
  build_autocomplete_choices?(games: NativeGameCandidate[], input: string, useNameAsValue: boolean, minRelevantScore: number, maxChoices: number, maxNameLen: number, maxValueLen: number): NativeAutocompleteChoice[];
  isGoodSteamArticleUrl?(url: string): boolean;
  is_good_steam_article_url?(url: string): boolean;
  extractDateScore?(url: string): number;
  extract_date_score?(url: string): number;
}

let nativeModule: NativeFuzzyModule | null | undefined;
const NATIVE_FUZZY_LOAD_FAILURES: Array<{ file: string; error: string }> = [];

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
        NATIVE_FUZZY_LOAD_FAILURES.push({
          file: path.join(dir, file),
          error: "addon loaded but does not expose `levenshtein` (probably stale build)"
        });
      } catch (err) {
        NATIVE_FUZZY_LOAD_FAILURES.push({
          file: path.join(dir, file),
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
  }

  const failureDetail = NATIVE_FUZZY_LOAD_FAILURES.length
    ? JSON.stringify(NATIVE_FUZZY_LOAD_FAILURES)
    : `addon negasit in: ${searchDirs.join(", ")}`;

  if (!nativeFallbackAllowed()) {
    throw new Error(
      `[NATIVE_FUZZY] Addon-ul Rust este obligatoriu in productie dar nu a putut fi incarcat (${failureDetail}). `
      + "Fallback-ul TypeScript poate produce hash-uri divergente (dealHash / stableUpdateId) fata de o instanta Rust anterioara, "
      + "deci spam masiv de notificari `seen`. Re-build cu `npm run build:rust`, sau seteaza ALLOW_NATIVE_FALLBACK=true ca sa permiti explicit fallback-ul."
    );
  }

  nativeModule = null;
  if (NATIVE_FUZZY_LOAD_FAILURES.length) {
    console.error(
      "[NATIVE_FUZZY] Rust addon nu a putut fi incarcat — folosesc fallback TypeScript.",
      "Risc: hash-urile dealHash / stableUpdateId pot diverge fata de cele stocate de o instanta Rust anterioara,",
      "ceea ce poate cauza mass-spam de notificari `seen` la prima cerere cron.",
      "Detalii:",
      NATIVE_FUZZY_LOAD_FAILURES
    );
  } else {
    console.error(
      "[NATIVE_FUZZY] Rust addon `discord_patch_bot_core*.node` nu a fost gasit in search dirs.",
      searchDirs,
      "Folosesc fallback TypeScript. Re-build cu `npm run build:rust` daca esti in productie."
    );
  }
  return nativeModule;
}

export function nativeFallbackAllowed(
  nodeEnv: string | undefined = process.env.NODE_ENV,
  allowFlag: string | undefined = process.env.ALLOW_NATIVE_FALLBACK
): boolean {
  return nodeEnv !== "production" || allowFlag === "true";
}

export function ensureNativeFuzzy(): boolean {
  return loadNativeFuzzy() !== null;
}

const nativeFallbackTotals = new Map<string, number>();
const nativeFallbackLastLogged = new Map<string, number>();
const NATIVE_FALLBACK_LOG_THROTTLE_MS = 60_000;

export const NATIVE_FALLBACK_FUNCTIONS = [
  "classifyPatchNote",
  "scoreListingCandidate",
  "buildAutocompleteChoices",
  "isGoodSteamArticleUrl",
  "extractDateScore",
  "dealPassesFilters",
  "findGameKeys"
];

export function recordNativeFallback(fnName: string, err: unknown): void {
  const total = (nativeFallbackTotals.get(fnName) || 0) + 1;
  nativeFallbackTotals.set(fnName, total);
  const now = Date.now();
  const last = nativeFallbackLastLogged.get(fnName) || 0;
  if (now - last >= NATIVE_FALLBACK_LOG_THROTTLE_MS) {
    nativeFallbackLastLogged.set(fnName, now);
    console.warn(
      `[NATIVE_FUZZY] Apelul nativ \`${fnName}\` a esuat — folosesc fallback TypeScript (total ${total}). `
      + "Risc de divergenta de rezultat/performanta fata de Rust; verifica build-ul nativ.",
      err instanceof Error ? err.message : String(err)
    );
  }
}

export function getNativeFallbackTotals(): Record<string, number> {
  return Object.fromEntries(nativeFallbackTotals);
}

export function getNativeFallbackTotal(): number {
  let sum = 0;
  for (const value of nativeFallbackTotals.values()) sum += value;
  return sum;
}

export function resetNativeFallbackTotals(): void {
  nativeFallbackTotals.clear();
  nativeFallbackLastLogged.clear();
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

export function levenshteinFallback(a: string, b: string): number {
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

const PATCH_NOTE_BAD_IN_TITLE = ["community", "sale", "store", "merch", "tournament", "esports", "giveaway", "teaser", "trailer", "preview", "announce", "announcement"];
const PATCH_NOTE_GOOD_WORDS = ["update", "patch", "hotfix", "version", "release", "bugfix", "bug fix", "fixes", "fix", "notes", "patch notes", "changelog", "maintenance", "build", "client update", "title update", "release notes", "season", "chapter", "rework", "balance", "content update", "launch"];

function classifyPatchNoteFallback(title: unknown, contents: unknown, tags: unknown): boolean {
  const titleLc = String(title || "").toLowerCase();
  if (PATCH_NOTE_BAD_IN_TITLE.some(w => titleLc.includes(w))) return false;
  const tagList = Array.isArray(tags) ? tags.map(t => String(t).toLowerCase()) : [];
  if (tagList.includes("patchnotes") || tagList.includes("update")) return true;
  const contentsLc = String(contents || "").toLowerCase();
  return PATCH_NOTE_GOOD_WORDS.some(w => titleLc.includes(w) || contentsLc.includes(w));
}

function scoreListingCandidateFallback(href: unknown, text: unknown, keywords: unknown): number {
  if (!Array.isArray(keywords) || keywords.length === 0) return 0;
  const haystack = `${String(href || "")} ${String(text || "")}`.toLowerCase();
  let score = 0;
  for (const k of keywords) {
    const kw = String(k || "").toLowerCase();
    if (kw && haystack.includes(kw)) score++;
  }
  return score;
}

function scoreAutocompleteGameFallback(game: GameConfig, input: string): number {
  const haystack = [
    String(game.name || "").toLowerCase(),
    String(game.key || "").toLowerCase(),
    ...(Array.isArray(game.aliases) ? game.aliases.map(alias => String(alias).toLowerCase()) : [])
  ];
  let score = -1;
  for (const value of haystack) {
    if (!input) { score = Math.max(score, 0); continue; }
    if (value === input) score = Math.max(score, 100);
    else if (value.startsWith(input)) score = Math.max(score, 50);
    else if (value.includes(input)) score = Math.max(score, 20);
  }
  return score;
}

export function buildAutocompleteChoicesFallback(
  games: GameConfig[],
  input: string,
  useNameAsValue: boolean,
  minRelevantScore: number,
  maxChoices: number,
  maxNameLen: number,
  maxValueLen: number
): NativeAutocompleteChoice[] {
  const normalizedInput = String(input || "").toLowerCase().trim();
  const candidates: Array<{ game: GameConfig; score: number }> = [];
  for (const game of games) {
    const score = scoreAutocompleteGameFallback(game, normalizedInput);
    if (normalizedInput && score < minRelevantScore) continue;
    candidates.push({ game, score });
  }
  candidates.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;

    const na = String(a.game.name || "");
    const nb = String(b.game.name || "");
    return na < nb ? -1 : na > nb ? 1 : 0;
  });
  return candidates.slice(0, maxChoices).map(candidate => ({
    name: `${candidate.game.name} (${candidate.game.key})`.substring(0, maxNameLen),
    value: String(useNameAsValue ? candidate.game.name : candidate.game.key).substring(0, maxValueLen)
  }));
}

function isGoodSteamArticleUrlFallback(url: unknown): boolean {
  const v = String(url || "").trim().toLowerCase();
  if (!v) return false;
  if (!v.startsWith("http")) return false;
  if (v.includes("steamstatic")) return false;
  if (v.includes("steamcdn")) return false;
  return true;
}

function extractDateScoreFallback(url: unknown): number {
  const u = String(url || "").toLowerCase();
  const dateAt = /(\d{4})[-/](\d{2})[-/](\d{2})/y;
  for (let start = 0; start + 10 <= u.length; start++) {
    dateAt.lastIndex = start;
    const m = dateAt.exec(u);
    if (!m) continue;
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);
    if (!(year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31)) continue;
    const t = Date.UTC(year, month - 1, day);
    if (Number.isNaN(t)) continue;
    const d = new Date(t);
    if (d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day) return t;
  }
  return 0;
}

const CLEAN_TEXT_REGEX = /<[^>]+>|&(nbsp|amp|quot|#39|apos|lt|gt);|\s+/gi;
const CLEAN_TEXT_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", quot: '"', "#39": "'", apos: "'", lt: "<", gt: ">"
};

function cleanTextFallback(value: unknown): string {
  const str = String(value || "");
  if (!str) return "";
  const replaced = str.replace(CLEAN_TEXT_REGEX, (match, entity: string | undefined) => {
    if (entity) {
      const repl = CLEAN_TEXT_ENTITIES[entity.toLowerCase()];
      return repl !== undefined ? repl : match;
    }
    return " ";
  });
  return replaced.replace(/\s+/g, " ").trim();
}

function stableUpdateIdFallback(title: unknown, link: unknown): string {
  const base = `${String(title || "")}|${String(link || "")}`;
  return crypto.createHash("sha256").update(base).digest("hex").substring(0, 16);
}

function normalizeDealStateFallback(deal: DealInfo): string {
  return [
    deal.salePrice ?? "",
    deal.normalPrice ?? "",
    deal.savings ?? ""
  ].map(value => String(value).trim().toLowerCase()).join(":");
}

export function dealPassesFiltersFallback(deal: DealInfo, guild: GuildSettings | null | undefined): boolean {
  const minDisc = guild?.minDiscountPercent ?? 0;
  const incFree = guild?.includeFreeGames !== false;
  const incPaid = guild?.includePaidDiscounts !== false;
  const maxPrice = Number(guild?.maxAbsolutePrice) || 0;
  const enabledStores = Array.isArray(guild?.enabledStores) ? guild.enabledStores : [];

  const salePriceNum = parseFloat(String(deal.salePrice));
  const isFree = salePriceNum === 0;
  const savingsNum = Number(deal.savings);

  if (isFree && !incFree) return false;
  if (!isFree && !incPaid) return false;
  if (!isFree && (!Number.isFinite(savingsNum) || savingsNum < minDisc)) return false;
  if (!isFree && maxPrice > 0 && Number.isFinite(salePriceNum) && salePriceNum > maxPrice) return false;
  if (enabledStores.length > 0 && !enabledStores.includes(String(deal.store))) return false;
  return true;
}

export function dealHashFallback(deal: DealInfo): string {
  let stableKey;
  if (deal.store === "Steam" && deal.steamAppID) {
    stableKey = `steam:${deal.steamAppID}:${normalizeDealStateFallback(deal)}`;
  } else if (deal.store === "Epic Games" && deal.id) {
    const rawId = String(deal.id).replace(/^epic_/, "");
    stableKey = `epic:${rawId}:${normalizeDealStateFallback(deal)}`;
  } else {
    stableKey = `${deal.store}:${normalizeTitleForDedupeFallback(deal.title)}:${normalizeDealStateFallback(deal)}`;
  }
  return crypto.createHash("sha256").update(stableKey).digest("hex");
}

export function findGameKeysFallback(text: unknown, games: GameConfig[], maxInput: number): FuzzyMatchKeys {
  let search = normalizeCommandText(text);

  const searchChars = Array.from(search);
  if (searchChars.length > maxInput) {
    search = searchChars.slice(0, maxInput).join("");
  }
  const searchLen = Array.from(search).length;

  if (searchLen < 2) {
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

  const dynamicThreshold = Math.max(1, Math.floor(searchLen * 0.3));
  if (best.dist <= 1) return { gameKey: best.game.key, suggestionKey: null };
  if (best.dist <= dynamicThreshold || best.isStartsWith || best.isIncludes) {
    return { gameKey: null, suggestionKey: best.game.key };
  }
  return { gameKey: null, suggestionKey: null };
}

export function isRustFuzzyAvailable(): boolean {
  return loadNativeFuzzy() !== null;
}

export function getNativeFuzzy(): NativeFuzzyModule | null {
  return loadNativeFuzzy();
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

export function cleanText(value: unknown): string {
  const fn = nativeStringFn("cleanText", "clean_text");
  return fn ? fn(String(value || "")) : cleanTextFallback(value);
}

export function classifyPatchNote(title: unknown, contents: unknown, tags: unknown): boolean {
  const native = loadNativeFuzzy();
  if (native) {
    const fn = typeof native.classifyPatchNote === "function" ? native.classifyPatchNote : native.classify_patch_note;
    if (typeof fn === "function") {
      const tagsList = Array.isArray(tags) ? tags.map(t => String(t)) : [];
      try { return fn.call(native, String(title || ""), String(contents || ""), tagsList); }
      catch (err) { recordNativeFallback("classifyPatchNote", err); }
    }
  }
  return classifyPatchNoteFallback(title, contents, tags);
}

export function scoreListingCandidate(href: unknown, text: unknown, keywords: unknown): number {
  const native = loadNativeFuzzy();
  if (native) {
    const fn = typeof native.scoreListingCandidate === "function" ? native.scoreListingCandidate : native.score_listing_candidate;
    if (typeof fn === "function") {
      const kw = Array.isArray(keywords) ? keywords.map(k => String(k)) : [];
      try { return fn.call(native, String(href || ""), String(text || ""), kw); }
      catch (err) { recordNativeFallback("scoreListingCandidate", err); }
    }
  }
  return scoreListingCandidateFallback(href, text, keywords);
}

export function buildAutocompleteChoices(
  games: GameConfig[],
  input: string,
  useNameAsValue: boolean,
  minRelevantScore: number,
  maxChoices: number,
  maxNameLen: number,
  maxValueLen: number
): NativeAutocompleteChoice[] {
  const native = loadNativeFuzzy();
  if (native) {
    const fn = typeof native.buildAutocompleteChoices === "function"
      ? native.buildAutocompleteChoices
      : native.build_autocomplete_choices;
    if (typeof fn === "function") {
      try {
        const choices = fn.call(
          native,
          toNativeCandidates(games),
          String(input || ""),
          Boolean(useNameAsValue),
          minRelevantScore,
          maxChoices,
          maxNameLen,
          maxValueLen
        );
        if (Array.isArray(choices)) {
          return choices.map(choice => ({
            name: String(choice?.name || "").substring(0, maxNameLen),
            value: String(choice?.value || "").substring(0, maxValueLen)
          }));
        }
      } catch (err) {
        recordNativeFallback("buildAutocompleteChoices", err);
      }
    }
  }
  return buildAutocompleteChoicesFallback(games, input, useNameAsValue, minRelevantScore, maxChoices, maxNameLen, maxValueLen);
}

export function isGoodSteamArticleUrl(url: unknown): boolean {
  const native = loadNativeFuzzy();
  if (native) {
    const fn = typeof native.isGoodSteamArticleUrl === "function" ? native.isGoodSteamArticleUrl : native.is_good_steam_article_url;
    if (typeof fn === "function") {
      try { return fn.call(native, String(url || "")); }
      catch (err) { recordNativeFallback("isGoodSteamArticleUrl", err); }
    }
  }
  return isGoodSteamArticleUrlFallback(url);
}

export function extractDateScore(url: unknown): number {
  const native = loadNativeFuzzy();
  if (native) {
    const fn = typeof native.extractDateScore === "function" ? native.extractDateScore : native.extract_date_score;
    if (typeof fn === "function") {
      try { return fn.call(native, String(url || "")); }
      catch (err) { recordNativeFallback("extractDateScore", err); }
    }
  }
  return extractDateScoreFallback(url);
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

export function dealPassesFilters(deal: DealInfo, guild: GuildSettings | null | undefined): boolean {
  const minDisc = guild?.minDiscountPercent ?? 0;
  const incFree = guild?.includeFreeGames !== false;
  const incPaid = guild?.includePaidDiscounts !== false;
  const maxPrice = Number(guild?.maxAbsolutePrice) || 0;
  const enabledStores = Array.isArray(guild?.enabledStores) ? guild.enabledStores.map(String) : [];
  const native = loadNativeFuzzy();
  if (native) {
    const fn = typeof native.dealPassesFilters === "function" ? native.dealPassesFilters : native.deal_passes_filters;
    if (typeof fn === "function") {
      try {
        return fn.call(
          native,
          parseFloat(String(deal.salePrice)),
          Number(deal.savings),
          String(deal.store),
          minDisc,
          incFree,
          incPaid,
          maxPrice,
          enabledStores
        );
      } catch (err) {
        recordNativeFallback("dealPassesFilters", err);
      }
    }
  }
  return dealPassesFiltersFallback(deal, guild);
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
    } catch (err) {
      recordNativeFallback("findGameKeys", err);
    }
  }
  return findGameKeysFallback(text, games, maxInput);
}
