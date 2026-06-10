import type { GameConfig, HttpRequestOptions, NormalizedUpdate, PatchUpdate } from "../../types";
import { errorMessage } from "../../shared/errors";
import type { HttpReq, RssParserLike } from "./updateHelpers";

interface DriverUpdatesDeps {
  fetchWithProxy: (targetUrl: string, options?: HttpRequestOptions) => Promise<string>;
  httpReq: HttpReq;
  conditionalGet: <T>(url: string, parse: (data: unknown) => T | Promise<T>, options?: HttpRequestOptions) => Promise<T>;
  rssParser: RssParserLike;
  logger: (level: string, context: string, message: string, meta?: unknown) => void;
  normalizeUpdate: (data: PatchUpdate) => NormalizedUpdate;
  cleanText: (text: unknown) => string;
  stableUpdateId: (title: unknown, link: unknown) => string;
}

function createDriverUpdates(deps: DriverUpdatesDeps) {
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

  return { fetchAmdUpdate, fetchIntelUpdate, fetchNvidiaUpdate };
}

export { createDriverUpdates };
export type { DriverUpdatesDeps };
