import type { AxiosResponse } from "axios";
import type { CheerioAPI } from "cheerio";
import type {
  AbortPredicate,
  BotMetrics,
  CurrencyCode,
  DealInfo,
  EnrichedDealInfo,
  FetchDealsOptions,
  FetchResult,
  GameConfig,
  HttpRequestOptions,
  NormalizedUpdate,
  PatchUpdate,
  SteamReviewData,
  SteamSearchItem
} from "./types";

export type CurrencyInput = CurrencyCode | string;
export type FetchMetrics = Pick<BotMetrics, "fetchSuccess" | "fetchFail" | "httpRetries" | "rateLimitHits">;

export interface SteamSearchOptions {
  forceGameOnly?: boolean;
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
export function normalizeUpdate(data: Partial<PatchUpdate>): NormalizedUpdate;
export function safeCheerioLoad(html: unknown): CheerioAPI;
export function levenshtein(a: string, b: string): number;
export function httpReq<T = unknown>(
  method: string,
  url: string,
  options?: HttpRequestOptions,
  retries?: number,
  backoff?: number
): Promise<AxiosResponse<T>>;
export function fetchWithProxy(targetUrl: string, options?: HttpRequestOptions): Promise<string>;
export function dealHash(deal: DealInfo): string;
export function attachMetrics(metrics: FetchMetrics | BotMetrics): void;

export function fetchGameUpdate(game: GameConfig): Promise<NormalizedUpdate>;
export function executeFetchWithCircuitBreaker(game: GameConfig): Promise<FetchResult>;
export function getLatestForAllGames(
  games: GameConfig[],
  shouldAbort?: AbortPredicate | null
): Promise<FetchResult[]>;

export function fetchSteamReviewData(appId: string | number): Promise<SteamReviewData>;
export function enrichDealData<T extends DealInfo>(
  deal: T,
  currencyCode?: CurrencyInput
): Promise<T & EnrichedDealInfo>;
export function fetchDeals(opts?: FetchDealsOptions): Promise<DealInfo[]>;

export function searchSteamGameByName(
  query: string,
  currencyCode?: CurrencyInput
): Promise<SteamSearchItem[]>;
export function chooseBestSteamMatch(
  items: SteamSearchItem[],
  query: string,
  options?: SteamSearchOptions
): SteamSearchItem | null;
export function fetchSteamPriceDetails(
  appId: string | number,
  currencyCode?: CurrencyInput
): Promise<Record<string, unknown> | null>;
export function extractSteamOfferEndDate(appId: string | number, currencyCode?: CurrencyInput): Promise<string | null>;

export function cleanEnrichedCache(): void;
export function getEnrichedCacheSize(): number;
export function formatPrice(value: string | number, currencyCode?: CurrencyInput): string;
