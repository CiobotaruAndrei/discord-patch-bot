"use strict";
// =============================================================
// scrapers.js — colectare date externe, circuit breaker, deals.
//
// V4:
//   * Constantele citite din env (db.js)
//   * In-flight coalescing SEPARAT pentru cron vs comenzi manuale
//     ca să nu propagăm shouldAbort între contexte diferite
//   * Limite HTTP diferențiate: MAX_HTML_BYTES pentru scraping HTML,
//     MAX_JSON_BYTES (mai generos) pentru API-uri JSON Steam/Epic
// =============================================================
const axios = require("axios");
const cheerio = require("cheerio");
const Parser = require("rss-parser");
const crypto = require("crypto");
const { CircuitBreakerModel, logger, adminAlert, env } = require("./db");
const rssParser = new Parser();
// -------------------------------------------------------------
// Constante derivate din env (sursă unică: db.js)
// -------------------------------------------------------------
const FETCH_CONCURRENCY = env.FETCH_CONCURRENCY;
const MAX_HTML_BYTES = env.MAX_HTML_BYTES;
const MAX_JSON_BYTES = env.MAX_JSON_BYTES;
const MAX_DEALS = env.MAX_DEALS;
const STEAM_SPECIALS_LIMIT = env.STEAM_SPECIALS_LIMIT;
const EPIC_SPECIALS_LIMIT = env.EPIC_SPECIALS_LIMIT;
const STEAM_REVIEW_BATCH_SIZE = env.STEAM_REVIEW_BATCH_SIZE;
const STEAM_REVIEW_BATCH_DELAY_MS = env.STEAM_REVIEW_BATCH_DELAY_MS;
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)
Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)
Version/16.6 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0
Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0"
];
// -------------------------------------------------------------
// METRICI
// -------------------------------------------------------------
let metricsRef = { fetchSuccess: 0, fetchFail: 0, httpRetries: 0, rateLimitHits: 0 };
function attachMetrics(m) { metricsRef = m; }
// -------------------------------------------------------------
// UTILE
// -------------------------------------------------------------
function cleanText(text) {
  return String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
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
  if (str.length <= MAX_HTML_BYTES / 4) return cheerio.load(str);
  const byteLen = Buffer.byteLength(str, "utf8");
  if (byteLen <= MAX_HTML_BYTES) return cheerio.load(str);
  const buf = Buffer.from(str, "utf8").subarray(0, MAX_HTML_BYTES);
  return cheerio.load(buf.toString("utf8"));
}
function dealHash(deal) {
  let stableKey;
  if (deal.store === "Steam" && deal.steamAppID) stableKey = `steam:${deal.steamAppID}`;
  else if (deal.store === "Epic Games" && deal.id) stableKey = deal.id;
  else stableKey = `${deal.store}:${normalizeTitleForDedupe(deal.title)}`;
  return crypto.createHash("sha1").update(stableKey).digest("hex");
}
// -------------------------------------------------------------
// HTTP — limite default HTML, override JSON
// Apelantul poate suprascrie maxContentLength/maxBodyLength explicit.
// Pentru API-uri JSON pasăm `largeJson: true` ca shortcut → MAX_JSON_BYTES.
// -------------------------------------------------------------
async function httpReq(method, url, options = {}, retries = 2, backoff = 1000) {
  // Determinăm limita: explicit > shortcut largeJson > default HTML
  let contentLimit = options.maxContentLength;
  let bodyLimit = options.maxBodyLength;
  if (contentLimit === undefined) {
    contentLimit = options.largeJson ? MAX_JSON_BYTES : MAX_HTML_BYTES;
  }
  if (bodyLimit === undefined) {
    bodyLimit = options.largeJson ? MAX_JSON_BYTES : MAX_HTML_BYTES;
  }
  const reqConfig = {
    method,
    url,
    timeout: options.timeout || 15000,
    maxContentLength: contentLimit,
    maxBodyLength: bodyLimit,
    headers: {
      "User-Agent": USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
      ...options.headers
    }
  };
  if (options.data) reqConfig.data = options.data;
  for (let i = 0; i <= retries; i++) {
    try {
      return await axios(reqConfig);
    } catch (err) {
      const status = err.response?.status || "N/A";
      if (typeof status === "number" && status >= 400 && status < 500 && status !== 429) throw
err;
      if (i === retries) {
        logger("ERROR", "HTTP", `Eșec final request [${status}] după ${retries} încercări:
${url}`, err.message);
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
      waitMs = Math.round(waitMs * (0.8 + Math.random() * 0.4));
      metricsRef.httpRetries++;
      logger("WARN", "HTTP", `Eșec request [${status}] (încercarea ${i + 1}/${retries}),
reîncerc în ${waitMs}ms: ${url}`, err.message);
      await new Promise(res => setTimeout(res, waitMs));
      backoff *= 2;
    }
  }
}
async function fetchWithProxy(targetUrl, options = {}) {
  const proxies = [
    `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`
  ];
  let lastErr;
  for (const proxy of proxies) {
    try {
      const res = await httpReq("GET", proxy, options);
      return proxy.includes("allorigins")
        ? String(res?.data?.contents || "")
        : (typeof res.data === "string" ? res.data : JSON.stringify(res.data));
    } catch (err) { lastErr = err; }
  }
  throw new Error(`Proxy fallback epuizat: ${lastErr?.message}`);
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
  const m1 = u.match(/\b(\d{4})[-/]?(\d{2})[-/]?(\d{2})\b/);
  if (m1) {
    const d = new Date(`${m1[1]}-${m1[2]}-${m1[3]}`);
    if (!isNaN(d.getTime())) return d.getTime();
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
  const badInTitle = ["community", "sale", "store", "merch", "tournament", "esports",
"giveaway", "teaser", "trailer", "preview", "announce", "announcement"];
  if (badInTitle.some(w => title.includes(w))) return false;
  if (tags.includes("patchnotes") || tags.includes("update")) return true;
  const goodWords = ["update", "patch", "hotfix", "version", "release", "bugfix", "bug fix",
"fixes", "fix", "notes", "patch notes", "changelog", "maintenance", "build", "client update",
"title update", "release notes", "season", "chapter", "rework", "balance", "content update",
"launch"];
  return goodWords.some(w => text.includes(w));
}
// -------------------------------------------------------------
// FETCH PER TIP — toate API-urile JSON folosesc largeJson: true
// -------------------------------------------------------------
async function fetchSteamUpdate(game) {
  // Steam News API returnează 50 articole — poate depăși 500KB ușor
  const response = await httpReq("GET",
    `https://api.steampowered.com/ISteamNews/GetNewsForApp/v0002/?
appid=${game.appId}&count=50&format=json`,
    { largeJson: true });
  const patchNotes = (response?.data?.appnews?.newsitems || [])
    .filter(item => (item.feed_type === 1 || item.feedname === "steam_community_announcements")
      && isGoodSteamArticleUrl(item.url) && isLikelyPatchNote(item))
    .sort((a, b) => Number(b.date || 0) - Number(a.date || 0));
  if (!patchNotes.length) throw new Error("Lipsă patch notes Steam valabile.");
  const latest = patchNotes[0];
  const rawContents = String(latest.contents || "").replace(/https?:\/\/[^\s]+/gi,
"").replace(/\[.*?\]/g, " ");
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
  for (const url of listingUrls) {
    try {
      const listRes = await httpReq("GET", url);
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
  if (!unique.length) throw new Error("Nu am găsit ancore valide.");
  const articleUrl = unique[0].href;
  const articleRes = await httpReq("GET", articleUrl, { timeout: 8000 });
  const $art = safeCheerioLoad(articleRes.data || "");
  const ogTitle = $art('meta[property="og:title"]').attr("content") || $art("title").text() ||
"";
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
    const backupUrl = "https://news.google.com/rss/search?q=site:fortnite.com/news+update&hl=en-
US";
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
    const rawContent = await
fetchWithProxy("https://www.amd.com/en/support/download/drivers.html");
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
    "https://news.google.com/rss/search?
q=site:amd.com+%22AMD+Software:+Adrenalin+Edition%22+release+notes&hl=en-US");
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
  const r = await httpReq("GET",
"https://pistonmeta.mojang.com/mc/game/version_manifest_v2.json",
    { largeJson: true });
  const v = r?.data?.latest?.release;
  if (!v) throw new Error("Lipsă versiune JSON");
  return normalizeUpdate({
    id: v,
    title: `Minecraft ${v}`,
    link: `https://www.minecraft.net/en-us/article/minecraft-java-edition-${v.replace(/\./g, "-
")}`,
    excerpt: `Versiunea ${v}`,
    thumbnail:
"https://static.wikia.nocookie.net/logopedia/images/6/64/Minecraft_Grass_Block.svg"
  });
}
async function fetchRobloxUpdate() {
  const r = await httpReq("GET",
"https://clientsettings.roblox.com/v2/clientversion/WindowsPlayer");
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
    `https://news.google.com/rss/search?q=${encodeURIComponent(`site:nvidia.com ${q}
release`)}&hl=en-US`);
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
// CIRCUIT BREAKER
// -------------------------------------------------------------
const FAIL_THRESHOLD = 5;
async function executeFetchWithCircuitBreaker(game) {
  const cb = await CircuitBreakerModel.findOneAndUpdate(
    { _id: game.key },
    { $setOnInsert: { fails: 0, cooldownUntil: null, alertSent: false } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  if (cb.cooldownUntil && new Date() < cb.cooldownUntil) {
    return { game, latest: null, error: "Circuit Breaker Activ" };
  }
  try {
    const latest = await fetchGameUpdate(game);
    if (cb.fails > 0 || cb.cooldownUntil || cb.alertSent) {
      await CircuitBreakerModel.updateOne(
        { _id: game.key },
        { $set: { fails: 0, cooldownUntil: null, alertSent: false } }
      );
    }
    metricsRef.fetchSuccess++;
    return { game, latest, error: null };
  } catch (error) {
    const updatedCb = await CircuitBreakerModel.findOneAndUpdate(
      { _id: game.key },
      { $inc: { fails: 1 } },
      { new: true, upsert: true }
    );
    if (updatedCb.fails >= FAIL_THRESHOLD
        && (!updatedCb.cooldownUntil || new Date() >= updatedCb.cooldownUntil)) {
      const baseCooldown = 45 * 60 * 1000;
      const jitter = Math.floor(Math.random() * 5 * 60 * 1000);
      await CircuitBreakerModel.updateOne(
        { _id: game.key },
        { $set: { cooldownUntil: new Date(Date.now() + baseCooldown + jitter) } }
      );
      if (!updatedCb.alertSent) {
        await CircuitBreakerModel.updateOne({ _id: game.key }, { $set: { alertSent: true } });
        await adminAlert(
          `cb:${game.key}`,
          `Circuit breaker activat: ${game.name}`,
          `Sursa pentru \`${game.key}\` a eșuat de ${updatedCb.fails} ori consecutiv. Cooldown
~45 min.\nUltima eroare: ${error.message}`
        );
      }
    }
    metricsRef.fetchFail++;
    return { game, latest: null, error: error.message };
  }
}
// -------------------------------------------------------------
// POOL CONCURRENT + IN-FLIGHT COALESCING SEPARAT
//
// Coalescing-ul reduce duplicate fetch-uri când două apeluri se suprapun.
// PROBLEMA: dacă cronul pornește fetch-ul cu shouldAbort, apoi pierde
// lock-ul → rezultatele sunt parțiale (cu placeholder error: "abort").
// Dacă o comandă manuală cere TOT ATUNCI fetch-ul, primește același
// promise abortat și vede rezultate incomplete fără motiv.
//
// SOLUȚIA: două chei separate pentru in-flight:
//   * `cron` — folosit doar de cron (poate fi abortat)
//   * `manual` — folosit de comenzi manuale (NU se abortează niciodată)
// Cele două NU se coalescuesc între ele. Dacă cronul rulează, o comandă
// manuală pornește propriul fetch — costă mai mult ca răspuns, dar nu
// mai dă rezultate incomplete utilizatorului.
// -------------------------------------------------------------
const inflightAllGames = new Map(); // key: "cron" | "manual" -> Promise
async function _getLatestForAllGamesImpl(games, shouldAbort) {
  const list = games.slice();
  const results = new Array(list.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      if (shouldAbort && shouldAbort()) return;
      const myIndex = nextIndex++;
      if (myIndex >= list.length) return;
      results[myIndex] = await executeFetchWithCircuitBreaker(list[myIndex]);
    }
  }
  const workerCount = Math.min(FETCH_CONCURRENCY, list.length);
  const workers = [];
  for (let i = 0; i < workerCount; i++) workers.push(worker());
  await Promise.all(workers);
  for (let i = 0; i < results.length; i++) {
    if (!results[i]) {
      results[i] = { game: list[i], latest: null, error: "abort" };
    }
  }
  return results;
}
/**
 * @param {Array} games
 * @param {Function|null} shouldAbort - dacă e prezent, contextul e "cron"
 *   (poate fi abortat); altfel "manual" (nu se abortează).
 */
async function getLatestForAllGames(games, shouldAbort) {
  const contextKey = shouldAbort ? "cron" : "manual";
  const existing = inflightAllGames.get(contextKey);
  if (existing) {
    logger("INFO", "FETCH_COALESCE", `Refolosesc fetch-ul în curs (context=${contextKey})`);
    return existing;
  }
  const promise = (async () => {
    try { return await _getLatestForAllGamesImpl(games, shouldAbort); }
    finally { inflightAllGames.delete(contextKey); }
  })();
  inflightAllGames.set(contextKey, promise);
  return promise;
}
// -------------------------------------------------------------
// STEAM REVIEW
// -------------------------------------------------------------
async function fetchSteamReviewData(appId, attempt = 0) {
  try {
    const res = await httpReq("GET",
      `https://store.steampowered.com/appreviews/${appId}?json=1&language=all&num_per_page=0`,
      { largeJson: true }, 1, 800);
    const summary = res.data?.query_summary;
    if (summary) {
      const totalReviews = summary.total_reviews || 0;
      const positiveReviews = summary.total_positive || 0;
      const qualityPercent = totalReviews > 0 ? Math.round((positiveReviews / totalReviews) *
100) : 0;
      return { totalReviews, qualityPercent, success: true };
    }
    return { totalReviews: 0, qualityPercent: 0, success: false };
  } catch (err) {
    const status = err.response?.status;
    if (status === 429 && attempt < 2) {
      await new Promise(r => setTimeout(r, 1500 + Math.random() * 1500));
      return fetchSteamReviewData(appId, attempt + 1);
    }
    logger("WARN", "STEAM_REVIEW", `Eroare preluare review Steam appID ${appId}`, err.message);
    return { totalReviews: 0, qualityPercent: 0, success: false };
  }
}
const activeEnrichments = new Map();
async function enrichDealData(deal) {
  if (deal.enriched) return deal;
  if (activeEnrichments.has(deal.id)) return activeEnrichments.get(deal.id);
  const enrichTask = (async () => {
    if (deal.store === "Steam" && deal.steamAppID) {
      try {
        // appdetails poate ajunge la >1MB pentru jocuri mari (Cyberpunk etc)
        const res = await httpReq("GET",
          `https://store.steampowered.com/api/appdetails?
appids=${deal.steamAppID}&cc=US&l=english`,
          { timeout: 5000, largeJson: true });
        const data = res.data[deal.steamAppID]?.data;
        if (data && data.platforms) {
          deal.extraDetails = (deal.extraDetails || "")
            + `\n**Platforme:** ${[data.platforms.windows ? "Win" : "", data.platforms.mac ?
"Mac" : "", data.platforms.linux ? "Lin" : ""].filter(Boolean).join(", ")}`;
        }
        // Pagina store e HTML — limita default HTML e ok
        const htmlRes = await httpReq("GET", deal.link, {
          headers: { "Cookie": "birthtime=283993201; mature_content=1;" }
        });
        const match = htmlRes.data.match(/Offer ends\s+([^<]+)/i);
        if (match && match[1]) deal.endDateStr = match[1].trim();
      } catch (e) {
        logger("WARN", "STEAM_ENRICH", `Eroare enrich oferta Steam appID ${deal.steamAppID}`,
e.message);
      }
    }
    deal.enriched = true;
    return deal;
  })();
  activeEnrichments.set(deal.id, enrichTask);
  const cleanupTimer = setTimeout(() => activeEnrichments.delete(deal.id), 60000);
  try { await enrichTask; }
  finally {
    clearTimeout(cleanupTimer);
    activeEnrichments.delete(deal.id);
  }
  return deal;
}
// -------------------------------------------------------------
// FETCH DEALS + coalescing separat (la fel ca getLatestForAllGames)
// -------------------------------------------------------------
const inflightDeals = new Map(); // key: "cron" | "manual" -> Promise
async function _fetchDealsImpl() {
  const deals = [];
  try {
    // featuredcategories returnează multe items cu thumbnails — poate fi >1MB
    const steamRes = await httpReq("GET",
      "https://store.steampowered.com/api/featuredcategories/?cc=US&l=english",
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
      const wBonus = revData.success ? Math.min(25, Math.floor(revData.totalReviews / 1000)) :
0;
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
        thumbnail: item.header_image || null
      });
    }
  } catch (err) {
    logger("WARN", "DEALS_FETCH", "Eroare Steam API", err.message);
  }
  try {
    const epicQuery = `query searchStoreQuery($category: String, $count: Int, $country: String!,
$locale: String, $onSale: Boolean, $withPrice: Boolean = false) { Catalog {
searchStore(category: $category, count: $count, country: $country, locale: $locale, onSale:
$onSale) { elements { title id urlSlug keyImages { type url } price(country: $country)
@include(if: $withPrice) { totalPrice { discountPrice originalPrice } } promotions {
promotionalOffers { promotionalOffers { endDate discountSetting { discountPercentage } } } } } }
} }`;
    const epicVars = {
      category: "games/edition/base|bundles/games",
      count: EPIC_SPECIALS_LIMIT,
      country: "US", locale: "en-US", onSale: true, withPrice: true
    };
    // Epic GraphQL — răspunsul poate fi mare
    const epicRes = await httpReq("POST", "https://graphql.epicgames.com/graphql", {
      data: { query: epicQuery, variables: epicVars },
      largeJson: true,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like
Gecko) Chrome/120.0.0.0 Safari/537.36",
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
        savings = Math.round(((priceInfo.originalPrice - priceInfo.discountPrice) /
priceInfo.originalPrice) * 100);
      }
      const hybridScore = savings * 0.8 + 80.0 + 15.0;
      let thumb = null;
      if (Array.isArray(item.keyImages)) {
        const img = item.keyImages.find(i => i.type === "OfferImageWide" || i.type ===
"Thumbnail");
        if (img) thumb = img.url;
      }
      let endDate = "Nespecificat";
      const promos = item.promotions?.promotionalOffers?.[0]?.promotionalOffers?.[0];
      if (promos && promos.endDate) endDate = new Date(promos.endDate).toLocaleDateString("ro-
RO");
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
        thumbnail: thumb
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
/**
 * @param {Object} [opts]
 * @param {boolean} [opts.fromCron] - dacă e cron context, false default (manual)
 */
async function fetchDeals(opts = {}) {
  const contextKey = opts.fromCron ? "cron" : "manual";
  const existing = inflightDeals.get(contextKey);
  if (existing) {
    logger("INFO", "FETCH_COALESCE", `Refolosesc fetchDeals în curs (context=${contextKey})`);
    return existing;
  }
  const promise = (async () => {
    try { return await _fetchDealsImpl(); }
    finally { inflightDeals.delete(contextKey); }
  })();
  inflightDeals.set(contextKey, promise);
  return promise;
}
// -------------------------------------------------------------
// STEAM SEARCH
// -------------------------------------------------------------
async function searchSteamGameByName(query) {
  const searchRes = await httpReq("GET",
    `https://store.steampowered.com/api/storesearch/?
term=${encodeURIComponent(query)}&cc=US&l=english`,
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
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] +
cost);
    }
  }
  return matrix[a.length][b.length];
}
function chooseBestSteamMatch(items, query, options = {}) {
  const { forceGameOnly = false } = options;
  const normalize = (str) => String(str).toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const searchTarget = query.toLowerCase().trim();
  const normTarget = normalize(query);
  const dlcKeywords = ["dlc", "soundtrack", "demo", "expansion", "deluxe upgrade", "season
pass", "ost", "artbook", "collection", "remaster", "bundle", "definitive edition"];
  const wantsDLC = dlcKeywords.some(kw => searchTarget.includes(kw));
  const extraTypes = new Set(["dlc", "demo", "music"]);
  let pool = items;
  if (forceGameOnly && !wantsDLC) {
    const gamesOnly = items.filter(item => {
      const type = String(item.type || "").toLowerCase();
      const nameHasExtra = dlcKeywords.some(kw => String(item.name ||
"").toLowerCase().includes(kw));
      if (type && type !== "game") return false;
      if (nameHasExtra) return false;
      return true;
    });
    if (gamesOnly.length > 0) pool = gamesOnly;
  }
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
      const isExtraByType = typeof item.type === "string" &&
extraTypes.has(item.type.toLowerCase());
      if (isExtraByName || isExtraByType) score += 50;
    }
    if (score < bestScore) { bestScore = score; bestMatch = item; }
  }
  return bestMatch;
}
async function fetchSteamPriceDetails(appId) {
  // appdetails poate ajunge >1MB pentru jocuri mari
  const detailsRes = await httpReq("GET",
    `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=US&l=english`,
    { largeJson: true });
  return detailsRes.data[appId]?.data || null;
}
async function extractSteamOfferEndDate(appId) {
  try {
    // HTML — limita default ok
    const htmlRes = await httpReq("GET", `https://store.steampowered.com/app/${appId}`, {
      headers: { "Cookie": "birthtime=283993201; mature_content=1;" }
    });
    const match = htmlRes.data.match(/Offer ends\s+([^<]+)/i);
    return match && match[1] ? match[1].trim() : null;
  } catch (err) {
    logger("WARN", "PRICE_SEARCH", `Nu am putut extrage data expirării pentru app ${appId}`,
err.message);
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
  searchSteamGameByName, chooseBestSteamMatch, fetchSteamPriceDetails, extractSteamOfferEndDate
};
