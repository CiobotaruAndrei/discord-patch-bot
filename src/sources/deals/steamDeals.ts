import { requestOptionsFor, SOURCE_POLICIES } from "../sourcePolicies.js";
import type { DealInfo, LoggerFunction, SteamReviewData } from "../../types.js";
import { errorMessage } from "../../shared/errors.js";
import type { DealCurrencyCode, HttpReq } from "./dealHelpers.js";
import { decodeSteamFeaturedCategoriesResponse, decodeSteamReviewResponse, type SteamFeaturedCategoryItem } from "../responseDecoders.js";

export interface SteamDealsDeps {
  httpReq: HttpReq;
  logger: LoggerFunction;
  STEAM_SPECIALS_LIMIT: number;
  STEAM_REVIEW_BATCH_SIZE: number;
  STEAM_REVIEW_BATCH_DELAY_MS: number;
}

export function createSteamDeals(deps: SteamDealsDeps) {
  async function fetchSteamReviewData(appId: string | number): Promise<SteamReviewData> {
    const { httpReq, logger } = deps;
    try {
      const res = await httpReq("GET",
        `https://store.steampowered.com/appreviews/${appId}?json=1&language=all&num_per_page=0`,
        requestOptionsFor("steam-reviews"), SOURCE_POLICIES["steam-reviews"].retries, SOURCE_POLICIES["steam-reviews"].retryDelayMs);
      const summary = decodeSteamReviewResponse(res.data).query_summary;
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

  async function fetchSteamSpecials(cc: string, currencyCode: DealCurrencyCode): Promise<DealInfo[]> {
    const {
      httpReq,
      logger,
      STEAM_SPECIALS_LIMIT,
      STEAM_REVIEW_BATCH_SIZE,
      STEAM_REVIEW_BATCH_DELAY_MS
    } = deps;
    const deals: DealInfo[] = [];
    try {
      const steamRes = await httpReq("GET",
        `https://store.steampowered.com/api/featuredcategories/?cc=${cc}&l=english`,
        requestOptionsFor("steam-featured-deals"));
      const steamSpecials: SteamFeaturedCategoryItem[] = (decodeSteamFeaturedCategoriesResponse(steamRes.data).specials?.items || []).slice(0, STEAM_SPECIALS_LIMIT);

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
    return deals;
  }

  return { fetchSteamReviewData, fetchSteamSpecials };
}
