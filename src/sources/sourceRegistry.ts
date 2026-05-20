"use strict";

const ctx = require("./runtime");

require("../infra/http/client")(ctx);
require("./steam")(ctx);
require("./updates")(ctx);
require("./deals")(ctx);

module.exports = {
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

export const dealHash = ctx.dealHash;
export const extractOfferEndFromHtml = ctx.extractOfferEndFromHtml;
export const safeCheerioLoad = ctx.safeCheerioLoad;
export const MAX_HTML_BYTES = ctx.MAX_HTML_BYTES;
