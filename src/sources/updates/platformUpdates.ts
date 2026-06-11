import type { GameConfig, HttpRequestOptions, NormalizedUpdate, PatchUpdate } from "../../types";
import { errorMessage } from "../../shared/errors";
import type { HttpReq, RssParserLike } from "./updateHelpers";

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


interface PlatformUpdatesDeps {
  conditionalGet: <T>(url: string, parse: (data: unknown) => T | Promise<T>, options?: HttpRequestOptions) => Promise<T>;
  rssParser: RssParserLike;
  normalizeUpdate: (data: PatchUpdate) => NormalizedUpdate;
  cleanText: (text: unknown) => string;
  stableUpdateId: (title: unknown, link: unknown) => string;
  fetchWithProxy: (targetUrl: string, options?: HttpRequestOptions) => Promise<string>;
  httpReq: HttpReq;
  logger: (level: string, context: string, message: string, meta?: unknown) => void;
}

function createPlatformUpdates(deps: PlatformUpdatesDeps) {
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
        thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/FortniteLogo.svg/330px-FortniteLogo.svg.png",
        timestamp: latest.date
      });
    } catch (err) {
      logger("WARN", "SCRAPE", "Fortnite primary path a esuat, fallback la RSS Google News", errorMessage(err));
      const backupUrl = "https://news.google.com/rss/search?q=site:fortnite.com/news+update&hl=en-US";
      const feed = await rssParser.parseString(String((await httpReq("GET", backupUrl)).data || ""));
      if (!feed.items || feed.items.length === 0) throw new Error("Eșec total Fortnite.");
      const first = feed.items[0];
      if (!first.title) throw new Error("Fortnite RSS fallback fara titlu in primul item.");
      const cleanTitle = cleanText(first.title).split(" - ")[0];
      if (!cleanTitle) throw new Error("Fortnite RSS fallback cu titlu gol dupa curatare.");
      return normalizeUpdate({
        id: stableUpdateId(cleanTitle, ""),
        title: cleanTitle,
        link: first.link,
        excerpt: "Update oficial Fortnite.",
        thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/FortniteLogo.svg/330px-FortniteLogo.svg.png",
        timestamp: first.pubDate
      });
    }
  }

  async function conditionalGetFromMirrors<T>(
    urls: string[],
    parse: (raw: unknown) => T | Promise<T>,
    options?: HttpRequestOptions
  ): Promise<T> {
    const { conditionalGet, logger } = deps;
    let lastErr: unknown = null;
    for (let i = 0; i < urls.length; i++) {
      try {
        return await conditionalGet(urls[i], parse, options);
      } catch (err) {
        lastErr = err;
        if (i + 1 < urls.length) {
          logger("WARN", "FETCH_UPDATES", `Mirror-ul ${urls[i]} a esuat, incerc ${urls[i + 1]}`, errorMessage(err));
        }
      }
    }
    throw lastErr;
  }

  const MINECRAFT_MANIFEST_MIRRORS = [
    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
    "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json"
  ];

  const ROBLOX_CLIENT_VERSION_MIRRORS = [
    "https://clientsettings.roblox.com/v2/client-version/WindowsPlayer",
    "https://clientsettingscdn.roblox.com/v2/client-version/WindowsPlayer"
  ];

  async function fetchMinecraftUpdate(): Promise<NormalizedUpdate> {
    const { normalizeUpdate } = deps;
    return conditionalGetFromMirrors(MINECRAFT_MANIFEST_MIRRORS, (raw) => {
      const manifest = raw as MinecraftVersionManifest;
      const v = manifest.latest?.release;
      if (!v) throw new Error("Lipsă versiune JSON");
      return normalizeUpdate({
        id: v,
        title: `Minecraft ${v}`,
        link: `https://www.minecraft.net/en-us/article/minecraft-java-edition-${String(v).replace(/\./g, "-")}`,
        excerpt: `Versiunea ${v}`,
        thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d8/Minecraft_cube.svg/330px-Minecraft_cube.svg.png"
      });
    }, { largeJson: true });
  }

  async function fetchRobloxUpdate(): Promise<NormalizedUpdate> {
    const { normalizeUpdate } = deps;
    return conditionalGetFromMirrors(ROBLOX_CLIENT_VERSION_MIRRORS, (raw) => {
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

  return { fetchFortniteUpdate, fetchMinecraftUpdate, fetchRobloxUpdate, fetchRssUpdate };
}

export { createPlatformUpdates };
export type { PlatformUpdatesDeps };
