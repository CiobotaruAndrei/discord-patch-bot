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

type SourceRuntimeContext = Partial<SourceRegistryApi> & typeof import("./runtime") & Record<string, unknown>;
type SourceInstaller = (target: SourceRuntimeContext) => void;

import attachHttpClient = require("../infra/http/client");
import attachSteam = require("./steam");
import attachUpdates = require("./updates");
import attachDeals = require("./deals");

const runtimeContext = require("./runtime") as SourceRuntimeContext;
const defaultInstallers: SourceInstaller[] = [
  attachHttpClient,
  attachSteam,
  attachUpdates,
  attachDeals
];

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

function createSourceRegistry(
  baseContext: SourceRuntimeContext = freshSourceContext(),
  installers: SourceInstaller[] = defaultInstallers
) {
  const context = baseContext;
  for (const install of installers) install(context);
  return assertNoUndefinedExports(buildSourceRegistry(context), "sourceRegistry");
}

const registry = createSourceRegistry();

Object.assign(module.exports, registry, { createSourceRegistry });

export { createSourceRegistry };
export type { SourceRegistryApi };
export const dealHash = registry.dealHash;
export const extractOfferEndFromHtml = registry.extractOfferEndFromHtml;
export const safeCheerioLoad = registry.safeCheerioLoad;
export const MAX_HTML_BYTES = registry.MAX_HTML_BYTES;
