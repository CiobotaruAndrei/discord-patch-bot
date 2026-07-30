import type { CurrencyCode, PriceValue } from "../types.js";
import type { GameConfig } from "../config/configTypes.js";

export interface PatchUpdate {
  id?: string;
  title?: string;
  url?: string;
  link?: string;
  summary?: string;
  excerpt?: string;
  content?: string;
  fullText?: string;
  publishedAt?: string | Date;
  date?: string | Date;
  timestamp?: string | Date;
  author?: string;
  image?: string | null;
  thumbnail?: string | null;
  [key: string]: unknown;
}

export interface NormalizedUpdate {
  id: string;
  title: string;
  link: string;
  excerpt: string;
  fullText: string;
  image: string | null;
  thumbnail: string | null;
  timestamp: string;
}

export interface EmbeddableUpdate {
  title?: string;
  link?: string;
  excerpt?: string;
  image?: unknown;
  thumbnail?: unknown;
  timestamp?: string | Date;
}

export type SourceFetchOutcome = "ok" | "transient-error" | "permanent-error" | "schema-drift" | "rate-limited";

export interface FetchResult {
  game: GameConfig;
  latest: NormalizedUpdate | null;
  error: string | null;
  outcome?: SourceFetchOutcome;
}

export interface DealInfo {
  id?: string;
  title?: string;
  url?: string;
  link?: string;
  store?: string;
  appId?: string;
  steamAppID?: string | number | null;
  normalPrice?: PriceValue;
  salePrice?: PriceValue;
  savings?: PriceValue;
  discountPercent?: number;
  popularityScore?: number;
  totalReviews?: number;
  qualityScore?: number;
  currency?: CurrencyCode | string;
  image?: string | null;
  thumbnail?: string | null;
  endsAt?: string | Date | null;
  endDateStr?: string | null;
  extraDetails?: string;
  enriched?: boolean;
}

export interface ValidatedDealInfo extends DealInfo {
  title: string;
  link: string;
  store: string;
  normalPrice: PriceValue;
  salePrice: PriceValue;
  savings: PriceValue;
}

export interface EnrichedDealInfo extends DealInfo {
  enriched: true;
}

export interface DlcInfo {
  name: string;
  price: string;
}

export interface DlcCacheEntry {
  dlcList: DlcInfo[];
  title: string;
  appId: string | number;
  thumbUrl: string;
  totalExtracted: number;
}

export interface SteamSearchItem {
  id?: string | number;
  name?: string;
  type?: string;
  tiny_image?: string;
  price?: unknown;
  [key: string]: unknown;
}

export interface SteamReviewData {
  totalReviews: number;
  qualityPercent: number;
  success: boolean;
}

export interface FetchDealsOptions {
  currency?: CurrencyCode | string;
  fromCron?: boolean;
}
