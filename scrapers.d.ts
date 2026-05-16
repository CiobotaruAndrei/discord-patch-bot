import type { DealInfo, GameConfig, PatchUpdate } from "./types";

export interface FetchMetrics {
  fetchSuccess: number;
  fetchFail: number;
  httpRetries: number;
  rateLimitHits: number;
}

export interface FetchResult {
  game: GameConfig;
  latest: PatchUpdate | null;
  error: string | null;
}

export interface FetchDealsOptions {
  currency?: string;
  fromCron?: boolean;
}

export interface SteamReviewData {
  totalReviews: number;
  qualityPercent: number;
  success: boolean;
}

export interface SteamSearchOptions {
  forceGameOnly?: boolean;
}

export interface SteamSearchItem {
  id?: number | string;
  name?: string;
  type?: string;
  [key: string]: unknown;
}

export const USER_AGENTS: string[];
export const MAX_HTML_BYTES: number;
export const MAX_JSON_BYTES: number;
export const MAX_DEALS: number;
export const FETCH_CONCURRENCY: number;

export function cleanText(text: unknown): string;
export function truncate(str: unknown, maxLen: number): string;
export function normalizeTitleForDedupe(str: unknown): string;
export function stableUpdateId(title: unknown, link: unknown): string;
export function normalizeUpdate(data: Partial<PatchUpdate>): PatchUpdate;
export function safeCheerioLoad(html: unknown): unknown;
export function levenshtein(a: string, b: string): number;
export function httpReq(
  method: string,
  url: string,
  options?: Record<string, unknown>,
  retries?: number,
  backoff?: number
): Promise<unknown>;
export function fetchWithProxy(targetUrl: string, options?: Record<string, unknown>): Promise<string>;
export function dealHash(deal: DealInfo): string;
export function attachMetrics(metrics: FetchMetrics): void;

export function fetchGameUpdate(game: GameConfig): Promise<PatchUpdate>;
export function executeFetchWithCircuitBreaker(game: GameConfig): Promise<FetchResult>;
export function getLatestForAllGames(
  games: GameConfig[],
  shouldAbort?: () => boolean
): Promise<FetchResult[]>;

export function fetchSteamReviewData(appId: string | number): Promise<SteamReviewData>;
export function enrichDealData<T extends DealInfo>(
  deal: T,
  currencyCode?: string
): Promise<T & { enriched: boolean }>;
export function fetchDeals(opts?: FetchDealsOptions): Promise<DealInfo[]>;

export function searchSteamGameByName(
  query: string,
  currencyCode?: string
): Promise<SteamSearchItem[]>;
export function chooseBestSteamMatch(
  items: SteamSearchItem[],
  query: string,
  options?: SteamSearchOptions
): SteamSearchItem | null;
export function fetchSteamPriceDetails(appId: string | number, currencyCode?: string): Promise<unknown>;
export function extractSteamOfferEndDate(appId: string | number, currencyCode?: string): Promise<string | null>;

export function cleanEnrichedCache(): void;
export function getEnrichedCacheSize(): number;
export function formatPrice(value: string | number, currencyCode?: string): string;
