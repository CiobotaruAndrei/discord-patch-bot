import type {
  CurrencyCode,
  CurrencyConfig,
  DealInfo,
  FetchDealsOptions,
  HttpRequestOptions,
  LoggerFunction,
  SteamReviewData
} from "../../types";
import { errorMessage } from "../../shared/errors";

type DealCurrencyCode = CurrencyCode | string | null | undefined;
type HttpResponse<T = unknown> = { data: T };
type HttpReq = (
  method: string,
  url: string,
  options?: HttpRequestOptions,
  retries?: number,
  backoff?: number
) => Promise<HttpResponse<unknown>>;
type TrackInflight = <T>(map: Map<string, Promise<T>>, key: string, promise: Promise<T>) => void;
type WithInflightTimeout = <T>(promise: Promise<T>, label: string) => Promise<T>;

interface EnrichedCacheEntry {
  enriched: DealInfo;
  currency: string;
  expiresAt: number;
}

interface SteamReviewResponse {
  query_summary?: {
    total_reviews?: number;
    total_positive?: number;
  };
}

interface SteamAppDetailsPayload {
  platforms?: {
    windows?: boolean;
    mac?: boolean;
    linux?: boolean;
  };
}

type SteamAppDetailsResponse = Record<string, { data?: SteamAppDetailsPayload } | undefined>;

interface SteamFeaturedCategoriesResponse {
  specials?: {
    items?: SteamSpecialItem[];
  };
}

interface EpicGraphqlResponse {
  data?: {
    Catalog?: {
      searchStore?: {
        elements?: EpicStoreElement[];
      };
    };
  };
}

interface SteamSpecialItem {
  id: string | number;
  name?: string;
  original_price?: number;
  final_price?: number;
  discount_percent?: number;
  header_image?: string | null;
}

interface EpicStoreElement {
  id?: string;
  title?: string;
  urlSlug?: string;
  keyImages?: Array<{ type?: string; url?: string }>;
  price?: {
    totalPrice?: {
      discountPrice?: number;
      originalPrice?: number;
    };
  };
  promotions?: {
    promotionalOffers?: Array<{
      promotionalOffers?: Array<{
        endDate?: string;
      }>;
    }>;
  };
}

interface DealsContext {
  logger: LoggerFunction;
  getCurrencyConfig: (code?: DealCurrencyCode) => CurrencyConfig;
  formatPrice?: (value: unknown, currencyCode?: DealCurrencyCode) => string;
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
  fetchSteamReviewData?: typeof fetchSteamReviewData;
  enrichCacheGet?: typeof enrichCacheGet;
  enrichCacheSet?: typeof enrichCacheSet;
  cleanEnrichedCache?: typeof cleanEnrichedCache;
  getEnrichedCacheSize?: typeof getEnrichedCacheSize;
  enrichDealData?: typeof enrichDealData;
  fetchDeals?: typeof fetchDeals;
  [key: string]: unknown;
}

let runtimeContext: DealsContext;
const activeEnrichments = new Map<string, Promise<DealInfo>>();
const enrichedCache = new Map<string, EnrichedCacheEntry>();
const inflightDeals = new Map<string, Promise<DealInfo[]>>();

async function fetchSteamReviewData(appId: string | number): Promise<SteamReviewData> {
  const { httpReq, logger } = runtimeContext;
  try {
    const res = await httpReq("GET",
      `https://store.steampowered.com/appreviews/${appId}?json=1&language=all&num_per_page=0`,
      { largeJson: true }, 3, 800);
    const summary = (res.data as SteamReviewResponse).query_summary;
    if (summary) {
      const totalReviews = summary.total_reviews || 0;
      const positiveReviews = summary.total_positive || 0;
      const qualityPercent = totalReviews > 0 ? Math.round((positiveReviews / totalReviews) * 100) : 0;
      return { totalReviews, qualityPercent, success: true };
    }
    return { totalReviews: 0, qualityPercent: 0, success: false };
  } catch (err) {
    logger("WARN", "STEAM_REVIEW", `Eroare preluare review Steam appID ${appId}`, errorMessage(err));
    return { totalReviews: 0, qualityPercent: 0, success: false };
  }
}

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
  const { ENRICHED_DEAL_CACHE_MAX_SIZE, ENRICHED_DEAL_CACHE_TTL_MS } = runtimeContext;
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
  } = runtimeContext;
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

async function _fetchDealsImpl(currencyCode: DealCurrencyCode): Promise<DealInfo[]> {
  const {
    getCurrencyConfig,
    httpReq,
    logger,
    normalizeTitleForDedupe,
    STEAM_SPECIALS_LIMIT,
    STEAM_REVIEW_BATCH_SIZE,
    STEAM_REVIEW_BATCH_DELAY_MS,
    EPIC_SPECIALS_LIMIT,
    MAX_DEALS
  } = runtimeContext;
  const cfg = getCurrencyConfig(currencyCode);
  const cc = cfg.cc;

  const deals: DealInfo[] = [];
  try {
    const steamRes = await httpReq("GET",
      `https://store.steampowered.com/api/featuredcategories/?cc=${cc}&l=english`,
      { largeJson: true });
    const steamSpecials = ((steamRes.data as SteamFeaturedCategoriesResponse).specials?.items || []).slice(0, STEAM_SPECIALS_LIMIT);

    const reviewsData: SteamReviewData[] = [];
    for (let i = 0; i < steamSpecials.length; i += STEAM_REVIEW_BATCH_SIZE) {
      const chunk = steamSpecials.slice(i, i + STEAM_REVIEW_BATCH_SIZE);
      const chunkPromises = chunk.map(item => fetchSteamReviewData(item.id));
      const chunkResults = await Promise.all(chunkPromises);
      reviewsData.push(...chunkResults);
      const isLastBatch = i + STEAM_REVIEW_BATCH_SIZE >= steamSpecials.length;
      if (STEAM_REVIEW_BATCH_DELAY_MS > 0 && !isLastBatch) {
        await new Promise(res => setTimeout(res, STEAM_REVIEW_BATCH_DELAY_MS));
      }
    }

    for (let i = 0; i < steamSpecials.length; i++) {
      const item = steamSpecials[i];
      const revData = reviewsData[i];
      const originalCents = item.original_price || 0;
      const finalCents = item.final_price || 0;
      const normalPrice = (originalCents / 100).toFixed(2);
      const salePrice = (finalCents / 100).toFixed(2);

      const rawSavings = item.discount_percent || 0;
      const derivedSavings = rawSavings > 0
        ? rawSavings
        : (originalCents > 0 && finalCents < originalCents
            ? Math.round(((originalCents - finalCents) / originalCents) * 100)
            : 0);
      const savings = Math.max(0, Math.min(100, derivedSavings));
      const wSavings = savings * 0.8;
      const wQuality = revData.success ? revData.qualityPercent * 1.0 : 50;
      const wBonus = revData.success ? Math.min(25, Math.floor(revData.totalReviews / 1000)) : 0;
      const hybridScore = wSavings + wQuality + wBonus;
      deals.push({
        id: `steam_${item.id}`,
        steamAppID: item.id,
        title: item.name,
        salePrice, normalPrice, savings,
        store: "Steam",
        link: `https://store.steampowered.com/app/${item.id}`,
        popularityScore: hybridScore,
        totalReviews: revData.totalReviews,
        qualityScore: revData.success ? revData.qualityPercent : 0,
        endDateStr: "Nespecificat",
        extraDetails: "",
        enriched: false,
        thumbnail: item.header_image || null,
        currency: currencyCode || "USD"
      });
    }
  } catch (err) {
    logger("WARN", "DEALS_FETCH", "Eroare Steam API", errorMessage(err));
  }

  try {
    const epicQuery = `query searchStoreQuery($category: String, $count: Int, $country: String!, $locale: String, $onSale: Boolean, $withPrice: Boolean = false) { Catalog { searchStore(category: $category, count: $count, country: $country, locale: $locale, onSale: $onSale) { elements { title id urlSlug keyImages { type url } price(country: $country) @include(if: $withPrice) { totalPrice { discountPrice originalPrice } } promotions { promotionalOffers { promotionalOffers { endDate discountSetting { discountPercentage } } } } } } } }`;
    const epicVars = {
      category: "games/edition/base|bundles/games",
      count: EPIC_SPECIALS_LIMIT,
      country: cc, locale: "en-US", onSale: true, withPrice: true
    };
    const epicRes = await httpReq("POST", "https://graphql.epicgames.com/graphql", {
      data: { query: epicQuery, variables: epicVars },
      largeJson: true,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Origin": "https://store.epicgames.com",
        "Referer": "https://store.epicgames.com/",
        "Content-Type": "application/json",
        "Accept": "application/json"
      }
    });

    const epicElements = (epicRes.data as EpicGraphqlResponse).data?.Catalog?.searchStore?.elements || [];
    for (const item of epicElements) {
      const priceInfo = item.price?.totalPrice;
      if (!priceInfo) continue;
      const originalPrice = priceInfo.originalPrice || 0;
      const discountPrice = priceInfo.discountPrice || 0;
      const normalPrice = (originalPrice / 100).toFixed(2);
      const salePrice = (discountPrice / 100).toFixed(2);
      let savings = 0;
      if (originalPrice > 0) {
        savings = Math.max(0, Math.round(((originalPrice - discountPrice) / originalPrice) * 100));
      }
      const hybridScore = savings * 0.8 + 80.0 + 15.0;

      let thumb: string | null = null;
      if (Array.isArray(item.keyImages)) {
        const img = item.keyImages.find(i => i.type === "OfferImageWide" || i.type === "Thumbnail");
        if (img?.url) thumb = img.url;
      }
      let endDate = "Nespecificat";
      const promos = item.promotions?.promotionalOffers?.[0]?.promotionalOffers?.[0];
      if (promos && promos.endDate) {
        const parsed = new Date(promos.endDate);
        if (!Number.isNaN(parsed.getTime())) {
          endDate = parsed.toLocaleDateString("ro-RO");
        }
      }
      const urlSlug = item.urlSlug || item.id;

      deals.push({
        id: `epic_${item.id}`,
        steamAppID: null,
        title: item.title,
        salePrice, normalPrice, savings,
        store: "Epic Games",
        link: `https://store.epicgames.com/en-US/p/${urlSlug}`,
        popularityScore: hybridScore,
        totalReviews: 0,
        qualityScore: 80,
        endDateStr: endDate,
        extraDetails: "",
        enriched: true,
        thumbnail: thumb,
        currency: currencyCode || "USD"
      });
    }
  } catch (err) {
    logger("WARN", "DEALS_FETCH", "Eroare Epic GraphQL", errorMessage(err));
  }

  const dedupeMap = new Map<string, DealInfo>();
  for (const deal of deals) {
    const key = normalizeTitleForDedupe(deal.title);
    if (!key) { dedupeMap.set(String(deal.id), deal); continue; }
    const existing = dedupeMap.get(key);
    if (!existing || (deal.popularityScore || 0) > (existing.popularityScore || 0)) {
      dedupeMap.set(key, deal);
    }
  }
  const finalTop = Array.from(dedupeMap.values())
    .sort((a, b) => (b.popularityScore || 0) - (a.popularityScore || 0))
    .slice(0, MAX_DEALS);
  if (!finalTop.length) throw new Error("Fără oferte valide.");
  return finalTop;
}

async function fetchDeals(opts: FetchDealsOptions = {}): Promise<DealInfo[]> {
  const { logger, withInflightTimeout, trackInflight } = runtimeContext;
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

function attachDeals(target: DealsContext): void {
  runtimeContext = target;

  Object.assign(target, {
    fetchSteamReviewData,
    enrichCacheGet,
    enrichCacheSet,
    cleanEnrichedCache,
    getEnrichedCacheSize,
    enrichDealData,
    fetchDeals
  });
}

export = attachDeals;
