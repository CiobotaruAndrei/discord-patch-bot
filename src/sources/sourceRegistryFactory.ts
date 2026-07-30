"use strict";

import type { CheerioAPI } from "cheerio";
import type { CurrencyCode, PriceValue } from "../types.js";
import type { HttpRequestOptions } from "./httpRequestTypes.js";
import type { DealInfo, NormalizedUpdate, PatchUpdate } from "./sourceTypes.js";
import type { HttpMetricsRef } from "../infra/http/httpMetrics.js";
import type { DealsApi, SteamSourceApi, UpdatesApi } from "./sourceApis.js";
import type { SourceRuntimeDeps } from "./runtime.js";
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
  fetchSteamLatestUpdateSize: SteamSourceApi["fetchSteamLatestUpdateSize"];
  extractOfferEndFromHtml: SteamSourceApi["extractOfferEndFromHtml"];
  extractSteamOfferEndDate: SteamSourceApi["extractSteamOfferEndDate"];
  cleanEnrichedCache: DealsApi["cleanEnrichedCache"];
  getEnrichedCacheSize: DealsApi["getEnrichedCacheSize"];
  formatPrice: (value: PriceValue, currencyCode?: CurrencyCode | string | null) => string;
};

export function createSourceRegistry(deps: SourceRuntimeDeps): SourceRegistryApi {
  const runtime = createSourceRuntime(deps);
  const http = attachHttpClient.buildFrom(runtime);
  const steam = attachSteam.createSteamSource({
    logger: runtime.logger,
    getCurrencyConfig: runtime.getCurrencyConfig,
    httpReq: http.httpReq,
    safeCheerioLoad: http.safeCheerioLoad
  });
  const updates = attachUpdates.createUpdates({
    rssParser: runtime.rssParser,
    circuitBreakerStore: runtime.circuitBreakerStore,
    logger: runtime.logger,
    adminAlert: runtime.adminAlert,
    runConcurrent: runtime.runConcurrent,
    SchemaDriftError: runtime.SchemaDriftError,
    FETCH_CONCURRENCY: http.FETCH_CONCURRENCY,
    FETCH_CONCURRENCY_STEAM: http.FETCH_CONCURRENCY_STEAM,
    FETCH_CONCURRENCY_EPIC: http.FETCH_CONCURRENCY_EPIC,
    FETCH_CONCURRENCY_LISTING: http.FETCH_CONCURRENCY_LISTING,
    FETCH_CONCURRENCY_DRIVER: http.FETCH_CONCURRENCY_DRIVER,
    CIRCUIT_BREAKER_FAIL_THRESHOLD: http.CIRCUIT_BREAKER_FAIL_THRESHOLD,
    CIRCUIT_BREAKER_COOLDOWN_MS: http.CIRCUIT_BREAKER_COOLDOWN_MS,
    CIRCUIT_BREAKER_JITTER_MS: http.CIRCUIT_BREAKER_JITTER_MS,
    SCHEMA_DRIFT_THRESHOLD: http.SCHEMA_DRIFT_THRESHOLD,
    httpReq: http.httpReq,
    conditionalGet: http.conditionalGet,
    fetchWithProxy: http.fetchWithProxy,
    withInflightTimeout: http.withInflightTimeout,
    trackInflight: http.trackInflight,
    cleanText: http.cleanText,
    stableUpdateId: http.stableUpdateId,
    normalizeUpdate: http.normalizeUpdate,
    safeCheerioLoad: http.safeCheerioLoad,
    crypto: runtime.crypto,
    getHttpMetrics: http.getHttpMetrics
  });
  const deals = attachDeals.createDeals({
    logger: runtime.logger,
    getCurrencyConfig: runtime.getCurrencyConfig,
    STEAM_REVIEW_BATCH_SIZE: http.STEAM_REVIEW_BATCH_SIZE,
    STEAM_REVIEW_BATCH_DELAY_MS: http.STEAM_REVIEW_BATCH_DELAY_MS,
    ENRICHED_DEAL_CACHE_TTL_MS: http.ENRICHED_DEAL_CACHE_TTL_MS,
    ENRICHED_DEAL_CACHE_MAX_SIZE: http.ENRICHED_DEAL_CACHE_MAX_SIZE,
    STEAM_SPECIALS_LIMIT: http.STEAM_SPECIALS_LIMIT,
    EPIC_SPECIALS_LIMIT: http.EPIC_SPECIALS_LIMIT,
    MAX_DEALS: http.MAX_DEALS,
    httpReq: http.httpReq,
    normalizeTitleForDedupe: http.normalizeTitleForDedupe,
    trackInflight: http.trackInflight,
    withInflightTimeout: http.withInflightTimeout,
    extractOfferEndFromHtml: steam.extractOfferEndFromHtml
  });
  return Object.freeze({
    USER_AGENTS: http.USER_AGENTS,
    MAX_HTML_BYTES: http.MAX_HTML_BYTES,
    MAX_JSON_BYTES: http.MAX_JSON_BYTES,
    MAX_DEALS: http.MAX_DEALS,
    FETCH_CONCURRENCY: http.FETCH_CONCURRENCY,
    cleanText: http.cleanText,
    truncate: http.truncate,
    normalizeTitleForDedupe: http.normalizeTitleForDedupe,
    stableUpdateId: http.stableUpdateId,
    normalizeUpdate: http.normalizeUpdate,
    safeCheerioLoad: http.safeCheerioLoad,
    levenshtein: steam.levenshtein,
    httpReq: http.httpReq,
    fetchWithProxy: http.fetchWithProxy,
    dealHash: http.dealHash,
    attachMetrics: http.attachMetrics,
    fetchGameUpdate: updates.fetchGameUpdate,
    executeFetchWithCircuitBreaker: updates.executeFetchWithCircuitBreaker,
    getLatestForAllGames: updates.getLatestForAllGames,
    fetchSteamReviewData: deals.fetchSteamReviewData,
    enrichDealData: deals.enrichDealData,
    fetchDeals: deals.fetchDeals,
    searchSteamGameByName: steam.searchSteamGameByName,
    chooseBestSteamMatch: steam.chooseBestSteamMatch,
    fetchSteamPriceDetails: steam.fetchSteamPriceDetails,
    fetchSteamCurrentPlayers: steam.fetchSteamCurrentPlayers,
    fetchSteamLatestUpdateSize: steam.fetchSteamLatestUpdateSize,
    extractOfferEndFromHtml: steam.extractOfferEndFromHtml,
    extractSteamOfferEndDate: steam.extractSteamOfferEndDate,
    cleanEnrichedCache: deals.cleanEnrichedCache,
    getEnrichedCacheSize: deals.getEnrichedCacheSize,
    formatPrice: runtime.formatPrice
  });
}
