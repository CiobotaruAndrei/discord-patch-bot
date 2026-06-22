import http = require("http");
import https = require("https");
import dns = require("dns");
import type { AxiosRequestConfig, AxiosResponse, AxiosStatic } from "axios";
import type {
  DealInfo,
  HttpRequestOptions,
  LoggerFunction,
  NormalizedUpdate,
  PatchUpdate,
  RuntimeEnv
} from "../../types";
import {
  cleanText as rustCleanText,
  dealHash as rustDealHash,
  normalizeDealState as rustNormalizeDealState,
  normalizeTitleForDedupe as rustNormalizeTitleForDedupe,
  stableUpdateId as rustStableUpdateId
} from "../../native/fuzzy";
import { errorMessage } from "../../shared/errors";
import {
  assertSafeExternalUrl,
  assertSafeExternalDnsTarget,
  createSafeDnsLookup,
  type DnsLookup
} from "./ssrfGuard";
import { parseRetryAfter, classifyHttpFailure, computeBackoffWaitMs } from "./retryPolicy";
import { resolveDefaultProxies, normalizeProxyTemplates } from "./proxyTemplates";
import { createInitialHttpMetrics, type HttpMetricsRef } from "./httpMetrics";
import { createConditionalGet } from "./conditionalCache";

type CheerioModule = typeof import("cheerio");
type CryptoModule = typeof import("crypto");

const HTTP_MAX_REDIRECTS = 5;

function assertSafeRedirect(options: { href?: string; protocol?: string; hostname?: string; host?: string }): void {
  const href = options?.href
    || (options?.protocol && (options.host || options.hostname) ? `${options.protocol}//${options.host || options.hostname}` : "");
  assertSafeExternalUrl(href, "HTTP redirect target");
}

interface AxiosLikeError {
  code?: string;
  name?: string;
  response?: {
    status?: number;
    headers?: Record<string, unknown>;
  };
}

interface HttpClientDeps {
  axios: AxiosStatic;
  cheerio: CheerioModule;
  crypto: CryptoModule;
  dnsLookup?: DnsLookup;
  env: RuntimeEnv;
  logger: LoggerFunction;
  getAbortSignal?: () => AbortSignal | null | undefined;
  metricsRef?: HttpMetricsRef;
}

type HttpClientContext = HttpClientDeps & Record<string, unknown>;

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0"
];

function buildHttpClientFrom(target: HttpClientContext) {
  const { axios, cheerio, env, logger, getAbortSignal } = target;
  const dnsLookup = target.dnsLookup || dns.lookup;
  const safeDnsLookup = createSafeDnsLookup(dnsLookup);

  const FETCH_CONCURRENCY = env.FETCH_CONCURRENCY;
  const FETCH_CONCURRENCY_STEAM = env.FETCH_CONCURRENCY_STEAM;
  const FETCH_CONCURRENCY_EPIC = env.FETCH_CONCURRENCY_EPIC;
  const FETCH_CONCURRENCY_LISTING = env.FETCH_CONCURRENCY_LISTING;
  const FETCH_CONCURRENCY_DRIVER = env.FETCH_CONCURRENCY_DRIVER;
  const MAX_HTML_BYTES = env.MAX_HTML_BYTES;
  const MAX_JSON_BYTES = env.MAX_JSON_BYTES;
  const MAX_DEALS = env.MAX_DEALS;
  const STEAM_SPECIALS_LIMIT = env.STEAM_SPECIALS_LIMIT;
  const EPIC_SPECIALS_LIMIT = env.EPIC_SPECIALS_LIMIT;
  const STEAM_REVIEW_BATCH_SIZE = env.STEAM_REVIEW_BATCH_SIZE;
  const STEAM_REVIEW_BATCH_DELAY_MS = env.STEAM_REVIEW_BATCH_DELAY_MS;
  const INFLIGHT_PROMISE_TIMEOUT_MS = env.INFLIGHT_PROMISE_TIMEOUT_MS;
  const CIRCUIT_BREAKER_FAIL_THRESHOLD = env.CIRCUIT_BREAKER_FAIL_THRESHOLD;
  const CIRCUIT_BREAKER_COOLDOWN_MS = env.CIRCUIT_BREAKER_COOLDOWN_MS;
  const CIRCUIT_BREAKER_JITTER_MS = env.CIRCUIT_BREAKER_JITTER_MS;
  const SCHEMA_DRIFT_THRESHOLD = env.SCHEMA_DRIFT_THRESHOLD;
  const ENRICHED_DEAL_CACHE_TTL_MS = env.ENRICHED_DEAL_CACHE_TTL_MS;
  const ENRICHED_DEAL_CACHE_MAX_SIZE = env.ENRICHED_DEAL_CACHE_MAX_SIZE;

  const httpAgent = new http.Agent({
    keepAlive: true,
    maxSockets: Math.max(FETCH_CONCURRENCY * 2, 20),
    keepAliveMsecs: 30_000,
    lookup: safeDnsLookup
  });
  const httpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets: Math.max(FETCH_CONCURRENCY * 2, 20),
    keepAliveMsecs: 30_000,
    lookup: safeDnsLookup
  });
  const axiosClient = axios.create({
    httpAgent,
    httpsAgent,
    decompress: true,
    maxRedirects: HTTP_MAX_REDIRECTS,
    beforeRedirect: (redirectOptions: { href?: string; protocol?: string; hostname?: string; host?: string }) => assertSafeRedirect(redirectOptions)
  });

  const DEFAULT_PROXIES = resolveDefaultProxies(env.NODE_ENV, env.isProd, env.ALLOW_DEFAULT_PROXIES);
  const PROXY_TEMPLATES = normalizeProxyTemplates(env.PROXY_URLS, DEFAULT_PROXIES);
  if (!env.PROXY_URLS && DEFAULT_PROXIES.length && env.NODE_ENV !== "development") {
    logger("WARN", "HTTP", "Proxy-uri implicite third-party activate prin ALLOW_DEFAULT_PROXIES in afara dev-ului — pot scurge URL-uri tinta catre servicii terte.");
  }

  const CONDITIONAL_CACHE_MAX = 500;

  target.metricsRef = createInitialHttpMetrics();
  function metrics(): HttpMetricsRef {
    return target.metricsRef as HttpMetricsRef;
  }

  function attachMetrics(m: HttpMetricsRef): void { target.metricsRef = m; }

  function cleanText(text: unknown): string {
    return rustCleanText(text);
  }

  function truncate(str: unknown, maxLen: number): string {
    const t = String(str || "");
    return t.length > maxLen ? t.substring(0, maxLen - 3) + "..." : t;
  }

  function normalizeTitleForDedupe(str: unknown): string {
    return rustNormalizeTitleForDedupe(str);
  }

  function stableUpdateId(title: unknown, link: unknown): string {
    return rustStableUpdateId(title, link);
  }

  function normalizeUpdate(data: PatchUpdate): NormalizedUpdate {
    let id = String(data.id || "");
    if (!id) id = stableUpdateId(data.title, data.link);
    return {
      id,
      title: truncate(data.title || "Update nou", 250),
      link: String(data.link || ""),
      excerpt: truncate(data.excerpt || "", 700),
      fullText: truncate(data.fullText || "", 3500),
      image: data.image || null,
      thumbnail: data.thumbnail || null,
      timestamp: data.timestamp || ""
    } as NormalizedUpdate;
  }

  function safeCheerioLoad(html: unknown) {
    const str = typeof html === "string" ? html : String(html || "");
    if (str.length * 4 <= MAX_HTML_BYTES) return cheerio.load(str);
    const byteLen = Buffer.byteLength(str, "utf8");
    if (byteLen <= MAX_HTML_BYTES) return cheerio.load(str);

    const buf = Buffer.from(str, "utf8");
    let end = Math.min(buf.length, MAX_HTML_BYTES);
    while (end > 0) {
      const nextByte = buf[end];
      if (nextByte === undefined || (nextByte & 0xC0) !== 0x80) break;
      end--;
    }
    return cheerio.load(buf.subarray(0, end).toString("utf8"));
  }

  function normalizeDealState(deal: DealInfo): string {
    return rustNormalizeDealState(deal);
  }

  function dealHash(deal: DealInfo): string {
    return rustDealHash(deal);
  }

  async function httpReq(
    method: string,
    url: string,
    options: HttpRequestOptions = {},
    retries = 2,
    backoff = 1000
  ): Promise<AxiosResponse> {
    const safeUrl = await assertSafeExternalDnsTarget(url, "HTTP URL", dnsLookup);
    let contentLimit = options.maxContentLength;
    let bodyLimit = options.maxBodyLength;
    if (contentLimit === undefined) {
      contentLimit = options.largeJson ? MAX_JSON_BYTES : MAX_HTML_BYTES;
    }
    if (bodyLimit === undefined) {
      bodyLimit = options.largeJson ? MAX_JSON_BYTES : MAX_HTML_BYTES;
    }

    const callerHeaders = options.headers || {};
    const hasExplicitUA = Object.keys(callerHeaders).some(
      k => k.toLowerCase() === "user-agent"
    );
    const mergedHeaders = hasExplicitUA
      ? { ...callerHeaders }
      : {
          "User-Agent": USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
          ...callerHeaders
        };

    const signal = options.signal || (typeof getAbortSignal === "function" ? getAbortSignal() : null);
    const reqConfig: AxiosRequestConfig = {
      method,
      url: safeUrl,
      timeout: options.timeout || 15000,
      maxContentLength: contentLimit,
      maxBodyLength: bodyLimit,
      headers: mergedHeaders
    };
    if (signal) reqConfig.signal = signal;
    if ("data" in options) reqConfig.data = options.data;
    if (options.acceptNotModified) {
      reqConfig.validateStatus = (status: number) => (status >= 200 && status < 300) || status === 304;
    }

    const isIdempotent = String(method).toUpperCase() === "GET";

    for (let i = 0; i <= retries; i++) {
      try {
        return await axiosClient(reqConfig);
      } catch (err) {
        const requestError = err as AxiosLikeError;
        if (requestError.code === "ERR_CANCELED" || requestError.name === "CanceledError" || requestError.name === "AbortError") {
          throw err;
        }
        const status = requestError.response?.status || "N/A";
        const { isRateLimit, isRetryable4xx, is5xx, isNetworkErr, shouldRetry } = classifyHttpFailure(status, isIdempotent);
        if (!shouldRetry) {
          throw err;
        }
        if (i === retries) {
          logger("ERROR", "HTTP", `Esec final request [${status}] dupa ${retries} incercari: ${safeUrl}`, errorMessage(err));
          throw err;
        }

        let retryAfterMs: number | null = null;
        if (isRateLimit) {
          metrics().rateLimitHits++;
          retryAfterMs = parseRetryAfter(requestError.response?.headers?.["retry-after"]);
        }
        const waitMs = computeBackoffWaitMs(backoff, retryAfterMs);
        metrics().httpRetries++;
        logger("WARN", "HTTP", `Esec request [${status}] (incercarea ${i + 1}/${retries}), reincerc in ${waitMs}ms: ${safeUrl}`,
          { errMsg: errorMessage(err), is5xx, isNetworkErr, isRetryable4xx });
        await new Promise(res => setTimeout(res, waitMs));
        backoff *= 2;
      }
    }
    throw new Error(`Request failed without result: ${safeUrl}`);
  }

  const conditionalGet = createConditionalGet(httpReq, CONDITIONAL_CACHE_MAX);

  async function fetchWithProxy(targetUrl: string, options: HttpRequestOptions = {}): Promise<string> {
    const safeTargetUrl = await assertSafeExternalDnsTarget(targetUrl, "Proxy target URL", dnsLookup);
    if (!PROXY_TEMPLATES.length) {
      throw new Error("Proxy fallback neconfigurat. Seteaza PROXY_URLS pentru aceasta sursa.");
    }
    let lastErr: unknown;
    for (const template of PROXY_TEMPLATES) {
      const proxyUrl = template.replace("{url}", encodeURIComponent(safeTargetUrl));
      try {
        const res = await httpReq("GET", proxyUrl, options);
        if (template.includes("allorigins")) {
          return String(res?.data?.contents || "");
        }
        return typeof res.data === "string" ? res.data : JSON.stringify(res.data);
      } catch (err) { lastErr = err; }
    }
    const lastMessage = lastErr && typeof lastErr === "object" && "message" in lastErr
      ? String((lastErr as { message?: unknown }).message)
      : String(lastErr);
    throw new Error(`Proxy fallback epuizat: ${lastMessage}`);
  }

  function withInflightTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`Inflight timeout (${label})`)),
        INFLIGHT_PROMISE_TIMEOUT_MS
      );
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
  }

  function trackInflight<T>(map: Map<string, Promise<T>>, key: string, promise: Promise<T>): void {
    map.set(key, promise);
    const cleanup = () => {
      if (map.get(key) === promise) map.delete(key);
    };
    promise.then(cleanup, cleanup);
  }

  return {
    FETCH_CONCURRENCY,
    FETCH_CONCURRENCY_STEAM,
    FETCH_CONCURRENCY_EPIC,
    FETCH_CONCURRENCY_LISTING,
    FETCH_CONCURRENCY_DRIVER,
    MAX_HTML_BYTES,
    MAX_JSON_BYTES,
    MAX_DEALS,
    STEAM_SPECIALS_LIMIT,
    EPIC_SPECIALS_LIMIT,
    STEAM_REVIEW_BATCH_SIZE,
    STEAM_REVIEW_BATCH_DELAY_MS,
    INFLIGHT_PROMISE_TIMEOUT_MS,
    CIRCUIT_BREAKER_FAIL_THRESHOLD,
    CIRCUIT_BREAKER_COOLDOWN_MS,
    CIRCUIT_BREAKER_JITTER_MS,
    SCHEMA_DRIFT_THRESHOLD,
    ENRICHED_DEAL_CACHE_TTL_MS,
    ENRICHED_DEAL_CACHE_MAX_SIZE,
    USER_AGENTS,
    PROXY_TEMPLATES,
    assertSafeExternalUrl,
    assertSafeExternalDnsTarget: (rawUrl: unknown, label?: string) =>
      assertSafeExternalDnsTarget(rawUrl, label, dnsLookup),
    attachMetrics,
    cleanText,
    truncate,
    normalizeTitleForDedupe,
    stableUpdateId,
    normalizeUpdate,
    safeCheerioLoad,
    normalizeDealState,
    dealHash,
    httpReq,
    conditionalGet,
    fetchWithProxy,
    withInflightTimeout,
    trackInflight,
    parseRetryAfter
  };
}

function attachHttpClient(target: HttpClientContext): void {
  Object.assign(target, buildHttpClientFrom(target));
}

attachHttpClient.buildFrom = buildHttpClientFrom;
attachHttpClient.parseRetryAfter = parseRetryAfter;
attachHttpClient.assertSafeRedirect = assertSafeRedirect;
attachHttpClient.assertSafeExternalUrl = assertSafeExternalUrl;
attachHttpClient.assertSafeExternalDnsTarget = assertSafeExternalDnsTarget;
attachHttpClient.createSafeDnsLookup = createSafeDnsLookup;
attachHttpClient.resolveDefaultProxies = resolveDefaultProxies;

export = attachHttpClient;
