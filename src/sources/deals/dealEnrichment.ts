import type { CurrencyConfig, DealInfo, LoggerFunction } from "../../types";
import { errorMessage } from "../../shared/errors";
import type { DealCurrencyCode, HttpReq, WithInflightTimeout } from "./dealHelpers";

interface EnrichedCacheEntry {
  enriched: DealInfo;
  currency: string;
  expiresAt: number;
}

interface SteamAppDetailsPayload {
  platforms?: {
    windows?: boolean;
    mac?: boolean;
    linux?: boolean;
  };
}

type SteamAppDetailsResponse = Record<string, { data?: SteamAppDetailsPayload } | undefined>;

const enrichedCache = new Map<string, EnrichedCacheEntry>();

export interface DealEnrichmentDeps {
  httpReq: HttpReq;
  logger: LoggerFunction;
  getCurrencyConfig: (code?: DealCurrencyCode) => CurrencyConfig;
  withInflightTimeout: WithInflightTimeout;
  extractOfferEndFromHtml: (html: unknown) => string | null;
  ENRICHED_DEAL_CACHE_TTL_MS: number;
  ENRICHED_DEAL_CACHE_MAX_SIZE: number;
}

export function createDealEnrichment(deps: DealEnrichmentDeps) {
  const activeEnrichments = new Map<string, Promise<DealInfo>>();

  function enrichCacheKey(dealId: unknown, currency: string): string {
    return `${String(dealId)}:${currency}`;
  }

  function enrichCacheGet(dealId: unknown, currency: string): DealInfo | null {
    const key = enrichCacheKey(dealId, currency);
    const v = enrichedCache.get(key);
    if (!v) return null;
    if (v.expiresAt < Date.now()) { enrichedCache.delete(key); return null; }
    enrichedCache.delete(key);
    enrichedCache.set(key, v);
    return v.enriched;
  }

  function enrichCacheSet(dealId: unknown, enriched: DealInfo, currency: string): void {
    const { ENRICHED_DEAL_CACHE_MAX_SIZE, ENRICHED_DEAL_CACHE_TTL_MS } = deps;
    if (ENRICHED_DEAL_CACHE_MAX_SIZE === 0 || ENRICHED_DEAL_CACHE_TTL_MS === 0) return;
    const key = enrichCacheKey(dealId, currency);
    if (enrichedCache.has(key)) enrichedCache.delete(key);
    enrichedCache.set(key, {
      enriched,
      currency,
      expiresAt: Date.now() + ENRICHED_DEAL_CACHE_TTL_MS
    });
    while (enrichedCache.size > ENRICHED_DEAL_CACHE_MAX_SIZE) {
      const oldest = enrichedCache.keys().next().value;
      if (oldest === undefined) break;
      enrichedCache.delete(oldest);
    }
  }

  function cleanEnrichedCache(): void {
    const now = Date.now();
    for (const [k, v] of enrichedCache.entries()) {
      if (v.expiresAt < now) enrichedCache.delete(k);
    }
  }

  function getEnrichedCacheSize(): number {
    return enrichedCache.size;
  }

  async function enrichDealData(deal: DealInfo, currencyCode?: DealCurrencyCode): Promise<DealInfo> {
    const {
      getCurrencyConfig,
      httpReq,
      logger,
      withInflightTimeout,
      extractOfferEndFromHtml
    } = deps;
    const currency = String(currencyCode || "USD").toUpperCase();
    if (deal.enriched) return deal;

    const cached = enrichCacheGet(deal.id, currency);
    if (cached) return cached;

    const inflightKey = `${deal.id}:${currency}`;
    const existing = activeEnrichments.get(inflightKey);
    if (existing) return existing;

    const enrichTask = withInflightTimeout((async () => {
      const enriched: DealInfo = { ...deal };
      if (enriched.store === "Steam" && enriched.steamAppID) {
        const cfg = getCurrencyConfig(currency);
        try {
          let htmlUrl: string;
          try {
            const u = new URL(String(enriched.link));
            u.searchParams.set("cc", cfg.cc);
            u.searchParams.set("l", "english");
            htmlUrl = u.href;
          } catch {

            htmlUrl = `${enriched.link}?cc=${cfg.cc}&l=english`;
          }
          const detailsUrl = new URL("https://store.steampowered.com/api/appdetails");
          detailsUrl.searchParams.set("appids", String(enriched.steamAppID));
          detailsUrl.searchParams.set("cc", cfg.cc);
          detailsUrl.searchParams.set("l", "english");
          const [detailsRes, htmlRes] = await Promise.all([
            httpReq("GET", detailsUrl.toString(),
              { timeout: 5000, largeJson: true }).catch(e => {
                logger("WARN", "STEAM_ENRICH", `appdetails fail appID ${enriched.steamAppID}`, errorMessage(e));
                return null;
              }),
            httpReq("GET", htmlUrl, {
              headers: { "Cookie": "birthtime=283993201; mature_content=1;" }
            }).catch(e => {
              logger("WARN", "STEAM_ENRICH", `html fetch fail appID ${enriched.steamAppID}`, errorMessage(e));
              return null;
            })
          ]);

          const data = detailsRes ? (detailsRes.data as SteamAppDetailsResponse)[String(enriched.steamAppID)]?.data : undefined;
          if (data && data.platforms) {
            const platformList = [
              data.platforms.windows ? "Win" : "",
              data.platforms.mac ? "Mac" : "",
              data.platforms.linux ? "Lin" : ""
            ].filter(Boolean);
            if (platformList.length > 0) {
              const platformLine = `**Platforme:** ${platformList.join(", ")}`;
              enriched.extraDetails = enriched.extraDetails
                ? `${enriched.extraDetails}\n${platformLine}`
                : platformLine;
            }
          }
          if (htmlRes?.data) {
            const end = extractOfferEndFromHtml(String(htmlRes.data));
            if (end) enriched.endDateStr = end;
          }
        } catch (e) {
          logger("WARN", "STEAM_ENRICH", `Eroare enrich oferta Steam appID ${enriched.steamAppID}`, errorMessage(e));
        }
      }
      enriched.enriched = true;
      enrichCacheSet(deal.id, enriched, currency);
      return enriched;
    })(), `enrichDealData(${deal.id})`);

    activeEnrichments.set(inflightKey, enrichTask);
    try {
      return await enrichTask;
    } finally {
      activeEnrichments.delete(inflightKey);
    }
  }

  return { enrichCacheGet, enrichCacheSet, cleanEnrichedCache, getEnrichedCacheSize, enrichDealData };
}
