"use strict";

import type { SourceRegistryApi } from "./sourceRegistryFactory.js";

type Port<K extends keyof SourceRegistryApi> = Pick<SourceRegistryApi, K>;

export type HttpSourcePort = Port<
  | "USER_AGENTS"
  | "MAX_HTML_BYTES"
  | "MAX_JSON_BYTES"
  | "FETCH_CONCURRENCY"
  | "httpReq"
  | "fetchWithProxy"
  | "safeCheerioLoad"
  | "attachMetrics"
>;

export type SteamSourcePort = Port<
  | "searchSteamGameByName"
  | "chooseBestSteamMatch"
  | "fetchSteamPriceDetails"
  | "fetchSteamCurrentPlayers"
  | "fetchSteamLatestUpdateSize"
  | "extractOfferEndFromHtml"
  | "extractSteamOfferEndDate"
  | "levenshtein"
>;

export type UpdatesSourcePort = Port<
  "fetchGameUpdate" | "executeFetchWithCircuitBreaker" | "getLatestForAllGames" | "normalizeUpdate" | "stableUpdateId"
>;

export type DealsSourcePort = Port<
  | "MAX_DEALS"
  | "fetchDeals"
  | "fetchSteamReviewData"
  | "enrichDealData"
  | "dealHash"
  | "cleanEnrichedCache"
  | "getEnrichedCacheSize"
  | "formatPrice"
>;

export const SOURCE_PORT_NAMES = [
  "HttpSourcePort",
  "SteamSourcePort",
  "UpdatesSourcePort",
  "DealsSourcePort"
] as const;

export type SourcePortName = (typeof SOURCE_PORT_NAMES)[number];
