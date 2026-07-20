import crypto from "crypto";
import type { DealInfo, GameConfig, GuildSettings } from "../types.js";
import type { NativeAutocompleteChoice } from "./fuzzyNativeBridge.js";

export const HASH_VERSION = 2;

export interface FuzzyMatchKeys {
  gameKey: string | null;
  suggestionKey: string | null;
}

export function normalizeCommandText(value: unknown): string {
  return String(value || "").toLowerCase().replace(/[-_]/g, " ").trim();
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

export function normalizeTitleForDedupeFallback(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[®©™]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const PATCH_NOTE_BAD_IN_TITLE = ["community", "sale", "store", "merch", "tournament", "esports", "giveaway", "teaser", "trailer", "preview", "announce", "announcement"];
const PATCH_NOTE_GOOD_WORDS = ["update", "patch", "hotfix", "version", "release", "bugfix", "bug fix", "fixes", "fix", "notes", "patch notes", "changelog", "maintenance", "build", "client update", "title update", "release notes", "season", "chapter", "rework", "balance", "content update", "launch"];

export function classifyPatchNoteFallback(title: unknown, contents: unknown, tags: unknown): boolean {
  const titleLc = String(title || "").toLowerCase();
  if (PATCH_NOTE_BAD_IN_TITLE.some(w => titleLc.includes(w))) return false;
  const tagList = Array.isArray(tags) ? tags.map(t => String(t).toLowerCase()) : [];
  if (tagList.includes("patchnotes") || tagList.includes("update")) return true;
  const contentsLc = String(contents || "").toLowerCase();
  return PATCH_NOTE_GOOD_WORDS.some(w => titleLc.includes(w) || contentsLc.includes(w));
}

export function scoreListingCandidateFallback(href: unknown, text: unknown, keywords: unknown): number {
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

export function isGoodSteamArticleUrlFallback(url: unknown): boolean {
  const v = String(url || "").trim().toLowerCase();
  if (!v) return false;
  if (!v.startsWith("http")) return false;
  if (v.includes("steamstatic")) return false;
  if (v.includes("steamcdn")) return false;
  return true;
}

export function extractDateScoreFallback(url: unknown): number {
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

export function cleanTextFallback(value: unknown): string {
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

export function stableUpdateIdFallback(title: unknown, link: unknown): string {
  const base = `${String(title || "")}|${String(link || "")}`;
  return crypto.createHash("sha256").update(base).digest("hex").substring(0, 16);
}

export function normalizeDealStateFallback(deal: DealInfo): string {
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

export interface RankableListingCandidate {
  href: string;
  text: string;
  position: number;
}

export function rankListingCandidatesFallback<T extends RankableListingCandidate>(candidates: T[], keywords: string[]): T[] {
  const hasKeywords = Array.isArray(keywords) && keywords.length > 0;
  const scored = candidates.map(candidate => ({
    candidate,
    score: hasKeywords ? scoreListingCandidateFallback(candidate.href, candidate.text, keywords) : 0,
    date: extractDateScoreFallback(candidate.href)
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.date !== a.date) return b.date - a.date;
    return a.candidate.position - b.candidate.position;
  });
  return scored.map(entry => entry.candidate);
}

export interface ListingAnchorInput {
  href: string;
  rawText: string;
}

export interface RankedListingResult {
  href: string;
  text: string;
}

export function extractAndRankListingCandidatesFallback(
  anchors: ListingAnchorInput[],
  keywords: string[],
  maxResults: number
): RankedListingResult[] {
  const hasKeywords = Array.isArray(keywords) && keywords.length > 0;
  const seen = new Set<string>();
  const scored: Array<{ href: string; text: string; score: number; date: number; position: number }> = [];
  let position = 0;
  for (const anchor of anchors) {
    const href = String(anchor?.href || "");
    if (!href) continue;
    const text = cleanTextFallback(anchor?.rawText);
    const score = hasKeywords ? scoreListingCandidateFallback(href, text, keywords) : 0;
    if (hasKeywords && score === 0) continue;
    const current = position++;
    if (seen.has(href)) continue;
    seen.add(href);
    scored.push({ href, text, score, date: extractDateScoreFallback(href), position: current });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.date !== a.date) return b.date - a.date;
    return a.position - b.position;
  });
  const limit = maxResults > 0 ? maxResults : scored.length;
  return scored.slice(0, limit).map(entry => ({ href: entry.href, text: entry.text }));
}

export function reorderByValidPermutation<T>(items: T[], order: unknown[]): T[] | null {
  if (order.length !== items.length) return null;
  const seen = new Set<number>();
  const result: T[] = [];
  for (const raw of order) {
    const index = Number(raw);
    if (!Number.isInteger(index) || index < 0 || index >= items.length || seen.has(index)) return null;
    seen.add(index);
    result.push(items[index]);
  }
  return result;
}
