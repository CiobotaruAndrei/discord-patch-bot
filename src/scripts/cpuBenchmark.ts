import { pathToFileURL as __pathToFileURL } from "node:url";
"use strict";

import {
  getNativeFuzzy,
  levenshteinFallback,
  isRustFuzzyAvailable,
  findGameKeysFallback,
  dealHashFallback,
  stableUpdateIdFallback,
  buildAutocompleteChoicesFallback,
  dealPassesFiltersFallback,
  rankListingCandidatesFallback,
  extractAndRankListingCandidatesFallback,
  selectLatestSteamPatchNoteIndexFallback
} from "../native/fuzzy.js";
import type { DealInfo, GameConfig, GuildSettings } from "../types.js";
import { strictEnvInt } from "./benchmarkEnv.js";

const SAMPLE_PAIRS: Array<[string, string]> = [
  ["counter strike 2", "counter-strike 2"],
  ["the witcher 3 wild hunt", "witcher 3"],
  ["baldurs gate 3", "baldur's gate iii"],
  ["cyberpunk 2077", "cyberpunk2077"],
  ["red dead redemption 2", "rdr2"],
  ["elden ring", "elder ring"],
  ["grand theft auto v", "gta 5"],
  ["minecraft", "mine craft"]
];

interface TimedResult {
  totalMs: number;
  callsPerSecond: number;
}

export interface CpuBenchmarkResult {
  iterations: number;
  callsPerIteration: number;
  rustAvailable: boolean;
  ts: TimedResult;
  native: TimedResult | null;
  speedup: number | null;
}

export type BenchmarkAreaKey =
  | "findGameKeys"
  | "dealHash"
  | "stableUpdateId"
  | "buildAutocompleteChoices"
  | "dealPassesFilters"
  | "rankListingCandidates"
  | "extractAndRankListingCandidates"
  | "selectLatestSteamPatchNote";

export interface AreaBenchmarkResult {
  key: BenchmarkAreaKey;
  area: string;
  rustAvailable: boolean;
  callsPerIteration: number;
  ts: TimedResult;
  native: TimedResult | null;
  speedup: number | null;
  parityOk: boolean;
}

function timeLoop(fn: () => void, iterations: number, callsPerIteration: number): TimedResult {
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) fn();
  const totalMs = Number(process.hrtime.bigint() - start) / 1e6;
  const totalCalls = iterations * callsPerIteration;
  return { totalMs, callsPerSecond: totalCalls / (totalMs / 1000) };
}

export function levenshteinParityMismatches(): Array<{ pair: [string, string]; native: number; ts: number }> {
  const native = getNativeFuzzy();
  if (!native) return [];
  const mismatches: Array<{ pair: [string, string]; native: number; ts: number }> = [];
  for (const pair of SAMPLE_PAIRS) {
    const nativeValue = native.levenshtein(pair[0], pair[1]);
    const tsValue = levenshteinFallback(pair[0], pair[1]);
    if (nativeValue !== tsValue) mismatches.push({ pair, native: nativeValue, ts: tsValue });
  }
  return mismatches;
}

export function runCpuBenchmark(iterations = strictEnvInt("CPU_BENCH_ITER", 200_000)): CpuBenchmarkResult {
  const native = getNativeFuzzy();
  const tsTimed = timeLoop(() => {
    for (const pair of SAMPLE_PAIRS) levenshteinFallback(pair[0], pair[1]);
  }, iterations, SAMPLE_PAIRS.length);
  const nativeTimed = native
    ? timeLoop(() => { for (const pair of SAMPLE_PAIRS) native.levenshtein(pair[0], pair[1]); }, iterations, SAMPLE_PAIRS.length)
    : null;
  const speedup = nativeTimed ? tsTimed.totalMs / nativeTimed.totalMs : null;
  return {
    iterations,
    callsPerIteration: SAMPLE_PAIRS.length,
    rustAvailable: isRustFuzzyAvailable(),
    ts: tsTimed,
    native: nativeTimed,
    speedup
  };
}

const SAMPLE_GAMES: GameConfig[] = [
  { key: "cs2", name: "Counter-Strike 2", aliases: ["counter strike", "csgo"] },
  { key: "witcher3", name: "The Witcher 3: Wild Hunt", aliases: ["witcher"] },
  { key: "bg3", name: "Baldur's Gate 3", aliases: ["baldurs gate"] },
  { key: "cyberpunk", name: "Cyberpunk 2077", aliases: ["cp2077"] },
  { key: "rdr2", name: "Red Dead Redemption 2", aliases: ["red dead"] },
  { key: "eldenring", name: "Elden Ring", aliases: [] },
  { key: "gtav", name: "Grand Theft Auto V", aliases: ["gta 5", "gta"] },
  { key: "minecraft", name: "Minecraft", aliases: ["mc"] },
  { key: "valorant", name: "Valorant", aliases: [] },
  { key: "lol", name: "League of Legends", aliases: ["league"] },
  { key: "dota2", name: "Dota 2", aliases: ["dota"] },
  { key: "fortnite", name: "Fortnite", aliases: [] },
  { key: "apex", name: "Apex Legends", aliases: ["apex legends"] },
  { key: "warframe", name: "Warframe", aliases: [] },
  { key: "terraria", name: "Terraria", aliases: [] }
];

const SAMPLE_GAME_CANDIDATES = SAMPLE_GAMES.map(game => ({
  key: String(game.key),
  name: String(game.name),
  aliases: Array.isArray(game.aliases) ? game.aliases.map(String) : []
}));

const SAMPLE_QUERIES = ["counter strike 2", "witcher", "baldurs gate", "cyberpunk 2077", "gta 5", "elden ring", "minecraft", "valorant"];
const MAX_FUZZY = 64;

const SAMPLE_DEALS: DealInfo[] = [
  { store: "Steam", steamAppID: 730, id: "steam_730", title: "Counter-Strike 2", salePrice: "0.00", normalPrice: "0.00", savings: 0 },
  { store: "Steam", steamAppID: 292030, id: "steam_292030", title: "The Witcher 3: Wild Hunt", salePrice: "9.99", normalPrice: "39.99", savings: 75 },
  { store: "Steam", steamAppID: 1086940, id: "steam_1086940", title: "Baldur's Gate 3", salePrice: "47.99", normalPrice: "59.99", savings: 20 },
  { store: "Epic Games", steamAppID: null, id: "epic_fortnite", title: "Fortnite", salePrice: "0.00", normalPrice: "0.00", savings: 0 },
  { store: "Epic Games", steamAppID: null, id: "epic_alan-wake-2", title: "Alan Wake 2", salePrice: "29.99", normalPrice: "49.99", savings: 40 },
  { store: "Steam", steamAppID: 1245620, id: "steam_1245620", title: "Elden Ring", salePrice: "41.99", normalPrice: "59.99", savings: 30 }
];

const SAMPLE_UPDATES: Array<[string, string]> = [
  ["Patch 1.2.0 - balance pass", "https://example.com/news/patch-1-2-0"],
  ["Hotfix: crash on startup", "https://example.com/news/hotfix-crash"],
  ["Season 3 update notes", "https://store.steampowered.com/news/app/730/view/123456"],
  ["Major content drop", "https://example.com/news/major-content-drop"],
  ["Weekly community update", "https://example.com/news/weekly-update-week-42"],
  ["The Witcher 3: next-gen patch", "https://example.com/news/witcher3-nextgen"]
];

const SAMPLE_GUILD: GuildSettings = {
  _id: "bench-guild",
  minDiscountPercent: 20,
  includeFreeGames: true,
  includePaidDiscounts: true,
  maxAbsolutePrice: 60,
  enabledStores: ["Steam", "Epic Games"]
} as GuildSettings;

const SAMPLE_LISTING_KEYWORDS = ["patch", "update", "hotfix"];
const SAMPLE_LISTING_CANDIDATES: Array<{ href: string; text: string; position: number }> = Array.from({ length: 40 }, (_, i) => ({
  href: `https://example.com/news/2024-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}/game-article-${i}-patch-notes`,
  text: i % 3 === 0 ? `Patch ${i} update hotfix notes` : `Community article number ${i}`,
  position: i
}));
const SAMPLE_LISTING_ANCHORS: Array<{ href: string; rawText: string }> = SAMPLE_LISTING_CANDIDATES.map((c, i) => ({
  href: c.href,
  rawText: i % 4 === 0 ? `  <b>${c.text}</b> &amp; more  ` : c.text
}));
const SAMPLE_LISTING_MAX = 3;
const SAMPLE_STEAM_ITEMS: Array<{ title: string; url: string; contents: string; tags: string[]; feed_type: number; feedname: string; date: number }> = Array.from({ length: 50 }, (_, i) => ({
  title: i % 3 === 0 ? `Patch ${i} notes` : i % 3 === 1 ? `Summer sale ${i}` : `Community giveaway ${i}`,
  url: i % 5 === 0 ? "https://cdn.steamstatic.com/img.png" : `https://store.steampowered.com/news/app/730/view/${i}`,
  contents: i % 2 === 0 ? "bug fixes and balance changes" : "no relevant words here",
  tags: i % 7 === 0 ? ["patchnotes"] : [],
  feed_type: i % 2 === 0 ? 1 : 13,
  feedname: i % 4 === 0 ? "steam_community_announcements" : "other",
  date: 1_700_000_000 + i * 3600
}));

function dealHashNativeArgs(deal: DealInfo): [string, string, string, string, string, string, string] {
  return [
    String(deal.store),
    deal.steamAppID ? String(deal.steamAppID) : "",
    String(deal.id || ""),
    String(deal.title || ""),
    String(deal.salePrice ?? ""),
    String(deal.normalPrice ?? ""),
    String(deal.savings ?? "")
  ];
}

function dealFilterNativeArgs(deal: DealInfo, guild: GuildSettings): [number, number, string, number, boolean, boolean, number, string[]] {
  return [
    parseFloat(String(deal.salePrice)),
    Number(deal.savings),
    String(deal.store),
    guild.minDiscountPercent ?? 0,
    guild.includeFreeGames !== false,
    guild.includePaidDiscounts !== false,
    Number(guild.maxAbsolutePrice) || 0,
    Array.isArray(guild.enabledStores) ? guild.enabledStores.map(String) : []
  ];
}

function normalizeKeys(value: unknown): { gameKey: string | null; suggestionKey: string | null } {
  const v = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const gameKey = typeof v.gameKey === "string" ? v.gameKey : typeof v.game_key === "string" ? v.game_key : null;
  const suggestionKey = typeof v.suggestionKey === "string" ? v.suggestionKey : typeof v.suggestion_key === "string" ? v.suggestion_key : null;
  return { gameKey, suggestionKey };
}

interface NativeFns {
  findGameKeys?: (text: string, games: unknown[], maxInput: number) => unknown;
  find_game_keys?: (text: string, games: unknown[], maxInput: number) => unknown;
  dealHash?: (...args: string[]) => string;
  deal_hash?: (...args: string[]) => string;
  stableUpdateId?: (title: string, link: string) => string;
  stable_update_id?: (title: string, link: string) => string;
  buildAutocompleteChoices?: (...args: unknown[]) => Array<{ name: string; value: string }>;
  build_autocomplete_choices?: (...args: unknown[]) => Array<{ name: string; value: string }>;
  dealPassesFilters?: (...args: unknown[]) => boolean;
  deal_passes_filters?: (...args: unknown[]) => boolean;
  rankListingCandidates?: (candidates: Array<{ href: string; text: string; position: number }>, keywords: string[]) => number[];
  rank_listing_candidates?: (candidates: Array<{ href: string; text: string; position: number }>, keywords: string[]) => number[];
  extractAndRankListingCandidates?: (anchors: Array<{ href: string; rawText: string }>, keywords: string[], maxResults: number) => Array<{ href: string; text: string }>;
  extract_and_rank_listing_candidates?: (anchors: Array<{ href: string; rawText: string }>, keywords: string[], maxResults: number) => Array<{ href: string; text: string }>;
  selectLatestSteamPatchNote?: (items: unknown[]) => number | null;
  select_latest_steam_patch_note?: (items: unknown[]) => number | null;
}

interface AreaSpec {
  key: BenchmarkAreaKey;
  area: string;
  callsPerIteration: number;
  ts: () => void;
  native: ((n: NativeFns) => void) | null;
  parityOk: (n: NativeFns) => boolean;
}

function buildAreaSpecs(native: NativeFns | null): AreaSpec[] {
  const specs: AreaSpec[] = [];

  specs.push({
    key: "findGameKeys",
    area: "fuzzy-match (findGameKeys)",
    callsPerIteration: SAMPLE_QUERIES.length,
    ts: () => { for (const q of SAMPLE_QUERIES) findGameKeysFallback(q, SAMPLE_GAMES, MAX_FUZZY); },
    native: native && (native.findGameKeys || native.find_game_keys)
      ? (n: NativeFns) => {
          const fn = (n.findGameKeys || n.find_game_keys) as (text: string, games: unknown[], maxInput: number) => unknown;
          for (const q of SAMPLE_QUERIES) fn(q, SAMPLE_GAME_CANDIDATES, MAX_FUZZY);
        }
      : null,
    parityOk: (n: NativeFns) => {
      const fn = n.findGameKeys || n.find_game_keys;
      if (!fn) return true;
      return SAMPLE_QUERIES.every(q => {
        const nativeKeys = normalizeKeys(fn(q, SAMPLE_GAME_CANDIDATES, MAX_FUZZY));
        const tsKeys = findGameKeysFallback(q, SAMPLE_GAMES, MAX_FUZZY);
        return nativeKeys.gameKey === tsKeys.gameKey && nativeKeys.suggestionKey === tsKeys.suggestionKey;
      });
    }
  });

  specs.push({
    key: "dealHash",
    area: "hashing (dealHash)",
    callsPerIteration: SAMPLE_DEALS.length,
    ts: () => { for (const deal of SAMPLE_DEALS) dealHashFallback(deal); },
    native: native && (native.dealHash || native.deal_hash)
      ? (n: NativeFns) => {
          const fn = (n.dealHash || n.deal_hash) as (...args: string[]) => string;
          for (const deal of SAMPLE_DEALS) fn(...dealHashNativeArgs(deal));
        }
      : null,
    parityOk: (n: NativeFns) => {
      const fn = n.dealHash || n.deal_hash;
      if (!fn) return true;
      return SAMPLE_DEALS.every(deal => fn(...dealHashNativeArgs(deal)) === dealHashFallback(deal));
    }
  });

  specs.push({
    key: "stableUpdateId",
    area: "hashing (stableUpdateId)",
    callsPerIteration: SAMPLE_UPDATES.length,
    ts: () => { for (const [title, link] of SAMPLE_UPDATES) stableUpdateIdFallback(title, link); },
    native: native && (native.stableUpdateId || native.stable_update_id)
      ? (n: NativeFns) => {
          const fn = (n.stableUpdateId || n.stable_update_id) as (title: string, link: string) => string;
          for (const [title, link] of SAMPLE_UPDATES) fn(title, link);
        }
      : null,
    parityOk: (n: NativeFns) => {
      const fn = n.stableUpdateId || n.stable_update_id;
      if (!fn) return true;
      return SAMPLE_UPDATES.every(([title, link]) => fn(title, link) === stableUpdateIdFallback(title, link));
    }
  });

  specs.push({
    key: "buildAutocompleteChoices",
    area: "autocomplete (buildAutocompleteChoices)",
    callsPerIteration: SAMPLE_QUERIES.length,
    ts: () => { for (const q of SAMPLE_QUERIES) buildAutocompleteChoicesFallback(SAMPLE_GAMES, q, false, 1, 25, 100, 100); },
    native: native && (native.buildAutocompleteChoices || native.build_autocomplete_choices)
      ? (n: NativeFns) => {
          const fn = (n.buildAutocompleteChoices || n.build_autocomplete_choices) as (...args: unknown[]) => Array<{ name: string; value: string }>;
          for (const q of SAMPLE_QUERIES) fn(SAMPLE_GAME_CANDIDATES, q, false, 1, 25, 100, 100);
        }
      : null,
    parityOk: (n: NativeFns) => {
      const fn = n.buildAutocompleteChoices || n.build_autocomplete_choices;
      if (!fn) return true;
      return SAMPLE_QUERIES.every(q => {
        const nativeChoices = fn(SAMPLE_GAME_CANDIDATES, q, false, 1, 25, 100, 100).map(c => String(c.value));
        const tsChoices = buildAutocompleteChoicesFallback(SAMPLE_GAMES, q, false, 1, 25, 100, 100).map(c => String(c.value));
        return JSON.stringify(nativeChoices) === JSON.stringify(tsChoices);
      });
    }
  });

  specs.push({
    key: "dealPassesFilters",
    area: "deal-filters (dealPassesFilters)",
    callsPerIteration: SAMPLE_DEALS.length,
    ts: () => { for (const deal of SAMPLE_DEALS) dealPassesFiltersFallback(deal, SAMPLE_GUILD); },
    native: native && (native.dealPassesFilters || native.deal_passes_filters)
      ? (n: NativeFns) => {
          const fn = (n.dealPassesFilters || n.deal_passes_filters) as (...args: unknown[]) => boolean;
          for (const deal of SAMPLE_DEALS) fn(...dealFilterNativeArgs(deal, SAMPLE_GUILD));
        }
      : null,
    parityOk: (n: NativeFns) => {
      const fn = n.dealPassesFilters || n.deal_passes_filters;
      if (!fn) return true;
      return SAMPLE_DEALS.every(deal => fn(...dealFilterNativeArgs(deal, SAMPLE_GUILD)) === dealPassesFiltersFallback(deal, SAMPLE_GUILD));
    }
  });

  const listingPayload = () => SAMPLE_LISTING_CANDIDATES.map(c => ({ href: c.href, text: c.text, position: c.position }));
  specs.push({
    key: "rankListingCandidates",
    area: "listing-rank (rankListingCandidates)",
    callsPerIteration: 1,
    ts: () => { rankListingCandidatesFallback(SAMPLE_LISTING_CANDIDATES, SAMPLE_LISTING_KEYWORDS); },
    native: native && (native.rankListingCandidates || native.rank_listing_candidates)
      ? (n: NativeFns) => {
          const fn = (n.rankListingCandidates || n.rank_listing_candidates) as (candidates: Array<{ href: string; text: string; position: number }>, keywords: string[]) => number[];
          fn(listingPayload(), SAMPLE_LISTING_KEYWORDS);
        }
      : null,
    parityOk: (n: NativeFns) => {
      const fn = n.rankListingCandidates || n.rank_listing_candidates;
      if (!fn) return true;
      const order = fn(listingPayload(), SAMPLE_LISTING_KEYWORDS);
      const nativeOrder = order.map(i => SAMPLE_LISTING_CANDIDATES[Number(i)].position);
      const tsOrder = rankListingCandidatesFallback(SAMPLE_LISTING_CANDIDATES, SAMPLE_LISTING_KEYWORDS).map(c => c.position);
      return JSON.stringify(nativeOrder) === JSON.stringify(tsOrder);
    }
  });

  const anchorsPayload = () => SAMPLE_LISTING_ANCHORS.map(a => ({ href: a.href, rawText: a.rawText }));
  specs.push({
    key: "extractAndRankListingCandidates",
    area: "listing-batch (extractAndRankListingCandidates)",
    callsPerIteration: 1,
    ts: () => { extractAndRankListingCandidatesFallback(SAMPLE_LISTING_ANCHORS, SAMPLE_LISTING_KEYWORDS, SAMPLE_LISTING_MAX); },
    native: native && (native.extractAndRankListingCandidates || native.extract_and_rank_listing_candidates)
      ? (n: NativeFns) => {
          const fn = (n.extractAndRankListingCandidates || n.extract_and_rank_listing_candidates) as (anchors: Array<{ href: string; rawText: string }>, keywords: string[], maxResults: number) => Array<{ href: string; text: string }>;
          fn(anchorsPayload(), SAMPLE_LISTING_KEYWORDS, SAMPLE_LISTING_MAX);
        }
      : null,
    parityOk: (n: NativeFns) => {
      const fn = n.extractAndRankListingCandidates || n.extract_and_rank_listing_candidates;
      if (!fn) return true;
      const nativeResult = fn(anchorsPayload(), SAMPLE_LISTING_KEYWORDS, SAMPLE_LISTING_MAX);
      const tsResult = extractAndRankListingCandidatesFallback(SAMPLE_LISTING_ANCHORS, SAMPLE_LISTING_KEYWORDS, SAMPLE_LISTING_MAX);
      return JSON.stringify(nativeResult) === JSON.stringify(tsResult);
    }
  });

  const steamNativePayload = () => SAMPLE_STEAM_ITEMS.map(item => ({
    title: item.title,
    url: item.url,
    contents: item.contents,
    tags: item.tags,
    feedType: item.feed_type === 1 ? 1 : 0,
    feedname: item.feedname,
    date: item.date
  }));
  specs.push({
    key: "selectLatestSteamPatchNote",
    area: "steam-patch (selectLatestSteamPatchNote)",
    callsPerIteration: 1,
    ts: () => { selectLatestSteamPatchNoteIndexFallback(SAMPLE_STEAM_ITEMS); },
    native: native && (native.selectLatestSteamPatchNote || native.select_latest_steam_patch_note)
      ? (n: NativeFns) => {
          const fn = (n.selectLatestSteamPatchNote || n.select_latest_steam_patch_note) as (items: unknown[]) => number | null;
          fn(steamNativePayload());
        }
      : null,
    parityOk: (n: NativeFns) => {
      const fn = n.selectLatestSteamPatchNote || n.select_latest_steam_patch_note;
      if (!fn) return true;
      const nativeIndex = fn(steamNativePayload());
      const tsIndex = selectLatestSteamPatchNoteIndexFallback(SAMPLE_STEAM_ITEMS);
      return (nativeIndex ?? -1) === tsIndex;
    }
  });

  return specs;
}

export function runAreaBenchmarks(iterations = strictEnvInt("CPU_BENCH_ITER", 100_000)): AreaBenchmarkResult[] {
  const native = getNativeFuzzy() as NativeFns | null;
  const rustAvailable = isRustFuzzyAvailable();
  return buildAreaSpecs(native).map(spec => {
    const ts = timeLoop(spec.ts, iterations, spec.callsPerIteration);
    const nativeFn = spec.native;
    const nativeTimed = native && nativeFn
      ? timeLoop(() => nativeFn(native), iterations, spec.callsPerIteration)
      : null;
    return {
      key: spec.key,
      area: spec.area,
      rustAvailable,
      callsPerIteration: spec.callsPerIteration,
      ts,
      native: nativeTimed,
      speedup: nativeTimed ? ts.totalMs / nativeTimed.totalMs : null,
      parityOk: native ? spec.parityOk(native) : true
    };
  });
}

if (process.argv[1] !== undefined && __pathToFileURL(process.argv[1]).href === import.meta.url) {
  const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
  const result = runCpuBenchmark();
  console.log(`CPU benchmark (levenshtein), ${fmt(result.iterations)} iteratii x ${result.callsPerIteration} apeluri`);
  console.log(`- TS fallback: ${result.ts.totalMs.toFixed(1)}ms, ${fmt(result.ts.callsPerSecond)} apeluri/s`);
  if (result.native) {
    console.log(`- Rust native: ${result.native.totalMs.toFixed(1)}ms, ${fmt(result.native.callsPerSecond)} apeluri/s`);
    console.log(`- Speedup native vs TS: ${result.speedup ? result.speedup.toFixed(2) : "-"}x`);
    const mismatches = levenshteinParityMismatches();
    console.log(`- Paritate native==TS: ${mismatches.length === 0 ? "OK" : `${mismatches.length} diferente`}`);
  } else {
    console.log("- Rust native: indisponibil (foloseste fallback TS).");
  }

  console.log("\nCPU benchmark per zona (TS vs Rust):");
  for (const area of runAreaBenchmarks()) {
    if (area.native) {
      console.log(`- ${area.area}: TS ${fmt(area.ts.callsPerSecond)} ap/s vs Rust ${fmt(area.native.callsPerSecond)} ap/s -> ${area.speedup ? area.speedup.toFixed(2) : "-"}x, paritate ${area.parityOk ? "OK" : "DIFERENTE"}`);
    } else {
      console.log(`- ${area.area}: Rust indisponibil, TS ${fmt(area.ts.callsPerSecond)} ap/s`);
    }
  }
}

export {};
