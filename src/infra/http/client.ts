import http = require("http");
import https = require("https");
import net = require("net");
import type { AxiosRequestConfig, AxiosResponse, AxiosStatic } from "axios";
import type {
  BotMetrics,
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

type CheerioModule = typeof import("cheerio");
type CryptoModule = typeof import("crypto");
type HttpMetricsRef = Pick<BotMetrics, "fetchSuccess" | "fetchFail" | "httpRetries" | "rateLimitHits">;

interface AxiosLikeError {
  code?: string;
  name?: string;
  response?: {
    status?: number;
    headers?: Record<string, unknown>;
  };
}

interface HttpClientContext {
  axios: AxiosStatic;
  cheerio: CheerioModule;
  crypto: CryptoModule;
  env: RuntimeEnv;
  logger: LoggerFunction;
  getAbortSignal?: () => AbortSignal | null | undefined;
  metricsRef?: HttpMetricsRef;
  [key: string]: unknown;
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0"
];

const RETRY_ABLE_4XX = new Set([408, 425, 429]);

function isPrivateIPv4(hostname: string): boolean {
  const parts = hostname.split(".").map(part => Number(part));
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
}

function isPrivateIPv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    const mappedIpv4 = normalized.slice("::ffff:".length);
    return !net.isIP(mappedIpv4) || isPrivateIPv4(mappedIpv4);
  }
  const firstHextet = parseInt(normalized.split(":").find(Boolean) || "0", 16);
  return normalized === "::"
    || normalized === "::1"
    || normalized === "0:0:0:0:0:0:0:0"
    || normalized === "0:0:0:0:0:0:0:1"
    || ((firstHextet & 0xfe00) === 0xfc00)
    || ((firstHextet & 0xffc0) === 0xfe80);
}

function normalizeHostname(hostname: string): string {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    return normalized.slice(1, -1);
  }
  return normalized;
}

function isBlockedExternalHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return true;
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) return isPrivateIPv4(normalized);
  if (ipVersion === 6) return isPrivateIPv6(normalized);
  return false;
}

function assertSafeExternalUrl(rawUrl: unknown, label = "URL extern"): string {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new Error(`${label} lipseste sau nu este string.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${label} nu este URL valid.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} trebuie sa foloseasca http sau https.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} nu poate contine credentiale.`);
  }
  if (isBlockedExternalHostname(parsed.hostname)) {
    throw new Error(`${label} pointeaza catre o adresa locala sau privata.`);
  }
  return parsed.href;
}

// V11: parse Retry-After header value per RFC 7231. Accepta:
//  - seconds (delta non-negativ): "120" → 120_000ms
//  - HTTP-date absoluta: "Wed, 21 Oct 2015 07:28:00 GMT" → delta until that date
// Inainte, doar varianta seconds era recunoscuta. Pentru HTTP-date, parseInt
// returna NaN (incepe cu litera), waitIsRetryAfter ramanea false si retry-ul
// folosea backoff exponential cu jitter [0.5, 1.5) — putea cadea SUB pragul
// cerut de server, contraventionand RFC-ului si crescand riscul de IP ban.
// Returneaza null pentru valori invalide (caller continua cu backoff normal).
function parseRetryAfter(raw: unknown, nowMs: number = Date.now()): number | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  // Delta-seconds este definit ca 1*DIGIT (un sir de cifre), nu un numar
  // arbitrar — "60s" sau "0x10" nu sunt valide. parseInt singur ar accepta
  // "60abc" → 60, deci adaugam un regex strict pe sirul brut.
  if (/^\d+$/.test(trimmed)) {
    const seconds = parseInt(trimmed, 10);
    if (seconds > 0 && Number.isFinite(seconds)) return seconds * 1000;
    return null;
  }
  const asDate = Date.parse(trimmed);
  if (!isNaN(asDate)) {
    const delta = asDate - nowMs;
    if (delta > 0) return delta;
  }
  return null;
}

function normalizeProxyTemplates(rawTemplates: string, defaults: string[]): string[] {
  const candidates = rawTemplates
    ? rawTemplates.split(",").map(s => s.trim()).filter(Boolean)
    : defaults;
  const seen = new Set<string>();
  return candidates.map(template => {
    if (!template.includes("{url}")) {
      throw new Error("PROXY_URLS trebuie sa contina placeholder-ul {url}.");
    }
    const probeUrl = template.replace("{url}", encodeURIComponent("https://example.com/patch"));
    assertSafeExternalUrl(probeUrl, "PROXY_URLS template");
    return template;
  }).filter(template => {
    if (seen.has(template)) return false;
    seen.add(template);
    return true;
  });
}

function attachHttpClient(ctx: HttpClientContext): void {
  const { axios, cheerio, env, logger, getAbortSignal } = ctx;

  const FETCH_CONCURRENCY = env.FETCH_CONCURRENCY;
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
    keepAliveMsecs: 30_000
  });
  const httpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets: Math.max(FETCH_CONCURRENCY * 2, 20),
    keepAliveMsecs: 30_000
  });
  const axiosClient = axios.create({
    httpAgent,
    httpsAgent,
    decompress: true
  });

  const DEFAULT_PROXIES = env.isProd ? [] : [
    "https://api.allorigins.win/get?url={url}",
    "https://api.codetabs.com/v1/proxy?quest={url}"
  ];
  const PROXY_TEMPLATES = normalizeProxyTemplates(env.PROXY_URLS, DEFAULT_PROXIES);

  ctx.metricsRef = { fetchSuccess: 0, fetchFail: 0, httpRetries: 0, rateLimitHits: 0 };
  function metrics(): HttpMetricsRef {
    return ctx.metricsRef as HttpMetricsRef;
  }

  function attachMetrics(m: HttpMetricsRef): void { ctx.metricsRef = m; }

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
    const safeUrl = assertSafeExternalUrl(url, "HTTP URL");
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
        // V11: 429 inseamna "server-ul ne cere sa incetinim", nu "request-ul a
        // fost respins definitiv". E sigur sa-l reincercam si pe POST (cazul
        // nostru: Epic GraphQL queries care sunt semantic citiri). Inainte,
        // 429 pe POST arunca imediat si pierdeam intregul fetch de reduceri
        // Epic pana la urmatorul ciclu.
        const isRateLimit = status === 429;
        const isRetryable4xx = isRateLimit
          || (isIdempotent && typeof status === "number" && RETRY_ABLE_4XX.has(status));
        const is5xx = typeof status === "number" && status >= 500;
        const isNetworkErr = typeof status !== "number";
        if (typeof status === "number" && status >= 400 && status < 500 && !isRetryable4xx) {
          throw err;
        }
        if (i === retries) {
          logger("ERROR", "HTTP", `Esec final request [${status}] dupa ${retries} incercari: ${safeUrl}`, errorMessage(err));
          throw err;
        }

        let waitMs = backoff;
        // V11: cand server-ul ne trimite `Retry-After`, marker-am explicit asta
        // ca sa nu mai aplicam jitter [0.5, 1.5) peste valoare. Inainte, un
        // Retry-After de 30s putea ajunge sa fie asteptat doar ~15s, sub
        // pragul cerut de server — o incalcare a contractului HTTP 429 care
        // putea face peer-ul sa banneze IP-ul mai agresiv.
        let waitIsRetryAfter = false;
        if (isRateLimit) {
          metrics().rateLimitHits++;
          const retryAfter = requestError.response?.headers?.["retry-after"];
          const parsedMs = parseRetryAfter(retryAfter);
          if (parsedMs !== null) {
            // Cap la 30s: nu vrem sa blocam workerul intregul ciclu pentru un
            // server care cere ore intregi de pauza.
            waitMs = Math.min(parsedMs, 30000);
            waitIsRetryAfter = true;
          }
        }

        if (waitIsRetryAfter) {
          // Jitter pozitiv [1.0, 1.25] — niciodata sub valoarea ceruta de server,
          // dar evitam thundering herd cand multi clienti primesc acelasi
          // Retry-After in acelasi timp.
          waitMs = Math.round(waitMs * (1 + Math.random() * 0.25));
        } else {
          waitMs = Math.round(waitMs * (0.5 + Math.random()));
        }
        metrics().httpRetries++;
        logger("WARN", "HTTP", `Esec request [${status}] (incercarea ${i + 1}/${retries}), reincerc in ${waitMs}ms: ${safeUrl}`,
          { errMsg: errorMessage(err), is5xx, isNetworkErr, isRetryable4xx });
        await new Promise(res => setTimeout(res, waitMs));
        backoff *= 2;
      }
    }
    throw new Error(`Request failed without result: ${safeUrl}`);
  }

  async function fetchWithProxy(targetUrl: string, options: HttpRequestOptions = {}): Promise<string> {
    const safeTargetUrl = assertSafeExternalUrl(targetUrl, "Proxy target URL");
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

  Object.assign(ctx, {
    FETCH_CONCURRENCY,
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
    fetchWithProxy,
    withInflightTimeout,
    trackInflight,
    parseRetryAfter
  });
}

// Expose pure helpers on the function itself so tests can import them without
// going through the full ctx setup. `export =` keeps the default-callable
// signature that the rest of the codebase relies on.
attachHttpClient.parseRetryAfter = parseRetryAfter;
attachHttpClient.assertSafeExternalUrl = assertSafeExternalUrl;

export = attachHttpClient;