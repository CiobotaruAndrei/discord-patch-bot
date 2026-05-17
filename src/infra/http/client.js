"use strict";

const http = require("http");
const https = require("https");

module.exports = (ctx) => {
  const { axios, cheerio, crypto, env, logger } = ctx;

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

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0"
];

const DEFAULT_PROXIES = env.isProd ? [] : [
  "https://api.allorigins.win/get?url={url}",
  "https://api.codetabs.com/v1/proxy?quest={url}"
];
const PROXY_TEMPLATES = env.PROXY_URLS
  ? env.PROXY_URLS.split(",").map(s => s.trim()).filter(Boolean)
  : DEFAULT_PROXIES;

// -------------------------------------------------------------
// METRICI
// -------------------------------------------------------------
ctx.metricsRef = { fetchSuccess: 0, fetchFail: 0, httpRetries: 0, rateLimitHits: 0 };
function attachMetrics(m) { ctx.metricsRef = m; }

// -------------------------------------------------------------
// UTILE
// -------------------------------------------------------------
const HTML_ENTITIES = {
  nbsp: " ", amp: "&", quot: '"', "#39": "'", apos: "'", lt: "<", gt: ">"
};
const CLEAN_REGEX = /<[^>]+>|&(nbsp|amp|quot|#39|apos|lt|gt);|\s+/gi;

function cleanText(text) {
  const str = String(text || "");
  if (!str) return "";
  const cleaned = str.replace(CLEAN_REGEX, (match, entity) => {
    if (entity) {
      const replacement = HTML_ENTITIES[entity.toLowerCase()];
      return replacement !== undefined ? replacement : match;
    }
    return " ";
  });
  return cleaned.replace(/\s+/g, " ").trim();
}

function truncate(str, maxLen) {
  const t = String(str || "");
  return t.length > maxLen ? t.substring(0, maxLen - 3) + "..." : t;
}

function normalizeTitleForDedupe(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[\u00ae\u00a9\u2122]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stableUpdateId(title, link) {
  const base = `${String(title || "")}|${String(link || "")}`;
  return crypto.createHash("sha1").update(base).digest("hex").substring(0, 16);
}

function normalizeUpdate(data) {
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
  };
}

function safeCheerioLoad(html) {
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

function normalizeDealState(deal) {
  return [
    deal.salePrice ?? "",
    deal.normalPrice ?? "",
    deal.savings ?? ""
  ].map(v => String(v).trim().toLowerCase()).join(":");
}

function dealHash(deal) {
  let stableKey;
  if (deal.store === "Steam" && deal.steamAppID) {
    stableKey = `steam:${deal.steamAppID}:${normalizeDealState(deal)}`;
  } else if (deal.store === "Epic Games" && deal.id) {
    const rawId = String(deal.id).replace(/^epic_/, "");
    stableKey = `epic:${rawId}:${normalizeDealState(deal)}`;
  } else {
    stableKey = `${deal.store}:${normalizeTitleForDedupe(deal.title)}:${normalizeDealState(deal)}`;
  }
  return crypto.createHash("sha1").update(stableKey).digest("hex");
}

// -------------------------------------------------------------
// HTTP
// -------------------------------------------------------------
const RETRY_ABLE_4XX = new Set([408, 425, 429]);

async function httpReq(method, url, options = {}, retries = 2, backoff = 1000) {
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

  const reqConfig = {
    method,
    url,
    timeout: options.timeout || 15000,
    maxContentLength: contentLimit,
    maxBodyLength: bodyLimit,
    headers: mergedHeaders
  };
  if (options.data) reqConfig.data = options.data;

  const isIdempotent = String(method).toUpperCase() === "GET";

  for (let i = 0; i <= retries; i++) {
    try {
      return await axiosClient(reqConfig);
    } catch (err) {
      const status = err.response?.status || "N/A";
      const isRetryable4xx = isIdempotent && typeof status === "number"
        && RETRY_ABLE_4XX.has(status);
      const is5xx = typeof status === "number" && status >= 500;
      const isNetworkErr = typeof status !== "number";
      if (typeof status === "number" && status >= 400 && status < 500 && !isRetryable4xx) {
        throw err;
      }
      if (i === retries) {
        logger("ERROR", "HTTP", `Eșec final request [${status}] după ${retries} încercări: ${url}`, err.message);
        throw err;
      }

      let waitMs = backoff;
      if (status === 429) {
        ctx.metricsRef.rateLimitHits++;
        const retryAfter = err.response?.headers?.["retry-after"];
        if (retryAfter) {
          const parsed = parseInt(retryAfter, 10);
          if (!isNaN(parsed) && parsed > 0) waitMs = Math.min(parsed * 1000, 30000);
        }
      }

      waitMs = Math.round(waitMs * (0.5 + Math.random()));
      ctx.metricsRef.httpRetries++;
      logger("WARN", "HTTP", `Eșec request [${status}] (încercarea ${i + 1}/${retries}), reîncerc în ${waitMs}ms: ${url}`,
        { errMsg: err.message, is5xx, isNetworkErr, isRetryable4xx });
      await new Promise(res => setTimeout(res, waitMs));
      backoff *= 2;
    }
  }
}

async function fetchWithProxy(targetUrl, options = {}) {
  if (!PROXY_TEMPLATES.length) {
    throw new Error("Proxy fallback neconfigurat. Setează PROXY_URLS pentru această sursă.");
  }
  let lastErr;
  for (const template of PROXY_TEMPLATES) {
    const proxyUrl = template.replace("{url}", encodeURIComponent(targetUrl));
    try {
      const res = await httpReq("GET", proxyUrl, options);
      if (template.includes("allorigins")) {
        return String(res?.data?.contents || "");
      }
      return typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    } catch (err) { lastErr = err; }
  }
  throw new Error(`Proxy fallback epuizat: ${lastErr?.message}`);
}

function withInflightTimeout(promise, label) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`Inflight timeout (${label})`)),
      INFLIGHT_PROMISE_TIMEOUT_MS
    );
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

// V9: helper pentru in-flight coalescing safe.
// Setează map[key]=promise întâi, apoi atașează cleanup care șterge
// DOAR dacă entry-ul curent e încă promise-ul nostru. Evită orfanizarea
// dacă timeout-ul wrap-ului expiră dar inner-ul mai rulează.
function trackInflight(map, key, promise) {
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
    trackInflight
  });
};
