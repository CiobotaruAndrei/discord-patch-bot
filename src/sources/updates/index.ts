import type { Model } from "mongoose";
import type {
  AbortPredicate,
  BotMetrics,
  FetchResult,
  GameConfig,
  HttpRequestOptions,
  LoggerFunction,
  NormalizedUpdate,
  PatchUpdate
} from "../../types";
import { classifyPatchNote, scoreListingCandidate } from "../../native/fuzzy";

type HttpResponse<T = unknown> = { data: T };
type HttpReq = (
  method: string,
  url: string,
  options?: HttpRequestOptions,
  retries?: number,
  backoff?: number
) => Promise<HttpResponse<any>>;
type TrackInflight = <T>(map: Map<string, Promise<T>>, key: string, promise: Promise<T>) => void;
type WithInflightTimeout = <T>(promise: Promise<T>, label: string) => Promise<T>;
type SchemaDriftErrorInstance = Error & { source?: string };
type SchemaDriftErrorClass = new (message: string, source?: string) => SchemaDriftErrorInstance;

type RunConcurrent = <T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
  options?: {
    shouldAbort?: AbortPredicate;
    errorLogger?: (item: T, err: unknown) => void;
  }
) => Promise<unknown>;

interface RssParserLike {
  parseString(input: string): Promise<{ items?: any[] }>;
}

interface CircuitBreakerDoc {
  _id: string;
  fails: number;
  cooldownUntil?: Date | string | null;
  alertSent?: boolean;
  schemaDriftFails: number;
  schemaDriftAlertSent?: boolean;
}

interface ListingCandidate {
  href: string;
  text: string;
  position: number;
}

interface UpdatesContext {
  rssParser: RssParserLike;
  CircuitBreakerModel: Model<CircuitBreakerDoc>;
  logger: LoggerFunction;
  adminAlert: (kind: string, title: string, body: string) => Promise<void>;
  runConcurrent: RunConcurrent;
  SchemaDriftError: SchemaDriftErrorClass;
  FETCH_CONCURRENCY: number;
  CIRCUIT_BREAKER_FAIL_THRESHOLD: number;
  CIRCUIT_BREAKER_COOLDOWN_MS: number;
  CIRCUIT_BREAKER_JITTER_MS: number;
  SCHEMA_DRIFT_THRESHOLD: number;
  httpReq: HttpReq;
  fetchWithProxy: (targetUrl: string, options?: HttpRequestOptions) => Promise<string>;
  withInflightTimeout: WithInflightTimeout;
  trackInflight: TrackInflight;
  cleanText: (text: unknown) => string;
  stableUpdateId: (title: unknown, link: unknown) => string;
  normalizeUpdate: (data: PatchUpdate) => NormalizedUpdate;
  safeCheerioLoad: (html: unknown) => any;
  crypto: typeof import("crypto");
  metricsRef: Pick<BotMetrics, "fetchSuccess" | "fetchFail">;
  absoluteUrl?: typeof absoluteUrl;
  isGoodSteamArticleUrl?: typeof isGoodSteamArticleUrl;
  extractDateScore?: typeof extractDateScore;
  scoreCandidate?: typeof scoreCandidate;
  isLikelyPatchNote?: typeof isLikelyPatchNote;
  fetchSteamUpdate?: typeof fetchSteamUpdate;
  fetchListingBasedUpdate?: typeof fetchListingBasedUpdate;
  fetchFortniteUpdate?: typeof fetchFortniteUpdate;
  fetchAmdUpdate?: typeof fetchAmdUpdate;
  fetchIntelUpdate?: typeof fetchIntelUpdate;
  fetchMinecraftUpdate?: typeof fetchMinecraftUpdate;
  fetchRobloxUpdate?: typeof fetchRobloxUpdate;
  fetchNvidiaUpdate?: typeof fetchNvidiaUpdate;
  fetchGameUpdate?: typeof fetchGameUpdate;
  executeFetchWithCircuitBreaker?: typeof executeFetchWithCircuitBreaker;
  getLatestForAllGames?: typeof getLatestForAllGames;
  [key: string]: unknown;
}

let runtimeContext: UpdatesContext;
const inflightAllGames = new Map<string, Promise<FetchResult[]>>();

function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message?: unknown }).message);
  }
  return String(err);
}

function absoluteUrl(base: string | undefined, maybeRelative: string | undefined): string {
  try { return new URL(maybeRelative, base).href; } catch { return ""; }
}

function isGoodSteamArticleUrl(url: unknown): boolean {
  const v = String(url || "").trim().toLowerCase();
  return !(!v || !v.startsWith("http") || v.includes("steamstatic") || v.includes("steamcdn"));
}

function extractDateScore(url: string): number {
  const u = url.toLowerCase();
  const m1 = u.match(/(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (m1) {
    const year = parseInt(m1[1], 10);
    const month = parseInt(m1[2], 10);
    const day = parseInt(m1[3], 10);
    if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const t = Date.UTC(year, month - 1, day);
      if (!isNaN(t)) {
        // Date.UTC rolls over invalid dates (e.g. Feb 31 -> Mar 2). Reject the
        // roll-over case so URLs with malformed dates don't get a bogus score
        // that skews sort order in fetchListingBasedUpdate.
        const d = new Date(t);
        if (d.getUTCFullYear() === year
            && d.getUTCMonth() === month - 1
            && d.getUTCDate() === day) {
          return t;
        }
      }
    }
  }
  return 0;
}

// Compiled-once cache for game.articleHrefRegex. fetchListingBasedUpdate is
// called once per game per cron tick; rebuilding the same RegExp on every
// call is pure waste. WeakMap keeps the cache tied to the GameConfig object
// lifetime — when the games array is rebuilt at config reload, old regexes
// are GC'd automatically.
const articleHrefRegexCache = new WeakMap<GameConfig, RegExp>();

function getArticleHrefRegex(game: GameConfig): RegExp | null {
  if (!game.articleHrefRegex) return null;
  const cached = articleHrefRegexCache.get(game);
  if (cached) return cached;
  const compiled = new RegExp(game.articleHrefRegex, "i");
  articleHrefRegexCache.set(game, compiled);
  return compiled;
}

function scoreCandidate(candidate: ListingCandidate, keywords: string[]): number {
  // V11: delegat catre src/native/src/lib.rs::score_listing_candidate.
  return scoreListingCandidate(candidate.href, candidate.text, keywords);
}

function isLikelyPatchNote(item: any): boolean {
  // V11: delegat catre src/native/src/lib.rs::classify_patch_note. Acolo
  // listele de cuvinte cheie sunt static, iar clasificarea ruleaza intr-un
  // singur apel native in loc sa traverseze granita JS<->Rust per cuvant.
  return classifyPatchNote(item?.title, item?.contents, item?.tags);
}

async function fetchSteamUpdate(game: GameConfig): Promise<NormalizedUpdate> {
  const { httpReq, normalizeUpdate, cleanText } = runtimeContext;
  const response = await httpReq("GET",
    `https://api.steampowered.com/ISteamNews/GetNewsForApp/v0002/?appid=${game.appId}&count=50&format=json`,
    { largeJson: true });
  const patchNotes = (response?.data?.appnews?.newsitems || [])
    .filter((item: any) => (item.feed_type === 1 || item.feedname === "steam_community_announcements")
      && isGoodSteamArticleUrl(item.url) && isLikelyPatchNote(item))
    .sort((a: any, b: any) => Number(b.date || 0) - Number(a.date || 0));
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

async function fetchListingBasedUpdate(game: GameConfig): Promise<NormalizedUpdate> {
  const { httpReq, safeCheerioLoad, cleanText, normalizeUpdate, logger, SchemaDriftError } = runtimeContext;
  const listingUrls: Array<string | undefined> = Array.isArray(game.listingUrls) && game.listingUrls.length
    ? game.listingUrls : [game.listingUrl];
  const keywords = Array.isArray(game.requireKeywords) ? game.requireKeywords : [];
  const hrefRegex = getArticleHrefRegex(game);

  const collected: ListingCandidate[] = [];
  let listingFetched = 0;
  for (const url of listingUrls) {
    try {
      const listRes = await httpReq("GET", url as string);
      listingFetched++;
      const $ = safeCheerioLoad(listRes.data);
      let position = 0;
      $("a").each((i: number, el: unknown) => {
        const href = absoluteUrl(game.baseUrl, $(el).attr("href"));
        if (!href || (hrefRegex && !hrefRegex.test(href))) return;
        const candidate = { href, text: cleanText($(el).text()), position: position++ };
        if (keywords.length > 0 && scoreCandidate(candidate, keywords) === 0) return;
        collected.push(candidate);
      });
    } catch (err) {
      logger("WARN", "SCRAPE", `Eroare preluare listing url ${url}`, errorMessage(err));
    }
  }

  const seen = new Set<string>();
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

async function fetchFortniteUpdate(): Promise<NormalizedUpdate> {
  const { fetchWithProxy, rssParser, httpReq, logger, normalizeUpdate, cleanText, stableUpdateId } = runtimeContext;
  try {
    const posts = JSON.parse(await fetchWithProxy(
      "https://www.fortnite.com/api/blog/getPosts?postsPerPage=10&offset=0&locale=en-US",
      { timeout: 15000 }
    ) || "{}")?.blogList;
    const valid = (posts || []).filter((p: any) => p.slug && p.slug.toLowerCase() !== "news");
    if (!valid.length) throw new Error("Nu am găsit postări valide");
    const latest = valid.find((p: any) => /update|patch|\bv\d+/i.test(String(p.title))) || valid[0];
    return normalizeUpdate({
      id: String(latest.slug),
      title: cleanText(latest.title),
      link: `https://www.fortnite.com/news/${latest.slug}`,
      excerpt: cleanText(latest.shareDescription),
      thumbnail: "https://seeklogo.com/images/F/fortnite-logo-4C22EED4A9-seeklogo.com.png",
      timestamp: latest.date
    });
  } catch (err) {
    // V11: log explicit primary-path failure ca sa observam cand API-ul oficial
    // Fortnite isi schimba shape-ul si cadem mereu pe RSS Google News.
    logger("WARN", "SCRAPE", "Fortnite primary path a esuat, fallback la RSS Google News", errorMessage(err));
    const backupUrl = "https://news.google.com/rss/search?q=site:fortnite.com/news+update&hl=en-US";
    const feed = await rssParser.parseString((await httpReq("GET", backupUrl)).data);
    if (!feed.items || feed.items.length === 0) throw new Error("Eșec total Fortnite.");
    const first = feed.items[0];
    if (!first.title) throw new Error("Fortnite RSS fallback fara titlu in primul item.");
    return normalizeUpdate({
      id: stableUpdateId(first.title, ""),
      title: cleanText(first.title),
      link: first.link,
      excerpt: "Update oficial Fortnite.",
      thumbnail: "https://seeklogo.com/images/F/fortnite-logo-4C22EED4A9-seeklogo.com.png",
      timestamp: first.pubDate
    });
  }
}

async function fetchAmdUpdate(game: GameConfig): Promise<NormalizedUpdate> {
  const { fetchWithProxy, httpReq, rssParser, logger, normalizeUpdate, cleanText, stableUpdateId } = runtimeContext;
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
    // V11: regex-ul nu a prins versiunea — semnal de schema drift, log explicit.
    logger("WARN", "SCRAPE", "AMD proxy a returnat continut, dar regex-ul `Adrenalin Edition X.Y.Z` nu a prins versiunea — posibil schema drift, fallback RSS");
  } catch (err) {
    logger("WARN", "SCRAPE", "Eroare preluare AMD proxy", errorMessage(err));
  }
  const res = await httpReq("GET",
    "https://news.google.com/rss/search?q=site:amd.com+%22AMD+Software:+Adrenalin+Edition%22+release+notes&hl=en-US");
  const feed = await rssParser.parseString(res.data);
  if (!feed.items || feed.items.length === 0) throw new Error("Eșec AMD.");
  const rawTitle = feed.items[0].title;
  if (!rawTitle) throw new Error("AMD RSS fallback fara titlu in primul item.");
  const cleanTitle = cleanText(rawTitle).split(" - ")[0];
  if (!cleanTitle) throw new Error("AMD RSS fallback cu titlu gol dupa curatare.");
  return normalizeUpdate({
    id: stableUpdateId(cleanTitle, ""),
    title: cleanTitle,
    link: feed.items[0].link,
    excerpt: "Update AMD.com.",
    thumbnail: game.thumbnail,
    timestamp: feed.items[0].pubDate
  });
}

async function fetchIntelUpdate(game: GameConfig): Promise<NormalizedUpdate> {
  const { fetchWithProxy, httpReq, rssParser, logger, normalizeUpdate, cleanText, stableUpdateId } = runtimeContext;
  try {
    const rawContent = await fetchWithProxy(game.url as string);
    const match = rawContent.match(/\b(\d{2,3}\.\d+\.\d+\.\d+)\b/);
    if (match) return normalizeUpdate({
      id: match[1],
      title: `${game.name} v${match[1]}`,
      link: game.url,
      excerpt: `Versiune găsită: ${match[1]}`,
      thumbnail: game.thumbnail
    });
    // V11: regex-ul nu a prins versiunea — semnal de schema drift, log explicit.
    logger("WARN", "SCRAPE", `Intel proxy a returnat continut pentru ${game.key}, dar regex-ul de versiune (\d+.\d+.\d+.\d+) nu a prins nimic — posibil schema drift, fallback RSS`);
  } catch (err) {
    logger("WARN", "SCRAPE", "Eroare preluare Intel proxy", errorMessage(err));
  }
  const q = game.key === "intelpro"
    ? 'site:intel.com "Intel Arc Pro Graphics"'
    : 'site:intel.com "Intel Arc & Iris Xe Graphics - Windows"';
  const res = await httpReq("GET",
    `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US`);
  const feed = await rssParser.parseString(res.data);
  if (!feed.items || feed.items.length === 0) throw new Error("Eșec Intel.");
  const rawTitle = feed.items[0].title;
  if (!rawTitle) throw new Error("Intel RSS fallback fara titlu in primul item.");
  const cleanTitle = cleanText(rawTitle).split(" - ")[0];
  if (!cleanTitle) throw new Error("Intel RSS fallback cu titlu gol dupa curatare.");
  return normalizeUpdate({
    id: stableUpdateId(cleanTitle, ""),
    title: cleanTitle,
    link: feed.items[0].link,
    excerpt: "Update intel.com detectat.",
    thumbnail: game.thumbnail,
    timestamp: feed.items[0].pubDate
  });
}

async function fetchMinecraftUpdate(): Promise<NormalizedUpdate> {
  const { httpReq, normalizeUpdate } = runtimeContext;
  const r = await httpReq("GET", "https://pistonmeta.mojang.com/mc/game/version_manifest_v2.json",
    { largeJson: true });
  const v = r?.data?.latest?.release;
  if (!v) throw new Error("Lipsă versiune JSON");
  return normalizeUpdate({
    id: v,
    title: `Minecraft ${v}`,
    link: `https://www.minecraft.net/en-us/article/minecraft-java-edition-${String(v).replace(/\./g, "-")}`,
    excerpt: `Versiunea ${v}`,
    thumbnail: "https://static.wikia.nocookie.net/logopedia/images/6/64/Minecraft_Grass_Block.svg"
  });
}

async function fetchRobloxUpdate(): Promise<NormalizedUpdate> {
  const { httpReq, normalizeUpdate } = runtimeContext;
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

async function fetchNvidiaUpdate(g: GameConfig): Promise<NormalizedUpdate> {
  const { httpReq, rssParser, normalizeUpdate, cleanText, stableUpdateId } = runtimeContext;
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

async function fetchGameUpdate(game: GameConfig): Promise<NormalizedUpdate> {
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

async function executeFetchWithCircuitBreaker(game: GameConfig): Promise<FetchResult> {
  const {
    CircuitBreakerModel,
    CIRCUIT_BREAKER_FAIL_THRESHOLD,
    CIRCUIT_BREAKER_COOLDOWN_MS,
    CIRCUIT_BREAKER_JITTER_MS,
    SCHEMA_DRIFT_THRESHOLD,
    SchemaDriftError,
    adminAlert,
    metricsRef
  } = runtimeContext;
  const cb = await CircuitBreakerModel.findOneAndUpdate(
    { _id: game.key },
    { $setOnInsert: { fails: 0, cooldownUntil: null, alertSent: false, schemaDriftFails: 0, schemaDriftAlertSent: false } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  if (cb.cooldownUntil && new Date() < new Date(cb.cooldownUntil)) {
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
        && (!updatedCb.cooldownUntil || new Date() >= new Date(updatedCb.cooldownUntil))) {
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
          `Sursa pentru \`${game.key}\` a eșuat de ${updatedCb.fails} ori consecutiv. Cooldown ~${Math.round(CIRCUIT_BREAKER_COOLDOWN_MS/60000)}-${Math.round((CIRCUIT_BREAKER_COOLDOWN_MS+CIRCUIT_BREAKER_JITTER_MS)/60000)} min.\nUltima eroare: ${errorMessage(error)}`
        );
      }
    }
    metricsRef.fetchFail++;
    return { game, latest: null, error: errorMessage(error) };
  }
}

async function _getLatestForAllGamesImpl(games: GameConfig[], shouldAbort?: AbortPredicate): Promise<FetchResult[]> {
  const { runConcurrent, FETCH_CONCURRENCY, logger } = runtimeContext;
  const list = games.slice();
  const results = new Array<FetchResult | undefined>(list.length);

  await runConcurrent(list, FETCH_CONCURRENCY, async (game, idx) => {
    results[idx] = await executeFetchWithCircuitBreaker(game);
  }, {
    shouldAbort,
    errorLogger: (game, err) => {
      logger("WARN", "FETCH_WORKER", `Eroare la procesarea ${game.key}`, errorMessage(err));
    }
  });

  for (let i = 0; i < results.length; i++) {
    if (!results[i]) {
      results[i] = { game: list[i], latest: null, error: "abort" };
    }
  }
  return results as FetchResult[];
}

async function getLatestForAllGames(games: GameConfig[], shouldAbort?: AbortPredicate): Promise<FetchResult[]> {
  const { crypto, logger, withInflightTimeout, trackInflight } = runtimeContext;
  const ctxBase = shouldAbort ? "cron" : "manual";
  const keysHash = crypto.createHash("sha1")
    .update(games.map(g => String(g.key)).sort().join(","))
    .digest("hex")
    .substring(0, 8);
  const contextKey = `${ctxBase}:${keysHash}`;
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

function attachUpdates(ctx: UpdatesContext): void {
  runtimeContext = ctx;

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
}

export = attachUpdates;
