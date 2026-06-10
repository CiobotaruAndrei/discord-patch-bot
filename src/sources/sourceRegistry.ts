"use strict";

import type { CheerioAPI } from "cheerio";
import type { DealInfo, NormalizedUpdate, PatchUpdate } from "../types";
import type { DealsApi, SteamSourceApi, UpdatesApi } from "./sourceApis";
import { assertNoUndefinedExports } from "../shared/assertCompleteExports";

type SourceRegistryApi = {
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
  httpReq: (method: string, url: string, options?: unknown, retries?: number, backoff?: number) => Promise<{ data: unknown }>;
  fetchWithProxy: (targetUrl: string, options?: unknown) => Promise<string>;
  dealHash: (deal: DealInfo) => string;
  attachMetrics: (metricsRef: unknown) => void;
  fetchGameUpdate: UpdatesApi["fetchGameUpdate"];
  executeFetchWithCircuitBreaker: UpdatesApi["executeFetchWithCircuitBreaker"];
  getLatestForAllGames: UpdatesApi["getLatestForAllGames"];
  fetchSteamReviewData: DealsApi["fetchSteamReviewData"];
  enrichDealData: DealsApi["enrichDealData"];
  fetchDeals: DealsApi["fetchDeals"];
  searchSteamGameByName: SteamSourceApi["searchSteamGameByName"];
  chooseBestSteamMatch: SteamSourceApi["chooseBestSteamMatch"];
  fetchSteamPriceDetails: SteamSourceApi["fetchSteamPriceDetails"];
  extractOfferEndFromHtml: SteamSourceApi["extractOfferEndFromHtml"];
  extractSteamOfferEndDate: SteamSourceApi["extractSteamOfferEndDate"];
  cleanEnrichedCache: DealsApi["cleanEnrichedCache"];
  getEnrichedCacheSize: DealsApi["getEnrichedCacheSize"];
  formatPrice: (value: unknown, currencyCode?: unknown) => string;
};

type SourceContext = SourceRegistryApi;

type SourceInstaller = (target: SourceContext) => void;

const runtimeContext = require("./runtime") as SourceContext;
const defaultInstallers: SourceInstaller[] = [
  require("../infra/http/client"),
  require("./steam"),
  require("./updates"),
  require("./deals")
];

function buildSourceRegistry(context: SourceContext): SourceRegistryApi {
  return {
    USER_AGENTS: context.USER_AGENTS,
    MAX_HTML_BYTES: context.MAX_HTML_BYTES,
    MAX_JSON_BYTES: context.MAX_JSON_BYTES,
    MAX_DEALS: context.MAX_DEALS,
    FETCH_CONCURRENCY: context.FETCH_CONCURRENCY,
    cleanText: context.cleanText,
    truncate: context.truncate,
    normalizeTitleForDedupe: context.normalizeTitleForDedupe,
    stableUpdateId: context.stableUpdateId,
    normalizeUpdate: context.normalizeUpdate,
    safeCheerioLoad: context.safeCheerioLoad,
    levenshtein: context.levenshtein,
    httpReq: context.httpReq,
    fetchWithProxy: context.fetchWithProxy,
    dealHash: context.dealHash,
    attachMetrics: context.attachMetrics,
    fetchGameUpdate: context.fetchGameUpdate,
    executeFetchWithCircuitBreaker: context.executeFetchWithCircuitBreaker,
    getLatestForAllGames: context.getLatestForAllGames,
    fetchSteamReviewData: context.fetchSteamReviewData,
    enrichDealData: context.enrichDealData,
    fetchDeals: context.fetchDeals,
    searchSteamGameByName: context.searchSteamGameByName,
    chooseBestSteamMatch: context.chooseBestSteamMatch,
    fetchSteamPriceDetails: context.fetchSteamPriceDetails,
    extractOfferEndFromHtml: context.extractOfferEndFromHtml,
    extractSteamOfferEndDate: context.extractSteamOfferEndDate,
    cleanEnrichedCache: context.cleanEnrichedCache,
    getEnrichedCacheSize: context.getEnrichedCacheSize,
    formatPrice: context.formatPrice
  };
}

function createSourceRegistry(
  baseContext: SourceContext = runtimeContext,
  installers: SourceInstaller[] = defaultInstallers
) {
  const context = baseContext;
  for (const install of installers) install(context);
  return buildSourceRegistry(context);
}

const registry = assertNoUndefinedExports(createSourceRegistry(), "sourceRegistry");

Object.assign(module.exports, registry, { createSourceRegistry });

export { createSourceRegistry };
export type { SourceRegistryApi };
export const dealHash = registry.dealHash;
export const extractOfferEndFromHtml = registry.extractOfferEndFromHtml;
export const safeCheerioLoad = registry.safeCheerioLoad;
export const MAX_HTML_BYTES = registry.MAX_HTML_BYTES;
