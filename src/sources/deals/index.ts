import type {
  CurrencyConfig,
  DealInfo,
  FetchDealsOptions,
  LoggerFunction
} from "../../types";
import type { DealsApi } from "../sourceApis";
import type { DealCurrencyCode, HttpReq, TrackInflight, WithInflightTimeout } from "./dealHelpers";
import { dedupeAndRankDeals } from "./dealHelpers";
import { createSteamDeals } from "./steamDeals";
import { createEpicDeals } from "./epicDeals";
import { createDealEnrichment } from "./dealEnrichment";

interface DealsDeps {
  logger: LoggerFunction;
  getCurrencyConfig: (code?: DealCurrencyCode) => CurrencyConfig;
  STEAM_REVIEW_BATCH_SIZE: number;
  STEAM_REVIEW_BATCH_DELAY_MS: number;
  ENRICHED_DEAL_CACHE_TTL_MS: number;
  ENRICHED_DEAL_CACHE_MAX_SIZE: number;
  STEAM_SPECIALS_LIMIT: number;
  EPIC_SPECIALS_LIMIT: number;
  MAX_DEALS: number;
  httpReq: HttpReq;
  normalizeTitleForDedupe: (value: unknown) => string;
  trackInflight: TrackInflight;
  withInflightTimeout: WithInflightTimeout;
  extractOfferEndFromHtml: (html: unknown) => string | null;
}

type DealsContext = DealsDeps & Partial<DealsApi>;

function createDeals(d: DealsDeps): DealsApi {
  const deps = d;
  const inflightDeals = new Map<string, Promise<DealInfo[]>>();

  const { fetchSteamReviewData, fetchSteamSpecials } = createSteamDeals({
    httpReq: deps.httpReq,
    logger: deps.logger,
    STEAM_SPECIALS_LIMIT: deps.STEAM_SPECIALS_LIMIT,
    STEAM_REVIEW_BATCH_SIZE: deps.STEAM_REVIEW_BATCH_SIZE,
    STEAM_REVIEW_BATCH_DELAY_MS: deps.STEAM_REVIEW_BATCH_DELAY_MS
  });

  const { fetchEpicSpecials } = createEpicDeals({
    httpReq: deps.httpReq,
    logger: deps.logger,
    EPIC_SPECIALS_LIMIT: deps.EPIC_SPECIALS_LIMIT
  });

  const {
    enrichCacheGet,
    enrichCacheSet,
    cleanEnrichedCache,
    getEnrichedCacheSize,
    enrichDealData
  } = createDealEnrichment({
    httpReq: deps.httpReq,
    logger: deps.logger,
    getCurrencyConfig: deps.getCurrencyConfig,
    withInflightTimeout: deps.withInflightTimeout,
    extractOfferEndFromHtml: deps.extractOfferEndFromHtml,
    ENRICHED_DEAL_CACHE_TTL_MS: deps.ENRICHED_DEAL_CACHE_TTL_MS,
    ENRICHED_DEAL_CACHE_MAX_SIZE: deps.ENRICHED_DEAL_CACHE_MAX_SIZE
  });

  async function _fetchDealsImpl(currencyCode: DealCurrencyCode): Promise<DealInfo[]> {
    const { getCurrencyConfig, normalizeTitleForDedupe, MAX_DEALS } = deps;
    const cfg = getCurrencyConfig(currencyCode);
    const cc = cfg.cc;

    const [steamSpecials, epicSpecials] = await Promise.all([
      fetchSteamSpecials(cc, currencyCode),
      fetchEpicSpecials(cc, currencyCode)
    ]);
    const deals: DealInfo[] = [...steamSpecials, ...epicSpecials];

    const finalTop = dedupeAndRankDeals(deals, normalizeTitleForDedupe, MAX_DEALS);
    if (!finalTop.length) throw new Error("Fără oferte valide.");
    return finalTop;
  }

  async function fetchDeals(opts: FetchDealsOptions = {}): Promise<DealInfo[]> {
    const { logger, withInflightTimeout, trackInflight } = deps;
    const currency = String(opts.currency || "USD").toUpperCase();
    const contextKey = `${opts.fromCron ? "cron" : "manual"}:${currency}`;
    const existing = inflightDeals.get(contextKey);
    if (existing) {
      logger("INFO", "FETCH_COALESCE", `Refolosesc fetchDeals în curs (context=${contextKey})`);
      return existing;
    }
    const promise = withInflightTimeout(
      _fetchDealsImpl(currency),
      `fetchDeals(${contextKey})`
    );
    trackInflight(inflightDeals, contextKey, promise);
    return promise;
  }

  return {
      fetchSteamReviewData,
      enrichCacheGet,
      enrichCacheSet,
      cleanEnrichedCache,
      getEnrichedCacheSize,
      enrichDealData,
      fetchDeals
    };
}

function buildDealsFrom(target: DealsContext) {
  return createDeals({
    logger: target.logger,
    getCurrencyConfig: target.getCurrencyConfig,
    httpReq: target.httpReq,
    normalizeTitleForDedupe: target.normalizeTitleForDedupe,
    trackInflight: target.trackInflight,
    withInflightTimeout: target.withInflightTimeout,
    extractOfferEndFromHtml: target.extractOfferEndFromHtml,
    STEAM_REVIEW_BATCH_SIZE: target.STEAM_REVIEW_BATCH_SIZE,
    STEAM_REVIEW_BATCH_DELAY_MS: target.STEAM_REVIEW_BATCH_DELAY_MS,
    ENRICHED_DEAL_CACHE_TTL_MS: target.ENRICHED_DEAL_CACHE_TTL_MS,
    ENRICHED_DEAL_CACHE_MAX_SIZE: target.ENRICHED_DEAL_CACHE_MAX_SIZE,
    STEAM_SPECIALS_LIMIT: target.STEAM_SPECIALS_LIMIT,
    EPIC_SPECIALS_LIMIT: target.EPIC_SPECIALS_LIMIT,
    MAX_DEALS: target.MAX_DEALS
  });
}

const dealsSourceModule = {
  buildFrom: buildDealsFrom,
  createDeals
};

export default dealsSourceModule;
