"use strict";

module.exports = (ctx) => {
  const {
    logger, getCurrencyConfig, formatPrice, STEAM_REVIEW_BATCH_SIZE,
    STEAM_REVIEW_BATCH_DELAY_MS, ENRICHED_DEAL_CACHE_TTL_MS,
    ENRICHED_DEAL_CACHE_MAX_SIZE, STEAM_SPECIALS_LIMIT, EPIC_SPECIALS_LIMIT,
    MAX_DEALS, httpReq, safeCheerioLoad, cleanText, normalizeTitleForDedupe,
    trackInflight, withInflightTimeout
  } = ctx;

async function fetchSteamReviewData(appId) {
  try {
    const res = await httpReq("GET",
      `https://store.steampowered.com/appreviews/${appId}?json=1&language=all&num_per_page=0`,
      { largeJson: true }, 3, 800);
    const summary = res.data?.query_summary;
    if (summary) {
      const totalReviews = summary.total_reviews || 0;
      const positiveReviews = summary.total_positive || 0;
      const qualityPercent = totalReviews > 0 ? Math.round((positiveReviews / totalReviews) * 100) : 0;
      return { totalReviews, qualityPercent, success: true };
    }
    return { totalReviews: 0, qualityPercent: 0, success: false };
  } catch (err) {
    logger("WARN", "STEAM_REVIEW", `Eroare preluare review Steam appID ${appId}`, err.message);
    return { totalReviews: 0, qualityPercent: 0, success: false };
  }
}

// -------------------------------------------------------------
// ENRICH DEAL DATA — V9: cc dinamic și pe HTML scrape
// -------------------------------------------------------------
const activeEnrichments = new Map();
const enrichedCache = new Map();

function enrichCacheGet(key, currency) {
  const v = enrichedCache.get(key);
  if (!v) return null;
  if (v.expiresAt < Date.now()) { enrichedCache.delete(key); return null; }
  if (v.currency !== currency) return null;
  enrichedCache.delete(key);
  enrichedCache.set(key, v);
  return v.enriched;
}

function enrichCacheSet(key, enriched, currency) {
  if (ENRICHED_DEAL_CACHE_MAX_SIZE === 0 || ENRICHED_DEAL_CACHE_TTL_MS === 0) return;
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

function cleanEnrichedCache() {
  const now = Date.now();
  for (const [k, v] of enrichedCache.entries()) {
    if (v.expiresAt < now) enrichedCache.delete(k);
  }
}

function getEnrichedCacheSize() {
  return enrichedCache.size;
}

async function enrichDealData(deal, currencyCode) {
  const currency = String(currencyCode || "USD").toUpperCase();
  if (deal.enriched) return deal;

  const cached = enrichCacheGet(deal.id, currency);
  if (cached) return cached;

  const inflightKey = `${deal.id}:${currency}`;
  const existing = activeEnrichments.get(inflightKey);
  if (existing) return existing;

  const enrichTask = (async () => {
    const enriched = { ...deal };
    if (enriched.store === "Steam" && enriched.steamAppID) {
      const cfg = getCurrencyConfig(currency);
      try {
        // V9: pagina HTML primește și ea cc + l=english pentru consistență
        const htmlUrl = `${enriched.link}?cc=${cfg.cc}&l=english`;
        const [detailsRes, htmlRes] = await Promise.all([
          httpReq("GET",
            `https://store.steampowered.com/api/appdetails?appids=${enriched.steamAppID}&cc=${cfg.cc}&l=english`,
            { timeout: 5000, largeJson: true }).catch(e => {
              logger("WARN", "STEAM_ENRICH", `appdetails fail appID ${enriched.steamAppID}`, e.message);
              return null;
            }),
          httpReq("GET", htmlUrl, {
            headers: { "Cookie": "birthtime=283993201; mature_content=1;" }
          }).catch(e => {
            logger("WARN", "STEAM_ENRICH", `html fetch fail appID ${enriched.steamAppID}`, e.message);
            return null;
          })
        ]);

        const data = detailsRes?.data?.[enriched.steamAppID]?.data;
        if (data && data.platforms) {
          enriched.extraDetails = (enriched.extraDetails || "")
            + `\n**Platforme:** ${[data.platforms.windows ? "Win" : "", data.platforms.mac ? "Mac" : "", data.platforms.linux ? "Lin" : ""].filter(Boolean).join(", ")}`;
        }
        if (htmlRes?.data) {
          const match = htmlRes.data.match(/Offer ends\s+([^<]+)/i);
          if (match && match[1]) enriched.endDateStr = match[1].trim();
        }
      } catch (e) {
        logger("WARN", "STEAM_ENRICH", `Eroare enrich oferta Steam appID ${enriched.steamAppID}`, e.message);
      }
    }
    enriched.enriched = true;
    enrichCacheSet(deal.id, enriched, currency);
    return enriched;
  })();

  activeEnrichments.set(inflightKey, enrichTask);
  try {
    return await enrichTask;
  } finally {
    activeEnrichments.delete(inflightKey);
  }
}

// -------------------------------------------------------------
// FETCH DEALS — V9: cleanup safe
// -------------------------------------------------------------
const inflightDeals = new Map();

async function _fetchDealsImpl(currencyCode) {
  const cfg = getCurrencyConfig(currencyCode);
  const cc = cfg.cc;

  const deals = [];
  try {
    const steamRes = await httpReq("GET",
      `https://store.steampowered.com/api/featuredcategories/?cc=${cc}&l=english`,
      { largeJson: true });
    const steamSpecials = (steamRes.data?.specials?.items || []).slice(0, STEAM_SPECIALS_LIMIT);

    const reviewsData = [];
    for (let i = 0; i < steamSpecials.length; i += STEAM_REVIEW_BATCH_SIZE) {
      const chunk = steamSpecials.slice(i, i + STEAM_REVIEW_BATCH_SIZE);
      const chunkPromises = chunk.map(item => fetchSteamReviewData(item.id));
      const chunkResults = await Promise.all(chunkPromises);
      reviewsData.push(...chunkResults);
      if (STEAM_REVIEW_BATCH_DELAY_MS > 0) {
        await new Promise(res => setTimeout(res, STEAM_REVIEW_BATCH_DELAY_MS));
      }
    }

    for (let i = 0; i < steamSpecials.length; i++) {
      const item = steamSpecials[i];
      const revData = reviewsData[i];
      const normalPrice = (item.original_price / 100).toFixed(2);
      const salePrice = (item.final_price / 100).toFixed(2);
      const savings = item.discount_percent || 0;
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
    logger("WARN", "DEALS_FETCH", "Eroare Steam API", err.message);
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

    const epicElements = epicRes.data?.data?.Catalog?.searchStore?.elements || [];
    for (const item of epicElements) {
      const priceInfo = item.price?.totalPrice;
      if (!priceInfo) continue;
      const normalPrice = (priceInfo.originalPrice / 100).toFixed(2);
      const salePrice = (priceInfo.discountPrice / 100).toFixed(2);
      let savings = 0;
      if (priceInfo.originalPrice > 0) {
        savings = Math.round(((priceInfo.originalPrice - priceInfo.discountPrice) / priceInfo.originalPrice) * 100);
      }
      const hybridScore = savings * 0.8 + 80.0 + 15.0;

      let thumb = null;
      if (Array.isArray(item.keyImages)) {
        const img = item.keyImages.find(i => i.type === "OfferImageWide" || i.type === "Thumbnail");
        if (img) thumb = img.url;
      }
      let endDate = "Nespecificat";
      const promos = item.promotions?.promotionalOffers?.[0]?.promotionalOffers?.[0];
      if (promos && promos.endDate) endDate = new Date(promos.endDate).toLocaleDateString("ro-RO");
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
    logger("WARN", "DEALS_FETCH", "Eroare Epic GraphQL", err.message);
  }

  const dedupeMap = new Map();
  for (const deal of deals) {
    const key = normalizeTitleForDedupe(deal.title);
    if (!key) { dedupeMap.set(deal.id, deal); continue; }
    const existing = dedupeMap.get(key);
    if (!existing || deal.popularityScore > existing.popularityScore) {
      dedupeMap.set(key, deal);
    }
  }
  const finalTop = Array.from(dedupeMap.values())
    .sort((a, b) => b.popularityScore - a.popularityScore)
    .slice(0, MAX_DEALS);
  if (!finalTop.length) throw new Error("Fără oferte valide.");
  return finalTop;
}

async function fetchDeals(opts = {}) {
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

// -------------------------------------------------------------
// STEAM SEARCH
// -------------------------------------------------------------

  Object.assign(ctx, {
    fetchSteamReviewData,
    enrichCacheGet,
    enrichCacheSet,
    cleanEnrichedCache,
    getEnrichedCacheSize,
    enrichDealData,
    fetchDeals
  });
};
