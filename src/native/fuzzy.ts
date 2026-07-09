import type { DealInfo, GameConfig, GuildSettings } from "../types";
import type { NativeAutocompleteChoice, NativeFuzzyModule, NativeGameCandidate } from "./fuzzyNativeBridge";
import {
  ensureNativeFuzzy,
  getNativeFuzzy,
  isRustFuzzyAvailable,
  loadNativeFuzzy,
  missingCriticalNativeExports,
  nativeFallbackAllowed,
  nativeStringFn
} from "./fuzzyNativeBridge";
import {
  NATIVE_FALLBACK_FUNCTIONS,
  getNativeFallbackTotal,
  getNativeFallbackTotals,
  recordNativeFallback,
  resetNativeFallbackTotals
} from "./fuzzyFallbackMetrics";
import {
  HASH_VERSION,
  buildAutocompleteChoicesFallback,
  classifyPatchNoteFallback,
  cleanTextFallback,
  dealHashFallback,
  dealPassesFiltersFallback,
  extractDateScoreFallback,
  findGameKeysFallback,
  isGoodSteamArticleUrlFallback,
  levenshteinFallback,
  normalizeDealStateFallback,
  normalizeTitleForDedupeFallback,
  rankListingCandidatesFallback,
  reorderByValidPermutation,
  scoreListingCandidateFallback,
  stableUpdateIdFallback,
  type FuzzyMatchKeys,
  type RankableListingCandidate
} from "./fuzzyFallbacks";

export {
  HASH_VERSION,
  NATIVE_FALLBACK_FUNCTIONS,
  buildAutocompleteChoicesFallback,
  dealHashFallback,
  dealPassesFiltersFallback,
  ensureNativeFuzzy,
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
  reorderByValidPermutation,
  resetNativeFallbackTotals,
  stableUpdateIdFallback
};
export type { RankableListingCandidate };

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

function toNativeGameCandidates(games: GameConfig[]): NativeGameCandidate[] {
  return games.map(game => ({
    key: String(game.key),
    name: String(game.name),
    aliases: Array.isArray(game.aliases) ? game.aliases.map(alias => String(alias)) : []
  }));
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
    const fn = typeof native.buildAutocompleteChoices === "function" ? native.buildAutocompleteChoices : native.build_autocomplete_choices;
    if (typeof fn === "function") {
      try {
        const result = fn.call(native, toNativeGameCandidates(games), input, useNameAsValue, minRelevantScore, maxChoices, maxNameLen, maxValueLen);
        if (Array.isArray(result)) return result;
        recordNativeFallback("buildAutocompleteChoices", new Error("rezultat nativ invalid pentru buildAutocompleteChoices"));
      } catch (err) { recordNativeFallback("buildAutocompleteChoices", err); }
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
  const native = loadNativeFuzzy();
  if (native) {
    const fn = typeof native.findGameKeys === "function" ? native.findGameKeys : native.find_game_keys;
    if (typeof fn === "function") {
      try {
        const result = fn.call(native, rawText, toNativeGameCandidates(games), maxInput) as { gameKey?: unknown; suggestionKey?: unknown } | null;
        if (result && typeof result === "object") {
          return {
            gameKey: typeof result.gameKey === "string" ? result.gameKey : null,
            suggestionKey: typeof result.suggestionKey === "string" ? result.suggestionKey : null
          };
        }
        recordNativeFallback("findGameKeys", new Error("rezultat nativ invalid pentru findGameKeys"));
      } catch (err) { recordNativeFallback("findGameKeys", err); }
    }
  }
  return findGameKeysFallback(rawText, games, maxInput);
}
