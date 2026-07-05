import { requestOptionsFor } from "../sourcePolicies";
import type { DealInfo, LoggerFunction } from "../../types";
import { errorMessage } from "../../shared/errors";
import type { DealCurrencyCode, HttpReq } from "./dealHelpers";

interface EpicGraphqlResponse {
  data?: {
    Catalog?: {
      searchStore?: {
        elements?: EpicStoreElement[];
      };
    };
  };
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

export interface EpicDealsDeps {
  httpReq: HttpReq;
  logger: LoggerFunction;
  EPIC_SPECIALS_LIMIT: number;
}

export function createEpicDeals(deps: EpicDealsDeps) {
  async function fetchEpicSpecials(cc: string, currencyCode: DealCurrencyCode): Promise<DealInfo[]> {
    const { httpReq, logger, EPIC_SPECIALS_LIMIT } = deps;
    const deals: DealInfo[] = [];
    try {
      const epicQuery = `query searchStoreQuery($category: String, $count: Int, $country: String!, $locale: String, $onSale: Boolean, $withPrice: Boolean = false) { Catalog { searchStore(category: $category, count: $count, country: $country, locale: $locale, onSale: $onSale) { elements { title id urlSlug keyImages { type url } price(country: $country) @include(if: $withPrice) { totalPrice { discountPrice originalPrice } } promotions { promotionalOffers { promotionalOffers { endDate discountSetting { discountPercentage } } } } } } } }`;
      const epicVars = {
        category: "games/edition/base|bundles/games",
        count: EPIC_SPECIALS_LIMIT,
        country: cc, locale: "en-US", onSale: true, withPrice: true
      };
      const epicRes = await httpReq("POST", "https://store.epicgames.com/graphql", {
        ...requestOptionsFor("epic-graphql-deals"),
        data: { query: epicQuery, variables: epicVars },
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
    return deals;
  }

  return { fetchEpicSpecials };
}
