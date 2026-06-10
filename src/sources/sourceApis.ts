import type {
  AbortPredicate,
  CurrencyCode,
  DealInfo,
  FetchDealsOptions,
  FetchResult,
  GameConfig,
  GameSourceFallback,
  NormalizedUpdate,
  SteamReviewData,
  SteamSearchItem
} from "../types";

export type SourceCurrencyCode = CurrencyCode | string | null | undefined;

export interface ListingCandidate {
  href: string;
  text: string;
  position: number;
}

export interface ChooseBestSteamMatchOptions {
  forceGameOnly?: boolean;
}

export interface SteamAppDetailsSummary {
  type?: string;
  name?: string;
  header_image?: string;
  is_free?: boolean;
  price_overview?: {
    initial: number;
    final: number;
    discount_percent: number;
  } | null;
}

export interface SteamSourceApi {
  searchSteamGameByName: (query: string, currencyCode?: SourceCurrencyCode) => Promise<SteamSearchItem[]>;
  levenshtein: (a: string, b: string) => number;
  chooseBestSteamMatch: (items: SteamSearchItem[] | null | undefined, query: string, options?: ChooseBestSteamMatchOptions) => SteamSearchItem | null;
  fetchSteamPriceDetails: (appId: string | number, currencyCode?: SourceCurrencyCode) => Promise<SteamAppDetailsSummary | null>;
  extractOfferEndFromHtml: (html: unknown) => string | null;
  extractSteamOfferEndDate: (appId: string | number, currencyCode?: SourceCurrencyCode) => Promise<string | null>;
}

export interface DealsApi {
  fetchSteamReviewData: (appId: string | number) => Promise<SteamReviewData>;
  enrichCacheGet: (dealId: unknown, currency: string) => DealInfo | null;
  enrichCacheSet: (dealId: unknown, enriched: DealInfo, currency: string) => void;
  cleanEnrichedCache: () => void;
  getEnrichedCacheSize: () => number;
  enrichDealData: (deal: DealInfo, currencyCode?: SourceCurrencyCode) => Promise<DealInfo>;
  fetchDeals: (opts?: FetchDealsOptions) => Promise<DealInfo[]>;
}

export interface UpdatesApi {
  absoluteUrl: (base: string | undefined, maybeRelative: string | undefined) => string;
  isGoodSteamArticleUrl: (url: unknown) => boolean;
  extractDateScore: (url: string) => number;
  scoreCandidate: (candidate: ListingCandidate, keywords: string[]) => number;
  isLikelyPatchNote: (item: Record<string, unknown>) => boolean;
  fetchSteamUpdate: (game: GameConfig) => Promise<NormalizedUpdate>;
  fetchListingBasedUpdate: (game: GameConfig) => Promise<NormalizedUpdate>;
  fetchFortniteUpdate: () => Promise<NormalizedUpdate>;
  fetchAmdUpdate: (game: GameConfig) => Promise<NormalizedUpdate>;
  fetchIntelUpdate: (game: GameConfig) => Promise<NormalizedUpdate>;
  fetchMinecraftUpdate: () => Promise<NormalizedUpdate>;
  fetchRobloxUpdate: () => Promise<NormalizedUpdate>;
  fetchNvidiaUpdate: (game: GameConfig) => Promise<NormalizedUpdate>;
  fetchGameUpdate: (game: GameConfig) => Promise<NormalizedUpdate>;
  applyFallbackSource: (game: GameConfig, fallback: GameSourceFallback) => GameConfig;
  executeFetchWithCircuitBreaker: (game: GameConfig) => Promise<FetchResult>;
  sourceConcurrencyGroup: (game: GameConfig) => string;
  getLatestForAllGames: (games: GameConfig[], shouldAbort?: AbortPredicate) => Promise<FetchResult[]>;
}
