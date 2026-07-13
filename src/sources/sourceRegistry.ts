"use strict";

import type { CheerioAPI } from "cheerio";
import type { CurrencyCode, DealInfo, NormalizedUpdate, PatchUpdate, PriceValue, HttpRequestOptions } from "../types";
import type { HttpMetricsRef } from "../infra/http/httpMetrics";
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

type SourceRuntimeContext = Partial<SourceRegistryApi> & typeof import("./runtime")["default"];

import attachHttpClient from "../infra/http/client";
import attachSteam from "./steam";
import attachUpdates from "./updates";
import attachDeals from "./deals";

import runtimeContext from "./runtime";

function requireSourceValue<K extends keyof SourceRegistryApi>(context: Partial<SourceRegistryApi>, key: K): SourceRegistryApi[K] {
  const value = context[key];
  if (value === undefined) {
    throw new Error(`sourceRegistry nu a primit exportul necesar din context: ${String(key)}`);
  }
  return value;
}

function buildSourceRegistry(context: Partial<SourceRegistryApi>): SourceRegistryApi {
  return {
    USER_AGENTS: requireSourceValue(context, "USER_AGENTS"),
    MAX_HTML_BYTES: requireSourceValue(context, "MAX_HTML_BYTES"),
    MAX_JSON_BYTES: requireSourceValue(context, "MAX_JSON_BYTES"),
    MAX_DEALS: requireSourceValue(context, "MAX_DEALS"),
    FETCH_CONCURRENCY: requireSourceValue(context, "FETCH_CONCURRENCY"),
    cleanText: requireSourceValue(context, "cleanText"),
    truncate: requireSourceValue(context, "truncate"),
    normalizeTitleForDedupe: requireSourceValue(context, "normalizeTitleForDedupe"),
    stableUpdateId: requireSourceValue(context, "stableUpdateId"),
    normalizeUpdate: requireSourceValue(context, "normalizeUpdate"),
    safeCheerioLoad: requireSourceValue(context, "safeCheerioLoad"),
    levenshtein: requireSourceValue(context, "levenshtein"),
    httpReq: requireSourceValue(context, "httpReq"),
    fetchWithProxy: requireSourceValue(context, "fetchWithProxy"),
    dealHash: requireSourceValue(context, "dealHash"),
    attachMetrics: requireSourceValue(context, "attachMetrics"),
    fetchGameUpdate: requireSourceValue(context, "fetchGameUpdate"),
    executeFetchWithCircuitBreaker: requireSourceValue(context, "executeFetchWithCircuitBreaker"),
    getLatestForAllGames: requireSourceValue(context, "getLatestForAllGames"),
    fetchSteamReviewData: requireSourceValue(context, "fetchSteamReviewData"),
    enrichDealData: requireSourceValue(context, "enrichDealData"),
    fetchDeals: requireSourceValue(context, "fetchDeals"),
    searchSteamGameByName: requireSourceValue(context, "searchSteamGameByName"),
    chooseBestSteamMatch: requireSourceValue(context, "chooseBestSteamMatch"),
    fetchSteamPriceDetails: requireSourceValue(context, "fetchSteamPriceDetails"),
    fetchSteamCurrentPlayers: requireSourceValue(context, "fetchSteamCurrentPlayers"),
    extractOfferEndFromHtml: requireSourceValue(context, "extractOfferEndFromHtml"),
    extractSteamOfferEndDate: requireSourceValue(context, "extractSteamOfferEndDate"),
    cleanEnrichedCache: requireSourceValue(context, "cleanEnrichedCache"),
    getEnrichedCacheSize: requireSourceValue(context, "getEnrichedCacheSize"),
    formatPrice: requireSourceValue(context, "formatPrice")
  };
}

function freshSourceContext(): SourceRuntimeContext {
  return { ...runtimeContext };
}

function createSourceRegistry(): SourceRegistryApi {
  const base = freshSourceContext();
  const withHttp = { ...base, ...attachHttpClient.buildFrom(base) };
  const withSteam = { ...withHttp, ...attachSteam.buildFrom(withHttp) };
  const withUpdates = { ...withSteam, ...attachUpdates.buildFrom(withSteam) };
  const withDeals = { ...withUpdates, ...attachDeals.buildFrom(withUpdates) };
  return Object.freeze(assertNoUndefinedExports(buildSourceRegistry(withDeals), "sourceRegistry"));
}

const registry = createSourceRegistry();

export { createSourceRegistry };
export type { SourceRegistryApi };
export const dealHash = registry.dealHash;
export const extractOfferEndFromHtml = registry.extractOfferEndFromHtml;
export const fetchSteamCurrentPlayers = registry.fetchSteamCurrentPlayers;
export const safeCheerioLoad = registry.safeCheerioLoad;
export const MAX_HTML_BYTES = registry.MAX_HTML_BYTES;
export const MAX_JSON_BYTES = registry.MAX_JSON_BYTES;
export const MAX_DEALS = registry.MAX_DEALS;
export const FETCH_CONCURRENCY = registry.FETCH_CONCURRENCY;
export const USER_AGENTS = registry.USER_AGENTS;
export const attachMetrics = registry.attachMetrics;
export const cleanEnrichedCache = registry.cleanEnrichedCache;
export const getEnrichedCacheSize = registry.getEnrichedCacheSize;

export const cleanText = registry.cleanText;
export const truncate = registry.truncate;
export const normalizeTitleForDedupe = registry.normalizeTitleForDedupe;
export const stableUpdateId = registry.stableUpdateId;
export const normalizeUpdate = registry.normalizeUpdate;
export const levenshtein = registry.levenshtein;
export const httpReq = registry.httpReq;
export const fetchWithProxy = registry.fetchWithProxy;
export const fetchGameUpdate = registry.fetchGameUpdate;
export const executeFetchWithCircuitBreaker = registry.executeFetchWithCircuitBreaker;
export const getLatestForAllGames = registry.getLatestForAllGames;
export const fetchSteamReviewData = registry.fetchSteamReviewData;
export const enrichDealData = registry.enrichDealData;
export const fetchDeals = registry.fetchDeals;
export const searchSteamGameByName = registry.searchSteamGameByName;
export const chooseBestSteamMatch = registry.chooseBestSteamMatch;
export const fetchSteamPriceDetails = registry.fetchSteamPriceDetails;
export const extractSteamOfferEndDate = registry.extractSteamOfferEndDate;
export const formatPrice = registry.formatPrice;
export default registry;
