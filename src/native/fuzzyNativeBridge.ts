import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __pathDirname } from "node:path";
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __pathDirname(__filename);
import fs from "fs";
import path from "path";

export interface NativeGameCandidate {
  key: string;
  name: string;
  aliases?: string[];
}

export interface NativeAutocompleteChoice {
  name: string;
  value: string;
}

export interface NativeFuzzyModule {
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
  rankListingCandidates?(candidates: Array<{ href: string; text: string; position: number }>, keywords: string[]): number[];
  rank_listing_candidates?(candidates: Array<{ href: string; text: string; position: number }>, keywords: string[]): number[];
  extractAndRankListingCandidates?(anchors: Array<{ href: string; rawText: string }>, keywords: string[], maxResults: number): Array<{ href: string; text: string }>;
  extract_and_rank_listing_candidates?(anchors: Array<{ href: string; rawText: string }>, keywords: string[], maxResults: number): Array<{ href: string; text: string }>;
  selectLatestSteamPatchNote?(items: Array<{ title: string; url: string; contents: string; tags: string[]; feedType: number; feedname: string; date: number }>): number | null;
  select_latest_steam_patch_note?(items: Array<{ title: string; url: string; contents: string; tags: string[]; feedType: number; feedname: string; date: number }>): number | null;
  chooseBestSteamMatch?(items: Array<{ name: string; itemType: string }>, query: string, forceGameOnly: boolean): number | null;
  choose_best_steam_match?(items: Array<{ name: string; itemType: string }>, query: string, forceGameOnly: boolean): number | null;
  dedupeAndRankDeals?(candidates: Array<{ title: string; popularityScore: number; fallbackId: string }>, maxDeals: number): number[];
  dedupe_and_rank_deals?(candidates: Array<{ title: string; popularityScore: number; fallbackId: string }>, maxDeals: number): number[];
  inspectMagic?(bytes: Buffer, filename: string, declaredMime: string): NativeMagicReport;
  inspect_magic?(bytes: Buffer, filename: string, declaredMime: string): NativeMagicReport;
  scanYara?(bytes: Buffer, timeoutMs: number, maxMatches: number): Promise<NativeYaraScanReport>;
  loadYaraRules?(source: string): NativeYaraRulesetInfo;
  yaraRulesetInfo?(): NativeYaraRulesetInfo;
  loadPublicSuffixList?(source: string): NativeSuffixListInfo;
  publicSuffixInfo?(): NativeSuffixListInfo;
  analyzeUrlHost?(host: string, brands: string[]): NativeUrlIdentityReport;
  inspectUntrustedContent?(input: NativeInspectionInput): Promise<NativeInspectionReport>;
  inspect_untrusted_content?(input: NativeInspectionInput): Promise<NativeInspectionReport>;
}

export interface NativeSuffixListInfo {
  listId: string;
  ruleCount: number;
  loaded: boolean;
  available: boolean;
}

export interface NativeUrlIdentityReport {
  hostUnicode: string;
  hostPunycode: string;
  registrableDomain: string;
  publicSuffix: string;
  skeleton: string;
  scripts: string;
  restrictionLevel: string;
  brandMatch: string;
  indicators: string[];
  suffixListId: string;
  unicodeVersion: string;
}

export interface NativeMagicReport {
  mime: string;
  description: string;
  encoding: string;
  kind: string;
  extensionMime: string;
  declaredMime: string;
  mismatchFlags: number;
}

export interface NativeYaraMatch {
  rule: string;
  namespace: string;
  tags: string[];
  severity: string;
  description: string;
}

export interface NativeYaraScanReport {
  status: string;
  reason: string;
  rulesetId: string;
  matches: NativeYaraMatch[];
  truncated: boolean;
}

export interface NativeYaraRulesetInfo {
  rulesetId: string;
  ruleCount: number;
  loaded: boolean;
  available: boolean;
}

export interface NativeInspectionInput {
  bytes: Buffer;
  filename: string;
  mime: string;
  mode: string;
  maxDepth: number;
  maxEntries: number;
  maxExpandedBytes: number;
  maxCompressionRatio: number;
  timeoutMs: number;
}

export interface NativeInspectionReport {
  status: string;
  indicators: string[];
  reason: string;
  entriesInspected: number;
  expandedBytes: number;
  elapsedMs: number;
}

let nativeModule: NativeFuzzyModule | null | undefined;
const NATIVE_FUZZY_LOAD_FAILURES: Array<{ file: string; error: string }> = [];

const CRITICAL_NATIVE_HASH_EXPORTS: Array<[keyof NativeFuzzyModule, keyof NativeFuzzyModule]> = [
  ["stableUpdateId", "stable_update_id"],
  ["dealHash", "deal_hash"]
];

export function missingCriticalNativeExports(mod: NativeFuzzyModule): string[] {
  return CRITICAL_NATIVE_HASH_EXPORTS
    .filter(([camel, snake]) => typeof mod[camel] !== "function" && typeof mod[snake] !== "function")
    .map(([camel]) => String(camel));
}

export function loadNativeFuzzy(): NativeFuzzyModule | null {
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
          const missingCritical = missingCriticalNativeExports(loaded);
          if (missingCritical.length === 0) {
            nativeModule = loaded;
            return nativeModule;
          }
          NATIVE_FUZZY_LOAD_FAILURES.push({
            file: path.join(dir, file),
            error: `addon loaded but missing critical hash exports: ${missingCritical.join(", ")} (stale/partial build — hash-urile de dedupe ar diverge fata de Rust -> spam de notificari seen)`
          });
          continue;
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

export function isRustFuzzyAvailable(): boolean {
  return loadNativeFuzzy() !== null;
}

export function getNativeFuzzy(): NativeFuzzyModule | null {
  return loadNativeFuzzy();
}

export function nativeStringFn(name: keyof NativeFuzzyModule, snakeName: keyof NativeFuzzyModule): ((...args: string[]) => string) | null {
  const native = loadNativeFuzzy();
  if (!native) return null;
  const fn = typeof native[name] === "function" ? native[name] : native[snakeName];
  return typeof fn === "function" ? fn.bind(native) as (...args: string[]) => string : null;
}
