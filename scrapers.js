"use strict";
// =============================================================
// scrapers.js — V9
//   * extractSteamOfferEndDate primește currency (cc dinamic)
//   * enrichDealData adaugă ?cc=&l=english pe HTML scrape Steam
//   * In-flight coalescing: cleanup safe (verifică identitatea
//     promise-ului înainte de delete) — evită orfanizarea
//   * Restul V8: schema drift, currency-aware, proxy-uri
// =============================================================
const axios = require("axios");
const cheerio = require("cheerio");
const Parser = require("rss-parser");
const crypto = require("crypto");
const {
  CircuitBreakerModel, logger, adminAlert, env, runConcurrent,
  SchemaDriftError, getCurrencyConfig, formatPrice
} = require("./db");

const rssParser = new Parser();

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
let metricsRef = { fetchSuccess: 0, fetchFail: 0, httpRetries: 0, rateLimitHits: 0 };
function attachMetrics(m) { metricsRef = m; }

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
    .replace(/[®©™]/g, "")
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
  const buf = Buffer.from(str, "utf8").subarray(0, MAX_HTML_BYTES);
  return cheerio.load(buf.toString("utf8"));
}

function normalizeDealState(deal) {
  return [
    deal.salePrice ?? "",
    deal.normalPrice ?? "",
    deal.savings ?? "",
    deal.endDateStr ?? ""
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
      return await axios(reqConfig);
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
        metricsRef.rateLimitHits++;
        const retryAfter = err.response?.headers?.["retry-after"];
        if (retryAfter) {
          const parsed = parseInt(retryAfter, 10);
          if (!isNaN(parsed) && parsed > 0) waitMs = Math.min(parsed * 1000, 30000);
        }
      }

      waitMs = Math.round(waitMs * (0.5 + Math.random()));
      metricsRef.httpRetries++;
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

// -------------------------------------------------------------
// SCORE HELPERS
// -------------------------------------------------------------
function absoluteUrl(base, maybeRelative) {
  try { return new URL(maybeRelative, base).href; } catch { return ""; }
}

function isGoodSteamArticleUrl(url) {
  const v = String(url || "").trim().toLowerCase();
  return !(!v || !v.startsWith("http") || v.includes("steamstatic") || v.includes("steamcdn"));
}

function extractDateScore(url) {
  const u = url.toLowerCase();
  const m1 = u.match(/(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (m1) {
    const year = parseInt(m1[1], 10);
    const month = parseInt(m1[2], 10);
    const day = parseInt(m1[3], 10);
    if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const t = Date.UTC(year, month - 1, day);
      if (!isNaN(t)) return t;
    }
  }
  return 0;
}

function scoreCandidate(candidate, keywords) {
  const haystack = `${candidate.href} ${candidate.text}`.toLowerCase();
  let score = 0;
  for (const k of keywords) if (haystack.includes(String(k).toLowerCase())) score += 1;
  return score;
}

function isLikelyPatchNote(item) {
  const title = String(item.title || "").toLowerCase();
  const contents = String(item.contents || "").toLowerCase();
  const tags = Array.isArray(item.tags) ? item.tags.map(t => String(t).toLowerCase()) : [];
  const text = `${title} ${contents}`;
  const badInTitle = ["community", "sale", "store", "merch", "tournament", "esports", "giveaway", "teaser", "trailer", "preview", "announce", "announcement"];
  if (badInTitle.some(w => title.includes(w))) return false;
  if (tags.includes("patchnotes") || tags.includes("update")) return true;
  const goodWords = ["update", "patch", "hotfix", "version", "release", "bugfix", "bug fix", "fixes", "fix", "notes", "patch notes", "changelog", "maintenance", "build", "client update", "title update", "release notes", "season", "chapter", "rework", "balance", "content update", "launch"];
  return goodWords.some(w => text.includes(w));
}

// -------------------------------------------------------------
// FETCH PER TIP
// -------------------------------------------------------------
async function fetchSteamUpdate(game) {
  const response = await httpReq("GET",
    `https://api.steampowered.com/ISteamNews/GetNewsForApp/v0002/?appid=${game.appId}&count=50&format=json`,
    { largeJson: true });
  const patchNotes = (response?.data?.appnews?.newsitems || [])
    .filter(item => (item.feed_type === 1 || item.feedname === "steam_community_announcements")
      && isGoodSteamArticleUrl(item.url) && isLikelyPatchNote(item))
    .sort((a, b) => Number(b.date || 0) - Number(a.date || 0));
  if (!patchNotes.length) throw new Error("Lipsă patch notes Steam valabile.");
  const latest = patchNotes[0];
  const rawContents = String(latest.contents || "").replace(/https?:\/\/[^\s]+/gi, "").replace(/\[.*?\]/g, " ");
  return normalizeUpdate({
    id: String(latest.gid),
    title: cleanText(latest.title),
    link: String(latest.url),
    excerpt: rawContents,
    fullText: rawContents,
    timestamp: latest.date ? new Date(latest.date * 1000).toISOString() : ""
  });
}

async function fetchListingBasedUpdate(game) {
  const listingUrls = Array.isArray(game.listingUrls) && game.listingUrls.length
    ? game.listingUrls : [game.listingUrl];
  const keywords = Array.isArray(game.requireKeywords) ? game.requireKeywords : [];
  const hrefRegex = game.articleHrefRegex ? new RegExp(game.articleHrefRegex, "i") : null;

  const collected = [];
  let listingFetched = 0;
  for (const url of listingUrls) {
    try {
      const listRes = await httpReq("GET", url);
      listingFetched++;
      const $ = safeCheerioLoad(listRes.data);
      let position = 0;
      $("a").each((i, el) => {
        const href = absoluteUrl(game.baseUrl, $(el).attr("href"));
        if (!href || (hrefRegex && !hrefRegex.test(href))) return;
        const candidate = { href, text: cleanText($(el).text()), position: position++ };
        if (keywords.length > 0 && scoreCandidate(candidate, keywords) === 0) return;
        collected.push(candidate);
      });
    } catch (err) {
      logger("WARN", "SCRAPE", `Eroare preluare listing url ${url}`, err.message);
    }
  }

  const seen = new Set();
  const unique = collected.filter(item => {
    if (!item.href || seen.has(item.href)) return false;
    seen.add(item.href);
    return true;
  });
  unique.sort((a, b) => {
    if (keywords.length) {
      const s = scoreCandidate(b, keywords) - scoreCandidate(a, keywords);
      if (s !== 0) return s;
    }
    const d = extractDateScore(b.href) - extractDateScore(a.href);
    if (d !== 0) return d;
    return a.position - b.position;
  });

  if (!unique.length) {
    if (listingFetched > 0) {
      throw new SchemaDriftError(
        `Listing fetch-uit cu succes dar 0 ancore valide pentru ${game.key}`,
        `listing:${game.key}`
      );
    }
    throw new Error("Nu am găsit ancore valide.");
  }
  const articleUrl = unique[0].href;
  const articleRes = await httpReq("GET", articleUrl, { timeout: 8000 });
  const $art = safeCheerioLoad(articleRes.data || "");
  const ogTitle = $art('meta[property="og:title"]').attr("content") || $art("title").text() || "";
  const ogDesc = $art('meta[property="og:description"]').attr("content") || "";
  $art("script, style, nav, footer, header").remove();
  const rawContent = $art("article").text() || $art("main").text() || $art("body").text();
  return normalizeUpdate({
    id: String(articleUrl),
    title: cleanText(ogTitle) || `${game.name} Update`,
    link: articleUrl,
    excerpt: cleanText(ogDesc),
    fullText: cleanText(rawContent),
    thumbnail: game.thumbnail
  });
}

async function fetchFortniteUpdate() {
  try {
    const posts = JSON.parse(await fetchWithProxy(
      "https://www.fortnite.com/api/blog/getPosts?postsPerPage=10&offset=0&locale=en-US",
      { timeout: 15000 }
    ) || "{}")?.blogList;
    const valid = (posts || []).filter(p => p.slug && p.slug.toLowerCase() !== "news");
    if (!valid.length) throw new Error("Nu am găsit postări valide");
    const latest = valid.find(p => /update|patch|\bv\d+/i.test(String(p.title))) || valid[0];
    return normalizeUpdate({
      id: String(latest.slug),
      title: cleanText(latest.title),
      link: `https://www.fortnite.com/news/${latest.slug}`,
      excerpt: cleanText(latest.shareDescription),
      thumbnail: "https://seeklogo.com/images/F/fortnite-logo-4C22EED4A9-seeklogo.com.png",
      timestamp: latest.date
    });
  } catch (err) {
    const backupUrl = "https://news.google.com/rss/search?q=site:fortnite.com/news+update&hl=en-US";
    const feed = await rssParser.parseString((await httpReq("GET", backupUrl)).data);
    if (!feed.items || feed.items.length === 0) throw new Error("Eșec total Fortnite.");
    return normalizeUpdate({
      id: stableUpdateId(feed.items[0].title, ""),
      title: cleanText(feed.items[0].title),
      link: feed.items[0].link,
      excerpt: "Update oficial Fortnite.",
      thumbnail: "https://seeklogo.com/images/F/fortnite-logo-4C22EED4A9-seeklogo.com.png",
      timestamp: feed.items[0].pubDate
    });
  }
}

async function fetchAmdUpdate(game) {
  try {
    const rawContent = await fetchWithProxy("https://www.amd.com/en/support/download/drivers.html");
    const match = rawContent.match(/Adrenalin Edition\s+([\d\.]+)/i);
    if (match) return normalizeUpdate({
      id: match[1],
      title: `AMD Radeon Adrenalin v${match[1]}`,
      link: "https://www.amd.com",
      excerpt: "Driver disponibil.",
      thumbnail: game.thumbnail
    });
  } catch (err) {
    logger("WARN", "SCRAPE", "Eroare preluare AMD proxy", err.message);
  }
  const res = await httpReq("GET",
    "https://news.google.com/rss/search?q=site:amd.com+%22AMD+Software:+Adrenalin+Edition%22+release+notes&hl=en-US");
  const feed = await rssParser.parseString(res.data);
  if (!feed.items || feed.items.length === 0) throw new Error("Eșec AMD.");
  const cleanTitle = cleanText(feed.items[0].title);
  return normalizeUpdate({
    id: stableUpdateId(cleanTitle.split(" - ")[0], ""),
    title: cleanTitle.split(" - ")[0],
    link: feed.items[0].link,
    excerpt: "Update AMD.com.",
    thumbnail: game.thumbnail,
    timestamp: feed.items[0].pubDate
  });
}

async function fetchIntelUpdate(game) {
  try {
    const rawContent = await fetchWithProxy(game.url);
    const match = rawContent.match(/\b(\d{2,3}\.\d+\.\d+\.\d+)\b/);
    if (match) return normalizeUpdate({
      id: match[1],
      title: `${game.name} v${match[1]}`,
      link: game.url,
      excerpt: `Versiune găsită: ${match[1]}`,
      thumbnail: game.thumbnail
    });
  } catch (err) {
    logger("WARN", "SCRAPE", "Eroare preluare Intel proxy", err.message);
  }
  const q = game.key === "intelpro"
    ? 'site:intel.com "Intel Arc Pro Graphics"'
    : 'site:intel.com "Intel Arc & Iris Xe Graphics - Windows"';
  const res = await httpReq("GET",
    `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US`);
  const feed = await rssParser.parseString(res.data);
  if (!feed.items || feed.items.length === 0) throw new Error("Eșec Intel.");
  const cleanTitle = cleanText(feed.items[0].title);
  return normalizeUpdate({
    id: stableUpdateId(cleanTitle.split(" - ")[0], ""),
    title: cleanTitle.split(" - ")[0],
    link: feed.items[0].link,
    excerpt: "Update intel.com detectat.",
    thumbnail: game.thumbnail,
    timestamp: feed.items[0].pubDate
  });
}

async function fetchMinecraftUpdate() {
  const r = await httpReq("GET", "https://pistonmeta.mojang.com/mc/game/version_manifest_v2.json",
    { largeJson: true });
  const v = r?.data?.latest?.release;
  if (!v) throw new Error("Lipsă versiune JSON");
  return normalizeUpdate({
    id: v,
    title: `Minecraft ${v}`,
    link: `https://www.minecraft.net/en-us/article/minecraft-java-edition-${v.replace(/\./g, "-")}`,
    excerpt: `Versiunea ${v}`,
    thumbnail: "https://static.wikia.nocookie.net/logopedia/images/6/64/Minecraft_Grass_Block.svg"
  });
}

async function fetchRobloxUpdate() {
  const r = await httpReq("GET", "https://clientsettings.roblox.com/v2/clientversion/WindowsPlayer");
  const v = r?.data?.clientVersionUpload;
  if (!v) throw new Error("Lipsă versiune API");
  return normalizeUpdate({
    id: String(v),
    title: "Roblox Update",
    link: "https://en.help.roblox.com/hc/en-us",
    excerpt: `Versiunea ${v}`,
    thumbnail: "https://upload.wikimedia.org/wikipedia/commons/7/7e/Roblox_Logo_2022.jpg"
  });
}

async function fetchNvidiaUpdate(g) {
  const q = g.key === "nvidiastudio" ? '"Studio Driver"' : '"Game Ready Driver"';
  const r = await httpReq("GET",
    `https://news.google.com/rss/search?q=${encodeURIComponent(`site:nvidia.com ${q} release`)}&hl=en-US`);
  const f = await rssParser.parseString(r.data);
  if (!f.items || f.items.length === 0) throw new Error("Eșec Nvidia.");
  const cleanTitle = cleanText(f.items[0].title).split(" - ")[0];
  return normalizeUpdate({
    id: stableUpdateId(cleanTitle, ""),
    title: cleanTitle,
    link: f.items[0].link,
    thumbnail: g.thumbnail
  });
}

// -------------------------------------------------------------
// DISPATCHER
// -------------------------------------------------------------
async function fetchGameUpdate(game) {
  const t = game.type;
  if (!t || t === "steam") return fetchSteamUpdate(game);
  if (t === "minecraft") return fetchMinecraftUpdate();
  if (t === "epic_games" && game.key === "fortnite") return fetchFortniteUpdate();
  if (t === "roblox") return fetchRobloxUpdate();
  if (t === "nvidia") return fetchNvidiaUpdate(game);
  if (t === "intel") return fetchIntelUpdate(game);
  if (t === "amd") return fetchAmdUpdate(game);
  if (t === "listing_based" || t === "epic_games") return fetchListingBasedUpdate(game);
  throw new Error("Tip necunoscut.");
}

// -------------------------------------------------------------
// CIRCUIT BREAKER + SCHEMA DRIFT DETECTION
// -------------------------------------------------------------
async function executeFetchWithCircuitBreaker(game) {
  const cb = await CircuitBreakerModel.findOneAndUpdate(
    { _id: game.key },
    { $setOnInsert: { fails: 0, cooldownUntil: null, alertSent: false, schemaDriftFails: 0, schemaDriftAlertSent: false } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  if (cb.cooldownUntil && new Date() < cb.cooldownUntil) {
    return { game, latest: null, error: "Circuit Breaker Activ" };
  }
  try {
    const latest = await fetchGameUpdate(game);
    if (cb.fails > 0 || cb.cooldownUntil || cb.alertSent || cb.schemaDriftFails > 0 || cb.schemaDriftAlertSent) {
      await CircuitBreakerModel.updateOne(
        { _id: game.key },
        { $set: { fails: 0, cooldownUntil: null, alertSent: false, schemaDriftFails: 0, schemaDriftAlertSent: false } }
      );
    }
    metricsRef.fetchSuccess++;
    return { game, latest, error: null };
  } catch (error) {
    if (error instanceof SchemaDriftError) {
      const updatedCb = await CircuitBreakerModel.findOneAndUpdate(
        { _id: game.key },
        { $inc: { schemaDriftFails: 1 } },
        { new: true, upsert: true }
      );
      if (updatedCb.schemaDriftFails >= SCHEMA_DRIFT_THRESHOLD && !updatedCb.schemaDriftAlertSent) {
        await CircuitBreakerModel.updateOne({ _id: game.key }, { $set: { schemaDriftAlertSent: true } });
        await adminAlert(
          `drift:${game.key}`,
          `Schema drift suspectat: ${game.name}`,
          `Sursa pentru \`${game.key}\` returnează HTTP OK dar 0 rezultate valide după ${updatedCb.schemaDriftFails} cicluri consecutive. Probabil selectorii CSS/HTML s-au schimbat.\nSursă: ${error.source}\nMesaj: ${error.message}`
        );
      }
      metricsRef.fetchFail++;
      return { game, latest: null, error: error.message };
    }

    const updatedCb = await CircuitBreakerModel.findOneAndUpdate(
      { _id: game.key },
      { $inc: { fails: 1 } },
      { new: true, upsert: true }
    );
    if (updatedCb.fails >= CIRCUIT_BREAKER_FAIL_THRESHOLD
        && (!updatedCb.cooldownUntil || new Date() >= updatedCb.cooldownUntil)) {
      const jitter = Math.floor(Math.random() * CIRCUIT_BREAKER_JITTER_MS);
      await CircuitBreakerModel.updateOne(
        { _id: game.key },
        { $set: { cooldownUntil: new Date(Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS + jitter) } }
      );
      if (!updatedCb.alertSent) {
        await CircuitBreakerModel.updateOne({ _id: game.key }, { $set: { alertSent: true } });
        await adminAlert(
          `cb:${game.key}`,
          `Circuit breaker activat: ${game.name}`,
          `Sursa pentru \`${game.key}\` a eșuat de ${updatedCb.fails} ori consecutiv. Cooldown ~${Math.round(CIRCUIT_BREAKER_COOLDOWN_MS/60000)}-${Math.round((CIRCUIT_BREAKER_COOLDOWN_MS+CIRCUIT_BREAKER_JITTER_MS)/60000)} min.\nUltima eroare: ${error.message}`
        );
      }
    }
    metricsRef.fetchFail++;
    return { game, latest: null, error: error.message };
  }
}

// -------------------------------------------------------------
// POOL CONCURRENT + IN-FLIGHT COALESCING — V9 safe cleanup
// -------------------------------------------------------------
const inflightAllGames = new Map();

async function _getLatestForAllGamesImpl(games, shouldAbort) {
  const list = games.slice();
  const results = new Array(list.length);

  await runConcurrent(list, FETCH_CONCURRENCY, async (game, idx) => {
    results[idx] = await executeFetchWithCircuitBreaker(game);
  }, {
    shouldAbort,
    errorLogger: (game, err) => {
      logger("WARN", "FETCH_WORKER", `Eroare la procesarea ${game.key}`, err.message);
    }
  });

  for (let i = 0; i < results.length; i++) {
    if (!results[i]) {
      results[i] = { game: list[i], latest: null, error: "abort" };
    }
  }
  return results;
}

async function getLatestForAllGames(games, shouldAbort) {
  const contextKey = shouldAbort ? "cron" : "manual";
  const existing = inflightAllGames.get(contextKey);
  if (existing) {
    logger("INFO", "FETCH_COALESCE", `Refolosesc fetch-ul în curs (context=${contextKey})`);
    return existing;
  }
  const promise = withInflightTimeout(
    _getLatestForAllGamesImpl(games, shouldAbort),
    `getLatestForAllGames(${contextKey})`
  );
  trackInflight(inflightAllGames, contextKey, promise);
  return promise;
}

// -------------------------------------------------------------
// STEAM REVIEW
// -------------------------------------------------------------
async function fetchSteamReviewData(appId) {
  try {
    const res = await httpReq("GET",
      `https://store.steampowered.com/appreviews/${appId}?json=1&language=all&num_per_page=0`,
      { largeJson: true }, 3, 800);
    const summary = res.data?.query_summary;
    if (summary) {
      const totalReviews = summary.total_reviews || 0;
      const positiveReviews = summary.total_positive || 0;
      const qualityPercent = totalReviews > 0 ? Math.round((positiveReviews / totalReviews) * 100) : 0;
      return { totalReviews, qualityPercent, success: true };
    }
    return { totalReviews: 0, qualityPercent: 0, success: false };
  } catch (err) {
    logger("WARN", "STEAM_REVIEW", `Eroare preluare review Steam appID ${appId}`, err.message);
    return { totalReviews: 0, qualityPercent: 0, success: false };
  }
}

// -------------------------------------------------------------
// ENRICH DEAL DATA — V9: cc dinamic și pe HTML scrape
// -------------------------------------------------------------
const activeEnrichments = new Map();
const enrichedCache = new Map();

function enrichCacheGet(key, currency) {
  const v = enrichedCache.get(key);
  if (!v) return null;
  if (v.expiresAt < Date.now()) { enrichedCache.delete(key); return null; }
  if (v.currency !== currency) return null;
  enrichedCache.delete(key);
  enrichedCache.set(key, v);
  return v.enriched;
}

function enrichCacheSet(key, enriched, currency) {
  if (ENRICHED_DEAL_CACHE_MAX_SIZE === 0 || ENRICHED_DEAL_CACHE_TTL_MS === 0) return;
  if (enrichedCache.has(key)) enrichedCache.delete(key);
  enrichedCache.set(key, {
    enriched,
    currency,
    expiresAt: Date.now() + ENRICHED_DEAL_CACHE_TTL_MS
  });
  while (enrichedCache.size > ENRICHED_DEAL_CACHE_MAX_SIZE) {
    const oldest = enrichedCache.keys().next().value;
    if (oldest === undefined) break;
    enrichedCache.delete(oldest);
  }
}

function cleanEnrichedCache() {
  const now = Date.now();
  for (const [k, v] of enrichedCache.entries()) {
    if (v.expiresAt < now) enrichedCache.delete(k);
  }
}

function getEnrichedCacheSize() {
  return enrichedCache.size;
}

async function enrichDealData(deal, currencyCode) {
  const currency = String(currencyCode || "USD").toUpperCase();
  if (deal.enriched) return deal;

  const cached = enrichCacheGet(deal.id, currency);
  if (cached) return cached;

  const inflightKey = `${deal.id}:${currency}`;
  const existing = activeEnrichments.get(inflightKey);
  if (existing) return existing;

  const enrichTask = (async () => {
    const enriched = { ...deal };
    if (enriched.store === "Steam" && enriched.steamAppID) {
      const cfg = getCurrencyConfig(currency);
      try {
        // V9: pagina HTML primește și ea cc + l=english pentru consistență
        const htmlUrl = `${enriched.link}?cc=${cfg.cc}&l=english`;
        const [detailsRes, htmlRes] = await Promise.all([
          httpReq("GET",
            `https://store.steampowered.com/api/appdetails?appids=${enriched.steamAppID}&cc=${cfg.cc}&l=english`,
            { timeout: 5000, largeJson: true }).catch(e => {
              logger("WARN", "STEAM_ENRICH", `appdetails fail appID ${enriched.steamAppID}`, e.message);
              return null;
            }),
          httpReq("GET", htmlUrl, {
            headers: { "Cookie": "birthtime=283993201; mature_content=1;" }
          }).catch(e => {
            logger("WARN", "STEAM_ENRICH", `html fetch fail appID ${enriched.steamAppID}`, e.message);
            return null;
          })
        ]);

        const data = detailsRes?.data?.[enriched.steamAppID]?.data;
        if (data && data.platforms) {
          enriched.extraDetails = (enriched.extraDetails || "")
            + `\n**Platforme:** ${[data.platforms.windows ? "Win" : "", data.platforms.mac ? "Mac" : "", data.platforms.linux ? "Lin" : ""].filter(Boolean).join(", ")}`;
        }
        if (htmlRes?.data) {
          const match = htmlRes.data.match(/Offer ends\s+([^<]+)/i);
          if (match && match[1]) enriched.endDateStr = match[1].trim();
        }
      } catch (e) {
        logger("WARN", "STEAM_ENRICH", `Eroare enrich oferta Steam appID ${enriched.steamAppID}`, e.message);
      }
    }
    enriched.enriched = true;
    enrichCacheSet(deal.id, enriched, currency);
    return enriched;
  })();

  activeEnrichments.set(inflightKey, enrichTask);
  try {
    return await enrichTask;
  } finally {
    activeEnrichments.delete(inflightKey);
  }
}

// -------------------------------------------------------------
// FETCH DEALS — V9: cleanup safe
// -------------------------------------------------------------
const inflightDeals = new Map();

async function _fetchDealsImpl(currencyCode) {
  const cfg = getCurrencyConfig(currencyCode);
  const cc = cfg.cc;

  const deals = [];
  try {
    const steamRes = await httpReq("GET",
      `https://store.steampowered.com/api/featuredcategories/?cc=${cc}&l=english`,
      { largeJson: true });
    const steamSpecials = (steamRes.data?.specials?.items || []).slice(0, STEAM_SPECIALS_LIMIT);

    const reviewsData = [];
    for (let i = 0; i < steamSpecials.length; i += STEAM_REVIEW_BATCH_SIZE) {
      const chunk = steamSpecials.slice(i, i + STEAM_REVIEW_BATCH_SIZE);
      const chunkPromises = chunk.map(item => fetchSteamReviewData(item.id));
      const chunkResults = await Promise.all(chunkPromises);
      reviewsData.push(...chunkResults);
      if (STEAM_REVIEW_BATCH_DELAY_MS > 0) {
        await new Promise(res => setTimeout(res, STEAM_REVIEW_BATCH_DELAY_MS));
      }
    }

    for (let i = 0; i < steamSpecials.length; i++) {
      const item = steamSpecials[i];
      const revData = reviewsData[i];
      const normalPrice = (item.original_price / 100).toFixed(2);
      const salePrice = (item.final_price / 100).toFixed(2);
      const savings = item.discount_percent || 0;
      const wSavings = savings * 0.8;
      const wQuality = revData.success ? revData.qualityPercent * 1.0 : 50;
      const wBonus = revData.success ? Math.min(25, Math.floor(revData.totalReviews / 1000)) : 0;
      const hybridScore = wSavings + wQuality + wBonus;
      deals.push({
        id: `steam_${item.id}`,
        steamAppID: item.id,
        title: item.name,
        salePrice, normalPrice, savings,
        store: "Steam",
        link: `https://store.steampowered.com/app/${item.id}`,
        popularityScore: hybridScore,
        totalReviews: revData.totalReviews,
        qualityScore: revData.success ? revData.qualityPercent : 0,
        endDateStr: "Nespecificat",
        extraDetails: "",
        enriched: false,
        thumbnail: item.header_image || null,
        currency: currencyCode || "USD"
      });
    }
  } catch (err) {
    logger("WARN", "DEALS_FETCH", "Eroare Steam API", err.message);
  }

  try {
    const epicQuery = `query searchStoreQuery($category: String, $count: Int, $country: String!, $locale: String, $onSale: Boolean, $withPrice: Boolean = false) { Catalog { searchStore(category: $category, count: $count, country: $country, locale: $locale, onSale: $onSale) { elements { title id urlSlug keyImages { type url } price(country: $country) @include(if: $withPrice) { totalPrice { discountPrice originalPrice } } promotions { promotionalOffers { promotionalOffers { endDate discountSetting { discountPercentage } } } } } } } }`;
    const epicVars = {
      category: "games/edition/base|bundles/games",
      count: EPIC_SPECIALS_LIMIT,
      country: cc, locale: "en-US", onSale: true, withPrice: true
    };
    const epicRes = await httpReq("POST", "https://graphql.epicgames.com/graphql", {
      data: { query: epicQuery, variables: epicVars },
      largeJson: true,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Origin": "https://store.epicgames.com",
        "Referer": "https://store.epicgames.com/",
        "Content-Type": "application/json",
        "Accept": "application/json"
      }
    });

    const epicElements = epicRes.data?.data?.Catalog?.searchStore?.elements || [];
    for (const item of epicElements) {
      const priceInfo = item.price?.totalPrice;
      if (!priceInfo) continue;
      const normalPrice = (priceInfo.originalPrice / 100).toFixed(2);
      const salePrice = (priceInfo.discountPrice / 100).toFixed(2);
      let savings = 0;
      if (priceInfo.originalPrice > 0) {
        savings = Math.round(((priceInfo.originalPrice - priceInfo.discountPrice) / priceInfo.originalPrice) * 100);
      }
      const hybridScore = savings * 0.8 + 80.0 + 15.0;

      let thumb = null;
      if (Array.isArray(item.keyImages)) {
        const img = item.keyImages.find(i => i.type === "OfferImageWide" || i.type === "Thumbnail");
        if (img) thumb = img.url;
      }
      let endDate = "Nespecificat";
      const promos = item.promotions?.promotionalOffers?.[0]?.promotionalOffers?.[0];
      if (promos && promos.endDate) endDate = new Date(promos.endDate).toLocaleDateString("ro-RO");
      const urlSlug = item.urlSlug || item.id;

      deals.push({
        id: `epic_${item.id}`,
        steamAppID: null,
        title: item.title,
        salePrice, normalPrice, savings,
        store: "Epic Games",
        link: `https://store.epicgames.com/en-US/p/${urlSlug}`,
        popularityScore: hybridScore,
        totalReviews: 0,
        qualityScore: 80,
        endDateStr: endDate,
        extraDetails: "",
        enriched: true,
        thumbnail: thumb,
        currency: currencyCode || "USD"
      });
    }
  } catch (err) {
    logger("WARN", "DEALS_FETCH", "Eroare Epic GraphQL", err.message);
  }

  const dedupeMap = new Map();
  for (const deal of deals) {
    const key = normalizeTitleForDedupe(deal.title);
    if (!key) { dedupeMap.set(deal.id, deal); continue; }
    const existing = dedupeMap.get(key);
    if (!existing || deal.popularityScore > existing.popularityScore) {
      dedupeMap.set(key, deal);
    }
  }
  const finalTop = Array.from(dedupeMap.values())
    .sort((a, b) => b.popularityScore - a.popularityScore)
    .slice(0, MAX_DEALS);
  if (!finalTop.length) throw new Error("Fără oferte valide.");
  return finalTop;
}

async function fetchDeals(opts = {}) {
  const currency = String(opts.currency || "USD").toUpperCase();
  const contextKey = `${opts.fromCron ? "cron" : "manual"}:${currency}`;
  const existing = inflightDeals.get(contextKey);
  if (existing) {
    logger("INFO", "FETCH_COALESCE", `Refolosesc fetchDeals în curs (context=${contextKey})`);
    return existing;
  }
  const promise = withInflightTimeout(
    _fetchDealsImpl(currency),
    `fetchDeals(${contextKey})`
  );
  trackInflight(inflightDeals, contextKey, promise);
  return promise;
}

// -------------------------------------------------------------
// STEAM SEARCH
// -------------------------------------------------------------
async function searchSteamGameByName(query, currencyCode) {
  const cc = getCurrencyConfig(currencyCode).cc;
  const searchRes = await httpReq("GET",
    `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&cc=${cc}&l=english`,
    { largeJson: true });
  return searchRes.data?.items || [];
}

function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  return matrix[a.length][b.length];
}

function chooseBestSteamMatch(items, query, options = {}) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const { forceGameOnly = false } = options;
  const normalize = (str) => String(str).toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const searchTarget = query.toLowerCase().trim();
  const normTarget = normalize(query);
  const dlcKeywords = ["dlc", "soundtrack", "demo", "expansion", "deluxe upgrade", "season pass", "ost", "artbook", "collection", "remaster", "bundle", "definitive edition"];
  const wantsDLC = dlcKeywords.some(kw => searchTarget.includes(kw));
  const extraTypes = new Set(["dlc", "demo", "music"]);

  let pool = items;
  if (forceGameOnly && !wantsDLC) {
    const gamesOnly = items.filter(item => {
      const type = String(item.type || "").toLowerCase();
      const nameHasExtra = dlcKeywords.some(kw => String(item.name || "").toLowerCase().includes(kw));
      if (type && type !== "game") return false;
      if (nameHasExtra) return false;
      return true;
    });
    if (gamesOnly.length > 0) pool = gamesOnly;
  }

  if (!pool.length) return null;

  let bestMatch = pool[0];
  let bestScore = Infinity;
  for (const item of pool) {
    const itemName = String(item.name || "").toLowerCase();
    const normItemName = normalize(itemName);
    let score = levenshtein(normTarget, normItemName);

    if (normItemName === normTarget) score -= 100;
    else if (normItemName.startsWith(normTarget)) score -= 20;
    else if (normItemName.includes(normTarget)) score -= 10;

    if (!wantsDLC) {
      const isExtraByName = dlcKeywords.some(kw => itemName.includes(kw));
      const isExtraByType = typeof item.type === "string" && extraTypes.has(item.type.toLowerCase());
      if (isExtraByName || isExtraByType) score += 50;
    }
    if (score < bestScore) { bestScore = score; bestMatch = item; }
  }
  return bestMatch;
}

async function fetchSteamPriceDetails(appId, currencyCode) {
  const cc = getCurrencyConfig(currencyCode).cc;
  const detailsRes = await httpReq("GET",
    `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=${cc}&l=english`,
    { largeJson: true });
  return detailsRes.data[appId]?.data || null;
}

// V9: primește currency-ul pentru a cere pagina HTML în regiunea corectă.
// Steam returnează formatul "Offer ends ..." în limba/regiunea cerută, deci fără
// cc=RO un guild pe RON parsa rezultatul englez în locul celui așteptat.
async function extractSteamOfferEndDate(appId, currencyCode) {
  const cc = getCurrencyConfig(currencyCode).cc;
  try {
    const htmlRes = await httpReq("GET",
      `https://store.steampowered.com/app/${appId}?cc=${cc}&l=english`, {
      headers: { "Cookie": "birthtime=283993201; mature_content=1;" }
    });
    const match = htmlRes.data.match(/Offer ends\s+([^<]+)/i);
    return match && match[1] ? match[1].trim() : null;
  } catch (err) {
    logger("WARN", "PRICE_SEARCH", `Nu am putut extrage data expirării pentru app ${appId}`, err.message);
    return null;
  }
}

module.exports = {
  USER_AGENTS, MAX_HTML_BYTES, MAX_JSON_BYTES, MAX_DEALS, FETCH_CONCURRENCY,
  cleanText, truncate, normalizeTitleForDedupe, stableUpdateId, normalizeUpdate,
  safeCheerioLoad, levenshtein, httpReq, fetchWithProxy,
  dealHash,
  attachMetrics,
  fetchGameUpdate, executeFetchWithCircuitBreaker, getLatestForAllGames,
  fetchSteamReviewData, enrichDealData, fetchDeals,
  searchSteamGameByName, chooseBestSteamMatch, fetchSteamPriceDetails, extractSteamOfferEndDate,
  cleanEnrichedCache, getEnrichedCacheSize, formatPrice
};
