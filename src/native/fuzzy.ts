import type { DealInfo, GameConfig, GuildSettings } from "../types.js";
import type { NativeAutocompleteChoice, NativeFuzzyModule } from "./fuzzyNativeBridge.js";
import {
  ensureNativeFuzzy,
  getNativeFuzzy,
  isRustFuzzyAvailable,
  loadNativeFuzzy,
  missingCriticalNativeExports,
  nativeFallbackAllowed,
  nativeStringFn
} from "./fuzzyNativeBridge.js";
import {
  NATIVE_FALLBACK_FUNCTIONS,
  getNativeFallbackTotal,
  getNativeFallbackTotals,
  recordNativeFallback,
  resetNativeFallbackTotals
} from "./fuzzyFallbackMetrics.js";
import {
  HASH_VERSION,
  buildAutocompleteChoicesFallback,
  classifyPatchNoteFallback,
  cleanTextFallback,
  dealHashFallback,
  dealPassesFiltersFallback,
  extractAndRankListingCandidatesFallback,
  extractDateScoreFallback,
  findGameKeysFallback,
  isGoodSteamArticleUrlFallback,
  levenshteinFallback,
  normalizeDealStateFallback,
  normalizeTitleForDedupeFallback,
  chooseBestSteamMatchIndexFallback,
  dedupeAndRankDealsIndexFallback,
  rankListingCandidatesFallback,
  reorderByValidPermutation,
  scoreListingCandidateFallback,
  selectLatestSteamPatchNoteIndexFallback,
  stableUpdateIdFallback,
  type DealCandidateInput,
  type FuzzyMatchKeys,
  type ListingAnchorInput,
  type RankableListingCandidate,
  type RankedListingResult,
  type SteamMatchItemInput,
  type SteamNewsItemInput
} from "./fuzzyFallbacks.js";

export {
  HASH_VERSION,
  NATIVE_FALLBACK_FUNCTIONS,
  buildAutocompleteChoicesFallback,
  dealHashFallback,
  dealPassesFiltersFallback,
  ensureNativeFuzzy,
  extractAndRankListingCandidatesFallback,
  findGameKeysFallback,
  getNativeFallbackTotal,
  getNativeFallbackTotals,
  getNativeFuzzy,
  isRustFuzzyAvailable,
  levenshteinFallback,
  missingCriticalNativeExports,
  nativeFallbackAllowed,
  rankListingCandidatesFallback,
  recordNativeFallback,
  chooseBestSteamMatchIndexFallback,
  dedupeAndRankDealsIndexFallback,
  reorderByValidPermutation,
  resetNativeFallbackTotals,
  selectLatestSteamPatchNoteIndexFallback,
  stableUpdateIdFallback
};
export type { DealCandidateInput, ListingAnchorInput, RankableListingCandidate, RankedListingResult, SteamMatchItemInput, SteamNewsItemInput };

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

export function rankListingCandidates<T extends RankableListingCandidate>(candidates: T[], keywords: string[]): T[] {
  if (!Array.isArray(candidates) || candidates.length === 0) return Array.isArray(candidates) ? candidates : [];
  const native: NativeFuzzyModule | null = loadNativeFuzzy();
  if (native) {
    const fn = typeof native.rankListingCandidates === "function" ? native.rankListingCandidates : native.rank_listing_candidates;
    if (typeof fn === "function") {
      try {
        const payload = candidates.map(candidate => ({
          href: String(candidate.href || ""),
          text: String(candidate.text || ""),
          position: Number(candidate.position) || 0
        }));
        const order = fn.call(native, payload, Array.isArray(keywords) ? keywords.map(k => String(k)) : []);
        if (Array.isArray(order) && order.length === candidates.length) {
          const ranked = reorderByValidPermutation(candidates, order);
          if (ranked) return ranked;
          recordNativeFallback("rankListingCandidates", new Error("ordonare nativa invalida (index out-of-range / NaN / duplicat)"));
        }
      } catch (err) { recordNativeFallback("rankListingCandidates", err); }
    }
  }
  return rankListingCandidatesFallback(candidates, keywords);
}

export function extractAndRankListingCandidates(
  anchors: ListingAnchorInput[],
  keywords: string[],
  maxResults: number
): RankedListingResult[] {
  if (!Array.isArray(anchors) || anchors.length === 0) return [];
  const native = loadNativeFuzzy();
  if (native) {
    const fn = typeof native.extractAndRankListingCandidates === "function"
      ? native.extractAndRankListingCandidates
      : native.extract_and_rank_listing_candidates;
    if (typeof fn === "function") {
      try {
        const payload = anchors.map(anchor => ({
          href: String(anchor.href || ""),
          rawText: String(anchor.rawText || "")
        }));
        const result = fn.call(native, payload, Array.isArray(keywords) ? keywords.map(k => String(k)) : [], Math.max(0, Number(maxResults) || 0));
        if (Array.isArray(result)) {
          return result.map(entry => ({ href: String(entry.href || ""), text: String(entry.text || "") }));
        }
      } catch (err) { recordNativeFallback("extractAndRankListingCandidates", err); }
    }
  }
  return extractAndRankListingCandidatesFallback(anchors, keywords, maxResults);
}

export function selectLatestSteamPatchNoteIndex(items: SteamNewsItemInput[]): number {
  return selectLatestSteamPatchNoteIndexFallback(Array.isArray(items) ? items : []);
}

export function chooseBestSteamMatchIndex(items: SteamMatchItemInput[], query: string, forceGameOnly: boolean): number {
  if (!Array.isArray(items) || items.length === 0) return -1;
  const q = String(query ?? "");
  const force = Boolean(forceGameOnly);
  const native = loadNativeFuzzy();
  if (native) {
    const fn = typeof native.chooseBestSteamMatch === "function"
      ? native.chooseBestSteamMatch
      : native.choose_best_steam_match;
    if (typeof fn === "function") {
      try {
        const payload = items.map(item => ({
          name: String(item?.name ?? ""),
          itemType: typeof item?.type === "string" ? item.type : ""
        }));
        const index = fn.call(native, payload, q, force);
        if (index === null || index === undefined) return -1;
        const numeric = Number(index);
        if (Number.isInteger(numeric) && numeric >= 0 && numeric < items.length) return numeric;
        recordNativeFallback("chooseBestSteamMatch", new Error("index nativ invalid (out-of-range / NaN)"));
      } catch (err) { recordNativeFallback("chooseBestSteamMatch", err); }
    }
  }
  return chooseBestSteamMatchIndexFallback(items, q, force);
}

export function dedupeAndRankDealsIndex(deals: Array<{ title?: unknown; popularityScore?: unknown; id?: unknown }>, maxDeals: number): number[] {
  if (!Array.isArray(deals) || deals.length === 0) return [];
  const cap = Math.max(0, Number(maxDeals) || 0);
  const candidates: DealCandidateInput[] = deals.map(deal => ({
    title: deal?.title,
    popularityScore: Number(deal?.popularityScore) || 0,
    fallbackId: String(deal?.id)
  }));
  return dedupeAndRankDealsIndexFallback(candidates, cap);
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
  const rawText = String(text ?? "");
  return findGameKeysFallback(rawText, games, maxInput);
}
