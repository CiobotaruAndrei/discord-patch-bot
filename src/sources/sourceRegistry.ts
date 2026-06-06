"use strict";

import { assertNoUndefinedExports } from "../shared/assertCompleteExports";

type SourceContext = Record<string, unknown>;
type SourceInstaller = (target: SourceContext) => void;

type SourceRegistryExportKey =
  | "USER_AGENTS" | "MAX_HTML_BYTES" | "MAX_JSON_BYTES" | "MAX_DEALS" | "FETCH_CONCURRENCY"
  | "cleanText" | "truncate" | "normalizeTitleForDedupe" | "stableUpdateId" | "normalizeUpdate"
  | "safeCheerioLoad" | "levenshtein" | "httpReq" | "fetchWithProxy" | "dealHash"
  | "attachMetrics" | "fetchGameUpdate" | "executeFetchWithCircuitBreaker" | "getLatestForAllGames"
  | "fetchSteamReviewData" | "enrichDealData" | "fetchDeals" | "searchSteamGameByName"
  | "chooseBestSteamMatch" | "fetchSteamPriceDetails" | "extractOfferEndFromHtml"
  | "extractSteamOfferEndDate" | "cleanEnrichedCache" | "getEnrichedCacheSize" | "formatPrice";

const runtimeContext = require("./runtime") as SourceContext;
const defaultInstallers: SourceInstaller[] = [
  require("../infra/http/client"),
  require("./steam"),
  require("./updates"),
  require("./deals")
];

function buildSourceRegistry(context: SourceContext): Record<SourceRegistryExportKey, unknown> {
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
export const dealHash = registry.dealHash;
export const extractOfferEndFromHtml = registry.extractOfferEndFromHtml;
export const safeCheerioLoad = registry.safeCheerioLoad;
export const MAX_HTML_BYTES = registry.MAX_HTML_BYTES;
