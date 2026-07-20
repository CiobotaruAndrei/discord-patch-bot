import type { CurrencyCode, DealInfo, HttpRequestOptions } from "../../types.js";
import { dedupeAndRankDealsIndex } from "../../native/fuzzy.js";

export type DealCurrencyCode = CurrencyCode | string | null | undefined;
export type HttpResponse<T = unknown> = { data: T };
export type HttpReq = (
  method: string,
  url: string,
  options?: HttpRequestOptions,
  retries?: number,
  backoff?: number
) => Promise<HttpResponse<unknown>>;
export type TrackInflight = <T>(map: Map<string, Promise<T>>, key: string, promise: Promise<T>) => void;
export type WithInflightTimeout = <T>(promise: Promise<T>, label: string) => Promise<T>;

export function dedupeAndRankDeals(deals: DealInfo[], maxDeals: number): DealInfo[] {
  return dedupeAndRankDealsIndex(deals, maxDeals).map(index => deals[index]);
}
