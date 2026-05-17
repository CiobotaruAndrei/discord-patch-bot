"use strict";

module.exports = (ctx) => {
  const {
    rssParser, CircuitBreakerModel, logger, adminAlert, runConcurrent,
    SchemaDriftError, FETCH_CONCURRENCY, CIRCUIT_BREAKER_FAIL_THRESHOLD,
    CIRCUIT_BREAKER_COOLDOWN_MS, CIRCUIT_BREAKER_JITTER_MS, SCHEMA_DRIFT_THRESHOLD,
    httpReq, fetchWithProxy, withInflightTimeout, trackInflight,
    cleanText, stableUpdateId, normalizeUpdate, safeCheerioLoad
  } = ctx;

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
    ctx.metricsRef.fetchSuccess++;
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
      ctx.metricsRef.fetchFail++;
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
    ctx.metricsRef.fetchFail++;
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

  Object.assign(ctx, {
    absoluteUrl,
    isGoodSteamArticleUrl,
    extractDateScore,
    scoreCandidate,
    isLikelyPatchNote,
    fetchSteamUpdate,
    fetchListingBasedUpdate,
    fetchFortniteUpdate,
    fetchAmdUpdate,
    fetchIntelUpdate,
    fetchMinecraftUpdate,
    fetchRobloxUpdate,
    fetchNvidiaUpdate,
    fetchGameUpdate,
    executeFetchWithCircuitBreaker,
    getLatestForAllGames
  });
};
