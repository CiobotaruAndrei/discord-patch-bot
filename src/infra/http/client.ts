import http = require("http");
import https = require("https");
import dns = require("dns");
import type { AxiosRequestConfig, AxiosResponse, AxiosStatic } from "axios";
import type {
  HttpRequestOptions,
  LoggerFunction,
  RuntimeEnv
} from "../../types";
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
import { createContentNormalization } from "./contentNormalization";
import { createInflightTracker } from "./inflightTracker";
import { createProxyClient } from "./proxyClient";

type CheerioModule = typeof import("cheerio");
type CryptoModule = typeof import("crypto");
type ContentNormalization = ReturnType<typeof createContentNormalization>;

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


const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0"
];

function buildHttpClientFrom(target: HttpClientDeps) {
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

  const metricsHolder = { ref: target.metricsRef ?? createInitialHttpMetrics() };
  function metrics(): HttpMetricsRef {
    return metricsHolder.ref;
  }

  function attachMetrics(m: HttpMetricsRef): void { metricsHolder.ref = m; }
  function getHttpMetrics(): HttpMetricsRef { return metricsHolder.ref; }

  const contentNormalization: ContentNormalization = createContentNormalization({ cheerio, maxHtmlBytes: MAX_HTML_BYTES });

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

  const { fetchWithProxy } = createProxyClient({
    proxyTemplates: PROXY_TEMPLATES,
    httpReq,
    assertSafeTarget: (rawUrl, label) => assertSafeExternalDnsTarget(rawUrl, label, dnsLookup)
  });

  const { withInflightTimeout, trackInflight } = createInflightTracker(INFLIGHT_PROMISE_TIMEOUT_MS);

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
    getHttpMetrics,
    ...contentNormalization,
    httpReq,
    conditionalGet,
    fetchWithProxy,
    withInflightTimeout,
    trackInflight,
    parseRetryAfter
  };
}

const httpClientModule = {
  buildFrom: buildHttpClientFrom,
  parseRetryAfter,
  assertSafeRedirect,
  assertSafeExternalUrl,
  assertSafeExternalDnsTarget,
  createSafeDnsLookup,
  resolveDefaultProxies
};

export = httpClientModule;
