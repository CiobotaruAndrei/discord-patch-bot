import type { HttpRequestOptions } from "../../sources/httpRequestTypes.js";

type ConditionalHttpResponse = { status?: number; data?: unknown; headers?: unknown };
type ConditionalHttpReq = (method: string, url: string, options?: HttpRequestOptions) => Promise<ConditionalHttpResponse>;

interface ConditionalCacheEntry {
  etag?: string;
  lastModified?: string;
  result: unknown;
}

function createConditionalGet(httpReq: ConditionalHttpReq, maxSize: number) {
  const cache = new Map<string, ConditionalCacheEntry>();
  return async function conditionalGet<T>(
    url: string,
    parse: (data: unknown) => T | Promise<T>,
    options: HttpRequestOptions = {}
  ): Promise<T> {
    const cached = cache.get(url);
    const headers: Record<string, string> = { ...(options.headers || {}) };
    if (cached?.etag) headers["If-None-Match"] = cached.etag;
    if (cached?.lastModified) headers["If-Modified-Since"] = cached.lastModified;
    const response = await httpReq("GET", url, { ...options, headers, acceptNotModified: true });
    if (response.status === 304 && cached) {
      return cached.result as T;
    }
    const result = await parse(response.data);
    const responseHeaders = (response.headers || {}) as Record<string, unknown>;
    const etag = typeof responseHeaders.etag === "string" ? responseHeaders.etag : undefined;
    const lastModified = typeof responseHeaders["last-modified"] === "string" ? responseHeaders["last-modified"] : undefined;
    cache.delete(url);
    if (etag || lastModified) {
      if (cache.size >= maxSize) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(url, { etag, lastModified, result });
    }
    return result;
  };
}

export { createConditionalGet };
export type { ConditionalHttpReq, ConditionalHttpResponse };
