import type { Model } from "mongoose";
import type { CheerioAPI } from "cheerio";
import type {
  AbortPredicate,
  BotMetrics,
  FetchResult,
  GameConfig,
  GameSourceFallback,
  HttpRequestOptions,
  LoggerFunction,
  NormalizedUpdate,
  PatchUpdate
} from "../../types";
import {
  classifyPatchNote,
  extractDateScore as rustExtractDateScore,
  isGoodSteamArticleUrl as rustIsGoodSteamArticleUrl,
  rankListingCandidates,
  scoreListingCandidate
} from "../../native/fuzzy";
import { errorMessage } from "../../shared/errors";

type HttpResponse<T = unknown> = { data: T };
type CheerioSelector = Parameters<CheerioAPI>[0];
type HttpReq = (
  method: string,
  url: string,
  options?: HttpRequestOptions,
  retries?: number,
  backoff?: number
) => Promise<HttpResponse<unknown>>;
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
  parseString(input: string): Promise<{ items?: RssItem[] }>;
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

interface RssItem {
  title?: string;
  link?: string;
  pubDate?: string;
  guid?: string;
  contentSnippet?: string;
  contents?: unknown;
  tags?: unknown;
}

interface SteamNewsItem {
  gid?: unknown;
  title?: string;
  url?: string;
  contents?: string;
  tags?: unknown;
  feed_type?: number;
  feedname?: string;
  date?: unknown;
}

interface SteamNewsResponse {
  appnews?: {
    newsitems?: SteamNewsItem[];
  };
}

interface FortnitePost {
  slug?: string;
  title?: string;
  shareDescription?: string;
  date?: string;
}

interface FortniteBlogResponse {
  blogList?: FortnitePost[];
}

interface MinecraftVersionManifest {
  latest?: {
    release?: string;
  };
}

interface RobloxVersionResponse {
  clientVersionUpload?: string;
}

interface UpdatesDeps {
  rssParser: RssParserLike;
  CircuitBreakerModel: Model<CircuitBreakerDoc>;
  logger: LoggerFunction;
  adminAlert: (kind: string, title: string, body: string) => Promise<void>;
  runConcurrent: RunConcurrent;
  SchemaDriftError: SchemaDriftErrorClass;
  FETCH_CONCURRENCY: number;
  FETCH_CONCURRENCY_STEAM: number;
  FETCH_CONCURRENCY_EPIC: number;
  FETCH_CONCURRENCY_LISTING: number;
  FETCH_CONCURRENCY_DRIVER: number;
  CIRCUIT_BREAKER_FAIL_THRESHOLD: number;
  CIRCUIT_BREAKER_COOLDOWN_MS: number;
  CIRCUIT_BREAKER_JITTER_MS: number;
  SCHEMA_DRIFT_THRESHOLD: number;
  httpReq: HttpReq;
  conditionalGet: <T>(url: string, parse: (data: unknown) => T | Promise<T>, options?: HttpRequestOptions) => Promise<T>;
  fetchWithProxy: (targetUrl: string, options?: HttpRequestOptions) => Promise<string>;
  withInflightTimeout: WithInflightTimeout;
  trackInflight: TrackInflight;
  cleanText: (text: unknown) => string;
  stableUpdateId: (title: unknown, link: unknown) => string;
  normalizeUpdate: (data: PatchUpdate) => NormalizedUpdate;
  safeCheerioLoad: (html: unknown) => CheerioAPI;
  crypto: typeof import("crypto");
  metricsRef: Pick<BotMetrics, "fetchSuccess" | "fetchFail">;
  executeFetchWithCircuitBreaker?: (game: GameConfig) => Promise<FetchResult>;
}

interface UpdatesApi {
  absoluteUrl: typeof absoluteUrl;
  isGoodSteamArticleUrl: typeof isGoodSteamArticleUrl;
  extractDateScore: typeof extractDateScore;
  scoreCandidate: typeof scoreCandidate;
  isLikelyPatchNote: typeof isLikelyPatchNote;
  fetchSteamUpdate: typeof fetchSteamUpdate;
  fetchListingBasedUpdate: typeof fetchListingBasedUpdate;
  fetchFortniteUpdate: typeof fetchFortniteUpdate;
  fetchAmdUpdate: typeof fetchAmdUpdate;
  fetchIntelUpdate: typeof fetchIntelUpdate;
  fetchMinecraftUpdate: typeof fetchMinecraftUpdate;
  fetchRobloxUpdate: typeof fetchRobloxUpdate;
  fetchNvidiaUpdate: typeof fetchNvidiaUpdate;
  fetchGameUpdate: typeof fetchGameUpdate;
  applyFallbackSource: typeof applyFallbackSource;
  executeFetchWithCircuitBreaker: typeof executeFetchWithCircuitBreaker;
  sourceConcurrencyGroup: typeof sourceConcurrencyGroup;
  getLatestForAllGames: typeof getLatestForAllGames;
}

type UpdatesContext = UpdatesDeps & Record<string, unknown>;

let deps: UpdatesDeps;
const inflightAllGames = new Map<string, Promise<FetchResult[]>>();

function absoluteUrl(base: string | undefined, maybeRelative: string | undefined): string {
  try { return new URL(maybeRelative || "", base).href; } catch { return ""; }
}

function isGoodSteamArticleUrl(url: unknown): boolean {
  return rustIsGoodSteamArticleUrl(url);
}

function extractDateScore(url: string): number {
  return rustExtractDateScore(url);
}

const articleHrefRegexCache = new WeakMap<GameConfig, RegExp>();

function getArticleHrefRegex(game: GameConfig): RegExp | null {
  const pattern = game.articleHrefRegex;
  if (!pattern) return null;
  const cached = articleHrefRegexCache.get(game);
  if (cached) return cached;
  const compiled = new RegExp(pattern, "i");
  articleHrefRegexCache.set(game, compiled);
  return compiled;
}

function scoreCandidate(candidate: ListingCandidate, keywords: string[]): number {
  return scoreListingCandidate(candidate.href, candidate.text, keywords);
}

function isLikelyPatchNote(item: SteamNewsItem | RssItem | Record<string, unknown>): boolean {
  return classifyPatchNote(item?.title, item?.contents, item?.tags);
}

function sourceConcurrencyGroup(game: GameConfig): string {
  const type = game.type;
  if (!type || type === "steam") return "steam";
  if (type === "epic_games") return "epic";
  if (type === "listing_based") return "listing";
  if (type === "rss") return "rss";
  if (type === "nvidia" || type === "amd" || type === "intel") return "driver";
  return "other";
}

function concurrencyForGroup(group: string): number {
  const {
    FETCH_CONCURRENCY, FETCH_CONCURRENCY_STEAM, FETCH_CONCURRENCY_EPIC,
    FETCH_CONCURRENCY_LISTING, FETCH_CONCURRENCY_DRIVER
  } = deps;
  if (group === "steam") return FETCH_CONCURRENCY_STEAM;
  if (group === "epic") return FETCH_CONCURRENCY_EPIC;
  if (group === "listing") return FETCH_CONCURRENCY_LISTING;
  if (group === "driver") return FETCH_CONCURRENCY_DRIVER;
  return FETCH_CONCURRENCY;
}

async function fetchSteamUpdate(game: GameConfig): Promise<NormalizedUpdate> {
  const { conditionalGet, normalizeUpdate, cleanText } = deps;
  const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v0002/?appid=${game.appId}&count=50&format=json`;
  return conditionalGet(url, (raw) => {
    const data = raw as SteamNewsResponse;
    const patchNotes = (data.appnews?.newsitems || [])
      .filter((item) => (item.feed_type === 1 || item.feedname === "steam_community_announcements")
        && isGoodSteamArticleUrl(item.url) && isLikelyPatchNote(item))
      .sort((a, b) => Number(b.date || 0) - Number(a.date || 0));
    if (!patchNotes.length) throw new Error("Lipsă patch notes Steam valabile.");
    const latest = patchNotes[0];
    if (latest.gid === undefined || latest.gid === null || latest.gid === "") {
      throw new Error("Steam newsitem fără gid — posibil schema drift în feed-ul ISteamNews.");
    }
    const rawContents = String(latest.contents || "").replace(/https?:\/\/[^\s]+/gi, "").replace(/\[.*?\]/g, " ");
    const timestamp = computeSteamTimestamp(latest.date);
    return normalizeUpdate({
      id: String(latest.gid),
      title: cleanText(latest.title),
      link: String(latest.url),
      excerpt: rawContents,
      fullText: rawContents,
      timestamp
    });
  }, { largeJson: true });
}

function computeSteamTimestamp(rawDate: unknown): string {
  const epochSec = Number(rawDate);
  if (!Number.isFinite(epochSec) || epochSec <= 0) return "";
  const d = new Date(epochSec * 1000);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

async function fetchListingBasedUpdate(game: GameConfig): Promise<NormalizedUpdate> {
  const { httpReq, safeCheerioLoad, cleanText, normalizeUpdate, logger, SchemaDriftError } = deps;
  const rawListingUrls: Array<string | undefined> = Array.isArray(game.listingUrls) && game.listingUrls.length
    ? game.listingUrls : [game.listingUrl];
  const listingUrls: string[] = rawListingUrls.filter(
    (u): u is string => typeof u === "string" && u.trim().length > 0
  );
  if (listingUrls.length === 0) {
    throw new Error(`Nu am URL-uri de listing valide pentru ${game.key} (verifica config.json).`);
  }
  const keywords = Array.isArray(game.requireKeywords) ? game.requireKeywords : [];
  const hrefRegex = getArticleHrefRegex(game);

  type FetchedListing = { url: string; candidates: ListingCandidate[] };
  const settled = await Promise.allSettled(listingUrls.map(async (url): Promise<FetchedListing> => {
    const listRes = await httpReq("GET", url);
    const $ = safeCheerioLoad(listRes.data);
    const candidates: ListingCandidate[] = [];
    let localPosition = 0;
    $("a").each((i: number, el: unknown) => {
      const node = el as CheerioSelector;
      const href = absoluteUrl(game.baseUrl, $(node).attr("href"));
      if (!href || (hrefRegex && !hrefRegex.test(href))) return;
      const candidate = { href, text: cleanText($(node).text()), position: localPosition++ };
      if (keywords.length > 0 && scoreCandidate(candidate, keywords) === 0) return;
      candidates.push(candidate);
    });
    return { url: String(url), candidates };
  }));

  const collected: ListingCandidate[] = [];
  let listingFetched = 0;
  let globalPosition = 0;
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === "rejected") {
      logger("WARN", "SCRAPE", `Eroare preluare listing url ${listingUrls[i]}`, errorMessage(r.reason));
      continue;
    }
    listingFetched++;
    for (const c of r.value.candidates) {
      collected.push({ href: c.href, text: c.text, position: globalPosition++ });
    }
  }

  const seen = new Set<string>();
  const unique = collected.filter(item => {
    if (!item.href || seen.has(item.href)) return false;
    seen.add(item.href);
    return true;
  });
  const ranked = rankListingCandidates(unique, keywords);

  if (!ranked.length) {
    if (listingFetched > 0) {
      throw new SchemaDriftError(
        `Listing fetch-uit cu succes dar 0 ancore valide pentru ${game.key}`,
        `listing:${game.key}`
      );
    }
    throw new Error("Nu am găsit ancore valide.");
  }
  const TRY_LIMIT = Math.min(3, ranked.length);
  let lastErr: unknown = null;
  for (let i = 0; i < TRY_LIMIT; i++) {
    const candidate = ranked[i];
    const articleUrl = candidate.href;
    try {
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
    } catch (err) {
      lastErr = err;
      logger("WARN", "FETCH_UPDATES", `Articol indisponibil pentru ${game.key} (candidat ${i + 1}/${TRY_LIMIT}): ${articleUrl}`, errorMessage(err));
    }
  }

  throw new Error(
    `Niciun articol nu a raspuns din primii ${TRY_LIMIT} candidati pentru ${game.key}: ${errorMessage(lastErr)}`
  );
}

async function fetchFortniteUpdate(): Promise<NormalizedUpdate> {
  const { fetchWithProxy, rssParser, httpReq, logger, normalizeUpdate, cleanText, stableUpdateId } = deps;
  try {
    const fortniteResponse = JSON.parse(await fetchWithProxy(
      "https://www.fortnite.com/api/blog/getPosts?postsPerPage=10&offset=0&locale=en-US",
      { timeout: 15000 }
    ) || "{}") as FortniteBlogResponse;
    const posts = fortniteResponse.blogList || [];
    const valid = posts.filter((p): p is FortnitePost & { slug: string } =>
      typeof p.slug === "string" && p.slug.toLowerCase() !== "news"
    );
    if (!valid.length) throw new Error("Nu am găsit postări valide");
    const latest = valid.find((p) => /update|patch|\bv\d+/i.test(String(p.title))) || valid[0];
    return normalizeUpdate({
      id: String(latest.slug),
      title: cleanText(latest.title),
      link: `https://www.fortnite.com/news/${latest.slug}`,
      excerpt: cleanText(latest.shareDescription),
      thumbnail: "https://seeklogo.com/images/F/fortnite-logo-4C22EED4A9-seeklogo.com.png",
      timestamp: latest.date
    });
  } catch (err) {
    logger("WARN", "SCRAPE", "Fortnite primary path a esuat, fallback la RSS Google News", errorMessage(err));
    const backupUrl = "https://news.google.com/rss/search?q=site:fortnite.com/news+update&hl=en-US";
    const feed = await rssParser.parseString(String((await httpReq("GET", backupUrl)).data || ""));
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
  const { fetchWithProxy, httpReq, rssParser, logger, normalizeUpdate, cleanText, stableUpdateId } = deps;
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
    logger("WARN", "SCRAPE", "AMD proxy a returnat continut, dar regex-ul `Adrenalin Edition X.Y.Z` nu a prins versiunea — posibil schema drift, fallback RSS");
  } catch (err) {
    logger("WARN", "SCRAPE", "Eroare preluare AMD proxy", errorMessage(err));
  }
  const res = await httpReq("GET",
    "https://news.google.com/rss/search?q=site:amd.com+%22AMD+Software:+Adrenalin+Edition%22+release+notes&hl=en-US");
  const feed = await rssParser.parseString(String(res.data || ""));
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
  const { fetchWithProxy, httpReq, rssParser, logger, normalizeUpdate, cleanText, stableUpdateId } = deps;
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
    logger("WARN", "SCRAPE", `Intel proxy a returnat continut pentru ${game.key}, dar regex-ul de versiune (\\d+.\\d+.\\d+.\\d+) nu a prins nimic — posibil schema drift, fallback RSS`);
  } catch (err) {
    logger("WARN", "SCRAPE", "Eroare preluare Intel proxy", errorMessage(err));
  }
  const q = game.key === "intelpro"
    ? 'site:intel.com "Intel Arc Pro Graphics"'
    : 'site:intel.com "Intel Arc & Iris Xe Graphics - Windows"';
  const res = await httpReq("GET",
    `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US`);
  const feed = await rssParser.parseString(String(res.data || ""));
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
  const { conditionalGet, normalizeUpdate } = deps;
  return conditionalGet("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json", (raw) => {
    const manifest = raw as MinecraftVersionManifest;
    const v = manifest.latest?.release;
    if (!v) throw new Error("Lipsă versiune JSON");
    return normalizeUpdate({
      id: v,
      title: `Minecraft ${v}`,
      link: `https://www.minecraft.net/en-us/article/minecraft-java-edition-${String(v).replace(/\./g, "-")}`,
      excerpt: `Versiunea ${v}`,
      thumbnail: "https://static.wikia.nocookie.net/logopedia/images/6/64/Minecraft_Grass_Block.svg"
    });
  }, { largeJson: true });
}

async function fetchRobloxUpdate(): Promise<NormalizedUpdate> {
  const { conditionalGet, normalizeUpdate } = deps;
  return conditionalGet("https://clientsettings.roblox.com/v2/clientversion/WindowsPlayer", (raw) => {
    const versionInfo = raw as RobloxVersionResponse;
    const v = versionInfo.clientVersionUpload;
    if (!v) throw new Error("Lipsă versiune API");
    return normalizeUpdate({
      id: String(v),
      title: "Roblox Update",
      link: "https://en.help.roblox.com/hc/en-us",
      excerpt: `Versiunea ${v}`,
      thumbnail: "https://upload.wikimedia.org/wikipedia/commons/7/7e/Roblox_Logo_2022.jpg"
    });
  });
}

async function fetchNvidiaUpdate(g: GameConfig): Promise<NormalizedUpdate> {
  const { conditionalGet, rssParser, normalizeUpdate, cleanText, stableUpdateId } = deps;
  const q = g.key === "nvidiastudio" ? '"Studio Driver"' : '"Game Ready Driver"';
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`site:nvidia.com ${q} release`)}&hl=en-US`;
  return conditionalGet(url, async (raw) => {
    const f = await rssParser.parseString(String(raw || ""));
    if (!f.items || f.items.length === 0) throw new Error("Eșec Nvidia.");
    const rawTitle = f.items[0].title;
    if (!rawTitle) throw new Error("Nvidia RSS fallback fara titlu in primul item.");
    const cleanTitle = cleanText(rawTitle).split(" - ")[0];
    if (!cleanTitle) throw new Error("Nvidia RSS fallback cu titlu gol dupa curatare.");
    return normalizeUpdate({
      id: stableUpdateId(cleanTitle, ""),
      title: cleanTitle,
      link: f.items[0].link,
      excerpt: "Update nvidia.com detectat.",
      thumbnail: g.thumbnail,
      timestamp: f.items[0].pubDate
    });
  });
}

async function fetchRssUpdate(game: GameConfig): Promise<NormalizedUpdate> {
  const { conditionalGet, rssParser, normalizeUpdate, cleanText, stableUpdateId } = deps;
  const feedUrl = String(game.url || "");
  if (!feedUrl) throw new Error(`Sursa rss pentru ${game.key} nu are 'url' (feed).`);
  return conditionalGet(feedUrl, async (raw) => {
    const feed = await rssParser.parseString(String(raw || ""));
    const item = feed.items && feed.items[0];
    if (!item) throw new Error(`Feed RSS gol pentru ${game.key}.`);
    const title = cleanText(item.title || "");
    if (!title) throw new Error(`Primul item RSS pentru ${game.key} nu are titlu.`);
    const link = item.link || feedUrl;
    const id = item.guid ? String(item.guid) : stableUpdateId(title, String(link));
    const excerpt = cleanText(String(item.contentSnippet || "")).slice(0, 300) || "Update RSS detectat.";
    return normalizeUpdate({
      id,
      title,
      link,
      excerpt,
      thumbnail: game.thumbnail,
      timestamp: item.pubDate
    });
  });
}

async function fetchGameUpdateForSource(game: GameConfig): Promise<NormalizedUpdate> {
  const t = game.type;
  if (!t || t === "steam") return fetchSteamUpdate(game);
  if (t === "minecraft") return fetchMinecraftUpdate();
  if (t === "epic_games" && game.key === "fortnite") return fetchFortniteUpdate();
  if (t === "roblox") return fetchRobloxUpdate();
  if (t === "nvidia") return fetchNvidiaUpdate(game);
  if (t === "intel") return fetchIntelUpdate(game);
  if (t === "amd") return fetchAmdUpdate(game);
  if (t === "rss") return fetchRssUpdate(game);
  if (t === "listing_based" || t === "epic_games") return fetchListingBasedUpdate(game);
  throw new Error("Tip necunoscut.");
}

function applyFallbackSource(game: GameConfig, fallback: GameSourceFallback): GameConfig {
  return {
    ...game,
    type: fallback.type,
    url: fallback.url ?? game.url,
    listingUrl: fallback.listingUrl ?? game.listingUrl,
    listingUrls: fallback.listingUrls ?? game.listingUrls,
    baseUrl: fallback.baseUrl ?? game.baseUrl
  };
}

async function fetchGameUpdate(game: GameConfig): Promise<NormalizedUpdate> {
  try {
    return await fetchGameUpdateForSource(game);
  } catch (primaryErr) {
    const fallbacks = Array.isArray(game.fallbacks) ? game.fallbacks : [];
    for (const fallback of fallbacks) {
      if (!fallback || !fallback.type) continue;
      try {
        const update = await fetchGameUpdateForSource(applyFallbackSource(game, fallback));
        deps.logger("INFO", "FALLBACK", `Sursa principala pentru ${game.key} a esuat; am folosit fallback '${fallback.type}'.`);
        return update;
      } catch (fallbackErr) {
        deps.logger("WARN", "FALLBACK", `Sursa fallback '${fallback.type}' pentru ${game.key} a esuat`, errorMessage(fallbackErr));
      }
    }
    throw primaryErr;
  }
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
  } = deps;
  let cb: CircuitBreakerDoc | null = null;
  try {
    cb = await CircuitBreakerModel.findOneAndUpdate(
      { _id: game.key },
      { $setOnInsert: { fails: 0, cooldownUntil: null, alertSent: false, schemaDriftFails: 0, schemaDriftAlertSent: false } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    if (!cb) throw new Error(`Circuit breaker document lipsa pentru ${game.key}`);
  } catch (cbGetErr) {
    deps.logger("WARN", "CIRCUIT_BREAKER",
      `Eroare la citirea state-ului CB pentru ${game.key}, sar fetch-ul ciclului curent`,
      errorMessage(cbGetErr));
    metricsRef.fetchFail++;
    return { game, latest: null, error: errorMessage(cbGetErr) };
  }
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
    try {
      if (error instanceof SchemaDriftError) {
        const updatedCb = await CircuitBreakerModel.findOneAndUpdate(
          { _id: game.key },
          { $inc: { schemaDriftFails: 1 } },
          { new: true, upsert: true }
        );
        if (updatedCb.schemaDriftFails >= SCHEMA_DRIFT_THRESHOLD
            && (!updatedCb.cooldownUntil || new Date() >= new Date(updatedCb.cooldownUntil))) {
          const jitter = Math.floor(Math.random() * CIRCUIT_BREAKER_JITTER_MS);
          await CircuitBreakerModel.updateOne(
            { _id: game.key },
            { $set: { cooldownUntil: new Date(Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS + jitter) } }
          );
          if (!updatedCb.schemaDriftAlertSent) {
            await CircuitBreakerModel.updateOne({ _id: game.key }, { $set: { schemaDriftAlertSent: true } });
            await adminAlert(
              `drift:${game.key}`,
              `Schema drift suspectat: ${game.name}`,
              `Sursa pentru \`${game.key}\` returnează HTTP OK dar 0 rezultate valide după ${updatedCb.schemaDriftFails} cicluri consecutive. Probabil selectorii CSS/HTML s-au schimbat.\nSursă: ${error.source}\nMesaj: ${error.message}\nCooldown ~${Math.round(CIRCUIT_BREAKER_COOLDOWN_MS/60000)}-${Math.round((CIRCUIT_BREAKER_COOLDOWN_MS+CIRCUIT_BREAKER_JITTER_MS)/60000)} min.`
            );
          }
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
    } catch (bookkeepingErr) {
      deps.logger("WARN", "CIRCUIT_BREAKER",
        `Eroare la actualizarea state-ului circuit breaker pentru ${game.key}`,
        errorMessage(bookkeepingErr));
    }
    metricsRef.fetchFail++;
    return { game, latest: null, error: errorMessage(error) };
  }
}

async function _getLatestForAllGamesImpl(games: GameConfig[], shouldAbort?: AbortPredicate): Promise<FetchResult[]> {
  const { runConcurrent, logger } = deps;
  const exec = deps.executeFetchWithCircuitBreaker || executeFetchWithCircuitBreaker;
  const list = games.slice();
  const results = new Array<FetchResult | undefined>(list.length);

  const groups = new Map<string, Array<{ game: GameConfig; idx: number }>>();
  for (let idx = 0; idx < list.length; idx++) {
    const group = sourceConcurrencyGroup(list[idx]);
    const bucket = groups.get(group);
    if (bucket) bucket.push({ game: list[idx], idx });
    else groups.set(group, [{ game: list[idx], idx }]);
  }

  const errorsByIndex = new Map<number, unknown>();
  await Promise.all(Array.from(groups.entries()).map(async ([group, items]) => {
    const runResult = await runConcurrent(items, concurrencyForGroup(group), async (item) => {
      results[item.idx] = await exec(item.game);
    }, {
      shouldAbort,
      errorLogger: (item: { game: GameConfig }, err: unknown) => {
        logger("WARN", "FETCH_WORKER", `Eroare la procesarea ${item.game.key}`, errorMessage(err));
      }
    });
    if (runResult && Array.isArray((runResult as { errors?: unknown }).errors)) {
      for (const entry of ((runResult as { errors: Array<{ index: number; error: unknown }> }).errors)) {
        const globalIdx = items[entry.index]?.idx;
        if (globalIdx !== undefined) errorsByIndex.set(globalIdx, entry.error);
      }
    }
  }));

  for (let i = 0; i < results.length; i++) {
    if (!results[i]) {
      const concurrentErr = errorsByIndex.get(i);
      const placeholderError = concurrentErr !== undefined
        ? errorMessage(concurrentErr)
        : "abort";
      results[i] = { game: list[i], latest: null, error: placeholderError };
    }
  }
  return results as FetchResult[];
}

async function getLatestForAllGames(games: GameConfig[], shouldAbort?: AbortPredicate): Promise<FetchResult[]> {
  const { crypto, logger, withInflightTimeout, trackInflight } = deps;
  const sourceModeBase = shouldAbort ? "cron" : "manual";
  const keysHash = crypto.createHash("sha1")
    .update(games.map(g => String(g.key)).sort().join(","))
    .digest("hex")
    .substring(0, 8);
  const contextKey = `${sourceModeBase}:${keysHash}`;
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

function createUpdates(d: UpdatesDeps): UpdatesApi {
  deps = d;
  return {
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
    applyFallbackSource,
    executeFetchWithCircuitBreaker,
    sourceConcurrencyGroup,
    getLatestForAllGames
  };
}

function attachUpdates(target: UpdatesContext): void {
  Object.assign(target, createUpdates({
    rssParser: target.rssParser,
    CircuitBreakerModel: target.CircuitBreakerModel,
    logger: target.logger,
    adminAlert: target.adminAlert,
    runConcurrent: target.runConcurrent,
    SchemaDriftError: target.SchemaDriftError,
    FETCH_CONCURRENCY: target.FETCH_CONCURRENCY,
    FETCH_CONCURRENCY_STEAM: target.FETCH_CONCURRENCY_STEAM,
    FETCH_CONCURRENCY_EPIC: target.FETCH_CONCURRENCY_EPIC,
    FETCH_CONCURRENCY_LISTING: target.FETCH_CONCURRENCY_LISTING,
    FETCH_CONCURRENCY_DRIVER: target.FETCH_CONCURRENCY_DRIVER,
    CIRCUIT_BREAKER_FAIL_THRESHOLD: target.CIRCUIT_BREAKER_FAIL_THRESHOLD,
    CIRCUIT_BREAKER_COOLDOWN_MS: target.CIRCUIT_BREAKER_COOLDOWN_MS,
    CIRCUIT_BREAKER_JITTER_MS: target.CIRCUIT_BREAKER_JITTER_MS,
    SCHEMA_DRIFT_THRESHOLD: target.SCHEMA_DRIFT_THRESHOLD,
    httpReq: target.httpReq,
    conditionalGet: target.conditionalGet,
    fetchWithProxy: target.fetchWithProxy,
    withInflightTimeout: target.withInflightTimeout,
    trackInflight: target.trackInflight,
    cleanText: target.cleanText,
    stableUpdateId: target.stableUpdateId,
    normalizeUpdate: target.normalizeUpdate,
    safeCheerioLoad: target.safeCheerioLoad,
    crypto: target.crypto,
    metricsRef: target.metricsRef,
    executeFetchWithCircuitBreaker: target.executeFetchWithCircuitBreaker
  }));
}

attachUpdates.sourceConcurrencyGroup = sourceConcurrencyGroup;
attachUpdates.createUpdates = createUpdates;

export = attachUpdates;
