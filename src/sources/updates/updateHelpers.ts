import type { CheerioAPI } from "cheerio";
import type { AbortPredicate } from "../../types.js";
import type { GameConfig, GameSourceFallback } from "../../config/configTypes.js";
import type { HttpRequestOptions } from "../httpRequestTypes.js";
import type { ListingCandidate } from "../sourceApis.js";
import {
  classifyPatchNote,
  extractDateScore as rustExtractDateScore,
  isGoodSteamArticleUrl as rustIsGoodSteamArticleUrl,
  scoreListingCandidate
} from "../../native/fuzzy.js";

type HttpResponse<T = unknown> = { data: T };
type CheerioSelector = Parameters<CheerioAPI>[0];
type HttpReq = (
  method: string,
  url: string,
  options?: HttpRequestOptions,
  retries?: number,
  backoff?: number
) => Promise<HttpResponse<unknown>>;
type TrackInflight = <T>(map: Map<string, Promise<T>>, key: string, promise: Promise<T>) => void;
type WithInflightTimeout = <T>(promise: Promise<T>, label: string) => Promise<T>;
type SchemaDriftErrorInstance = Error & { source?: string };
type SchemaDriftErrorClass = new (message: string, source?: string) => SchemaDriftErrorInstance;


interface RssItem {
  title?: string;
  link?: string;
  pubDate?: string;
  guid?: string;
  contentSnippet?: string;
  contents?: unknown;
  tags?: unknown;
}

interface RssParserLike {
  parseString(input: string): Promise<{ items?: RssItem[] }>;
}

function absoluteUrl(base: string | undefined, maybeRelative: string | undefined): string {
  try { return new URL(maybeRelative || "", base).href; } catch { return ""; }
}

function isGoodSteamArticleUrl(url: unknown): boolean {
  return rustIsGoodSteamArticleUrl(url);
}

function extractDateScore(url: string): number {
  return rustExtractDateScore(url);
}

const articleHrefRegexCache = new WeakMap<GameConfig, RegExp>();

function getArticleHrefRegex(game: GameConfig): RegExp | null {
  const pattern = game.articleHrefRegex;
  if (!pattern) return null;
  const cached = articleHrefRegexCache.get(game);
  if (cached) return cached;
  const compiled = new RegExp(pattern, "i");
  articleHrefRegexCache.set(game, compiled);
  return compiled;
}

function scoreCandidate(candidate: ListingCandidate, keywords: string[]): number {
  return scoreListingCandidate(candidate.href, candidate.text, keywords);
}

function isLikelyPatchNote(item: { title?: unknown; contents?: unknown; tags?: unknown }): boolean {
  return classifyPatchNote(item?.title, item?.contents, item?.tags);
}

function sourceConcurrencyGroup(game: GameConfig): string {
  const type = game.type;
  if (!type || type === "steam") return "steam";
  if (type === "epic_games") return "epic";
  if (type === "listing_based") return "listing";
  if (type === "rss") return "rss";
  if (type === "nvidia" || type === "amd" || type === "intel") return "driver";
  return "other";
}

function applyFallbackSource(game: GameConfig, fallback: GameSourceFallback): GameConfig {
  return {
    ...game,
    type: fallback.type,
    url: fallback.url ?? game.url,
    listingUrl: fallback.listingUrl ?? game.listingUrl,
    listingUrls: fallback.listingUrls ?? game.listingUrls,
    baseUrl: fallback.baseUrl ?? game.baseUrl
  };
}

export {
  absoluteUrl,
  isGoodSteamArticleUrl,
  extractDateScore,
  getArticleHrefRegex,
  scoreCandidate,
  isLikelyPatchNote,
  sourceConcurrencyGroup,
  applyFallbackSource
};
export type { HttpResponse, HttpReq, RssItem, RssParserLike, SchemaDriftErrorClass, SchemaDriftErrorInstance, TrackInflight, WithInflightTimeout, CheerioSelector };
