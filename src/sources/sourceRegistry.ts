import { createSourceRegistry as createRegistry } from "./sourceRegistryFactory.js";
import type { SourceRuntimeDeps } from "./runtime.js";
import mongoContext from "../infra/mongo/mongoContext.js";
import { createCircuitBreakerStore } from "./updates/circuitBreakerStore.js";

const sourceRuntimeDeps: SourceRuntimeDeps = {
  env: mongoContext.env,
  logger: mongoContext.logger,
  getAbortSignal: mongoContext.getAbortSignal,
  getCurrencyConfig: mongoContext.getCurrencyConfig,
  formatPrice: mongoContext.formatPrice,
  runConcurrent: mongoContext.runConcurrent,
  adminAlert: mongoContext.adminAlert,
  SchemaDriftError: mongoContext.SchemaDriftError,
  circuitBreakerStore: createCircuitBreakerStore(mongoContext.CircuitBreakerModel)
};
const sourceRegistry = createRegistry(sourceRuntimeDeps);

export type { SourceRegistryApi } from "./sourceRegistryFactory.js";

export function createSourceRegistry(deps: SourceRuntimeDeps = sourceRuntimeDeps) {
  return createRegistry(deps);
}

export const dealHash = sourceRegistry.dealHash;
export const extractOfferEndFromHtml = sourceRegistry.extractOfferEndFromHtml;
export const fetchSteamCurrentPlayers = sourceRegistry.fetchSteamCurrentPlayers;
export const safeCheerioLoad = sourceRegistry.safeCheerioLoad;
export const MAX_HTML_BYTES = sourceRegistry.MAX_HTML_BYTES;
export const MAX_JSON_BYTES = sourceRegistry.MAX_JSON_BYTES;
export const MAX_DEALS = sourceRegistry.MAX_DEALS;
export const FETCH_CONCURRENCY = sourceRegistry.FETCH_CONCURRENCY;
export const USER_AGENTS = sourceRegistry.USER_AGENTS;
export const attachMetrics = sourceRegistry.attachMetrics;
export const cleanEnrichedCache = sourceRegistry.cleanEnrichedCache;
export const getEnrichedCacheSize = sourceRegistry.getEnrichedCacheSize;
export const cleanText = sourceRegistry.cleanText;
export const truncate = sourceRegistry.truncate;
export const normalizeTitleForDedupe = sourceRegistry.normalizeTitleForDedupe;
export const stableUpdateId = sourceRegistry.stableUpdateId;
export const normalizeUpdate = sourceRegistry.normalizeUpdate;
export const levenshtein = sourceRegistry.levenshtein;
export const httpReq = sourceRegistry.httpReq;
export const fetchWithProxy = sourceRegistry.fetchWithProxy;
export const fetchGameUpdate = sourceRegistry.fetchGameUpdate;
export const executeFetchWithCircuitBreaker = sourceRegistry.executeFetchWithCircuitBreaker;
export const getLatestForAllGames = sourceRegistry.getLatestForAllGames;
export const fetchSteamReviewData = sourceRegistry.fetchSteamReviewData;
export const enrichDealData = sourceRegistry.enrichDealData;
export const fetchDeals = sourceRegistry.fetchDeals;
export const searchSteamGameByName = sourceRegistry.searchSteamGameByName;
export const chooseBestSteamMatch = sourceRegistry.chooseBestSteamMatch;
export const fetchSteamPriceDetails = sourceRegistry.fetchSteamPriceDetails;
export const extractSteamOfferEndDate = sourceRegistry.extractSteamOfferEndDate;
export const formatPrice = sourceRegistry.formatPrice;
export default sourceRegistry;
