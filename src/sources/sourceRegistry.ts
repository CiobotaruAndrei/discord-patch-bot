"use strict";

type SourceContext = Record<string, unknown>;
type SourceInstaller = (ctx: SourceContext) => void;

const runtimeCtx = require("./runtime") as SourceContext;
const defaultInstallers: SourceInstaller[] = [
  require("../infra/http/client"),
  require("./steam"),
  require("./updates"),
  require("./deals")
];

function buildSourceRegistry(ctx: SourceContext) {
  return {
    USER_AGENTS: ctx.USER_AGENTS,
    MAX_HTML_BYTES: ctx.MAX_HTML_BYTES,
    MAX_JSON_BYTES: ctx.MAX_JSON_BYTES,
    MAX_DEALS: ctx.MAX_DEALS,
    FETCH_CONCURRENCY: ctx.FETCH_CONCURRENCY,
    cleanText: ctx.cleanText,
    truncate: ctx.truncate,
    normalizeTitleForDedupe: ctx.normalizeTitleForDedupe,
    stableUpdateId: ctx.stableUpdateId,
    normalizeUpdate: ctx.normalizeUpdate,
    safeCheerioLoad: ctx.safeCheerioLoad,
    levenshtein: ctx.levenshtein,
    httpReq: ctx.httpReq,
    fetchWithProxy: ctx.fetchWithProxy,
    dealHash: ctx.dealHash,
    attachMetrics: ctx.attachMetrics,
    fetchGameUpdate: ctx.fetchGameUpdate,
    executeFetchWithCircuitBreaker: ctx.executeFetchWithCircuitBreaker,
    getLatestForAllGames: ctx.getLatestForAllGames,
    fetchSteamReviewData: ctx.fetchSteamReviewData,
    enrichDealData: ctx.enrichDealData,
    fetchDeals: ctx.fetchDeals,
    searchSteamGameByName: ctx.searchSteamGameByName,
    chooseBestSteamMatch: ctx.chooseBestSteamMatch,
    fetchSteamPriceDetails: ctx.fetchSteamPriceDetails,
    extractOfferEndFromHtml: ctx.extractOfferEndFromHtml,
    extractSteamOfferEndDate: ctx.extractSteamOfferEndDate,
    cleanEnrichedCache: ctx.cleanEnrichedCache,
    getEnrichedCacheSize: ctx.getEnrichedCacheSize,
    formatPrice: ctx.formatPrice
  };
}

function createSourceRegistry(
  baseContext: SourceContext = runtimeCtx,
  installers: SourceInstaller[] = defaultInstallers
) {
  const ctx = baseContext;
  for (const install of installers) install(ctx);
  return buildSourceRegistry(ctx);
}

const registry = createSourceRegistry();

Object.assign(module.exports, registry, { createSourceRegistry });

export { createSourceRegistry };
export const dealHash = registry.dealHash;
export const extractOfferEndFromHtml = registry.extractOfferEndFromHtml;
export const safeCheerioLoad = registry.safeCheerioLoad;
export const MAX_HTML_BYTES = registry.MAX_HTML_BYTES;
