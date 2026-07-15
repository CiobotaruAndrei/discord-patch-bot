"use strict";

import type { CheerioAPI } from "cheerio";
import type { CurrencyCode, DealInfo, NormalizedUpdate, PatchUpdate, PriceValue, HttpRequestOptions } from "../types.js";
import type { HttpMetricsRef } from "../infra/http/httpMetrics.js";
import type { DealsApi, SteamSourceApi, UpdatesApi } from "./sourceApis.js";
import type { SourceRuntimeDeps } from "./runtime.js";
import { assertNoUndefinedExports } from "../shared/assertCompleteExports.js";
import attachHttpClient from "../infra/http/client.js";
import attachSteam from "./steam/index.js";
import attachUpdates from "./updates/index.js";
import attachDeals from "./deals/index.js";
import { createSourceRuntime } from "./runtime.js";

export type SourceRegistryApi = {
  USER_AGENTS: readonly string[];
  MAX_HTML_BYTES: number;
  MAX_JSON_BYTES: number;
  MAX_DEALS: number;
  FETCH_CONCURRENCY: number;
  cleanText: (text: unknown) => string;
  truncate: (str: unknown, maxLen: number) => string;
  normalizeTitleForDedupe: (str: unknown) => string;
  stableUpdateId: (title: unknown, link: unknown) => string;
  normalizeUpdate: (data: PatchUpdate) => NormalizedUpdate;
  safeCheerioLoad: (html: unknown) => CheerioAPI;
  levenshtein: SteamSourceApi["levenshtein"];
  httpReq: (method: string, url: string, options?: HttpRequestOptions, retries?: number, backoff?: number) => Promise<{ data: unknown }>;
  fetchWithProxy: (targetUrl: string, options?: HttpRequestOptions) => Promise<string>;
  dealHash: (deal: DealInfo) => string;
  attachMetrics: (metricsRef: HttpMetricsRef) => void;
  fetchGameUpdate: UpdatesApi["fetchGameUpdate"];
  executeFetchWithCircuitBreaker: UpdatesApi["executeFetchWithCircuitBreaker"];
  getLatestForAllGames: UpdatesApi["getLatestForAllGames"];
  fetchSteamReviewData: DealsApi["fetchSteamReviewData"];
  enrichDealData: DealsApi["enrichDealData"];
  fetchDeals: DealsApi["fetchDeals"];
  searchSteamGameByName: SteamSourceApi["searchSteamGameByName"];
  chooseBestSteamMatch: SteamSourceApi["chooseBestSteamMatch"];
  fetchSteamPriceDetails: SteamSourceApi["fetchSteamPriceDetails"];
  fetchSteamCurrentPlayers: SteamSourceApi["fetchSteamCurrentPlayers"];
  extractOfferEndFromHtml: SteamSourceApi["extractOfferEndFromHtml"];
  extractSteamOfferEndDate: SteamSourceApi["extractSteamOfferEndDate"];
  cleanEnrichedCache: DealsApi["cleanEnrichedCache"];
  getEnrichedCacheSize: DealsApi["getEnrichedCacheSize"];
  formatPrice: (value: PriceValue, currencyCode?: CurrencyCode | string | null) => string;
};

type SourceRuntimeContext = Partial<SourceRegistryApi> & ReturnType<typeof createSourceRuntime>;

function requireSourceValue<K extends keyof SourceRegistryApi>(context: Partial<SourceRegistryApi>, key: K): SourceRegistryApi[K] {
  const value = context[key];
  if (value === undefined) throw new Error(`sourceRegistry nu a primit exportul necesar din context: ${String(key)}`);
  return value;
}

function buildSourceRegistry(context: Partial<SourceRegistryApi>): SourceRegistryApi {
  return {
    USER_AGENTS: requireSourceValue(context, "USER_AGENTS"), MAX_HTML_BYTES: requireSourceValue(context, "MAX_HTML_BYTES"),
    MAX_JSON_BYTES: requireSourceValue(context, "MAX_JSON_BYTES"), MAX_DEALS: requireSourceValue(context, "MAX_DEALS"),
    FETCH_CONCURRENCY: requireSourceValue(context, "FETCH_CONCURRENCY"), cleanText: requireSourceValue(context, "cleanText"),
    truncate: requireSourceValue(context, "truncate"), normalizeTitleForDedupe: requireSourceValue(context, "normalizeTitleForDedupe"),
    stableUpdateId: requireSourceValue(context, "stableUpdateId"), normalizeUpdate: requireSourceValue(context, "normalizeUpdate"),
    safeCheerioLoad: requireSourceValue(context, "safeCheerioLoad"), levenshtein: requireSourceValue(context, "levenshtein"),
    httpReq: requireSourceValue(context, "httpReq"), fetchWithProxy: requireSourceValue(context, "fetchWithProxy"),
    dealHash: requireSourceValue(context, "dealHash"), attachMetrics: requireSourceValue(context, "attachMetrics"),
    fetchGameUpdate: requireSourceValue(context, "fetchGameUpdate"), executeFetchWithCircuitBreaker: requireSourceValue(context, "executeFetchWithCircuitBreaker"),
    getLatestForAllGames: requireSourceValue(context, "getLatestForAllGames"), fetchSteamReviewData: requireSourceValue(context, "fetchSteamReviewData"),
    enrichDealData: requireSourceValue(context, "enrichDealData"), fetchDeals: requireSourceValue(context, "fetchDeals"),
    searchSteamGameByName: requireSourceValue(context, "searchSteamGameByName"), chooseBestSteamMatch: requireSourceValue(context, "chooseBestSteamMatch"),
    fetchSteamPriceDetails: requireSourceValue(context, "fetchSteamPriceDetails"), fetchSteamCurrentPlayers: requireSourceValue(context, "fetchSteamCurrentPlayers"),
    extractOfferEndFromHtml: requireSourceValue(context, "extractOfferEndFromHtml"), extractSteamOfferEndDate: requireSourceValue(context, "extractSteamOfferEndDate"),
    cleanEnrichedCache: requireSourceValue(context, "cleanEnrichedCache"), getEnrichedCacheSize: requireSourceValue(context, "getEnrichedCacheSize"),
    formatPrice: requireSourceValue(context, "formatPrice")
  };
}

export function createSourceRegistry(deps: SourceRuntimeDeps): SourceRegistryApi {
  const base: SourceRuntimeContext = createSourceRuntime(deps);
  const withHttp = { ...base, ...attachHttpClient.buildFrom(base) };
  const withSteam = { ...withHttp, ...attachSteam.buildFrom(withHttp) };
  const withUpdates = { ...withSteam, ...attachUpdates.buildFrom(withSteam) };
  const withDeals = { ...withUpdates, ...attachDeals.buildFrom(withUpdates) };
  return Object.freeze(assertNoUndefinedExports(buildSourceRegistry(withDeals), "sourceRegistry"));
}
