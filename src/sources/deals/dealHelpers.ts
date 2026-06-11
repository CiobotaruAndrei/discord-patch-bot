import type { CurrencyCode, DealInfo, HttpRequestOptions } from "../../types";

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

export function dedupeAndRankDeals(
  deals: DealInfo[],
  normalizeTitleForDedupe: (value: unknown) => string,
  maxDeals: number
): DealInfo[] {
  const dedupeMap = new Map<string, DealInfo>();
  for (const deal of deals) {
    const key = normalizeTitleForDedupe(deal.title);
    if (!key) { dedupeMap.set(String(deal.id), deal); continue; }
    const existing = dedupeMap.get(key);
    if (!existing || (deal.popularityScore || 0) > (existing.popularityScore || 0)) {
      dedupeMap.set(key, deal);
    }
  }
  return Array.from(dedupeMap.values())
    .sort((a, b) => (b.popularityScore || 0) - (a.popularityScore || 0))
    .slice(0, maxDeals);
}
