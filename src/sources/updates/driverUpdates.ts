import type { GameConfig, HttpRequestOptions, NormalizedUpdate, PatchUpdate } from "../../types.js";
import { errorMessage } from "../../shared/errors.js";
import type { HttpReq, RssParserLike } from "./updateHelpers.js";

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
  function parseDriverRssFeed(vendor: string, game: GameConfig, excerpt: string) {
    const { rssParser, normalizeUpdate, cleanText, stableUpdateId } = deps;
    return async (raw: unknown): Promise<NormalizedUpdate> => {
      const feed = await rssParser.parseString(String(raw || ""));
      if (!feed.items || feed.items.length === 0) throw new Error(`Eșec ${vendor}.`);
      const rawTitle = feed.items[0].title;
      if (!rawTitle) throw new Error(`${vendor} RSS fara titlu in primul item.`);
      const cleanTitle = cleanText(rawTitle).split(" - ")[0];
      if (!cleanTitle) throw new Error(`${vendor} RSS cu titlu gol dupa curatare.`);
      return normalizeUpdate({
        id: stableUpdateId(cleanTitle, ""),
        title: cleanTitle,
        link: feed.items[0].link,
        excerpt,
        thumbnail: game.thumbnail,
        timestamp: feed.items[0].pubDate
      });
    };
  }

  async function fetchAmdUpdate(game: GameConfig): Promise<NormalizedUpdate> {
    const { fetchWithProxy, conditionalGet, logger, normalizeUpdate } = deps;
    try {
      return await conditionalGet(
        "https://news.google.com/rss/search?q=site:amd.com+%22AMD+Software:+Adrenalin+Edition%22+release+notes&hl=en-US",
        parseDriverRssFeed("AMD", game, "Update AMD.com.")
      );
    } catch (rssErr) {
      logger("WARN", "SCRAPE", "AMD RSS (sursa primara) a esuat — incerc pagina oficiala ca fallback", errorMessage(rssErr));
    }
    const rawContent = await fetchWithProxy("https://www.amd.com/en/support/download/drivers.html");
    const match = rawContent.match(/Adrenalin Edition\s+([\d\.]+)/i);
    if (!match) throw new Error("Eșec AMD: RSS-ul primar a esuat, iar pagina oficiala nu expune versiunea in HTML static (regex `Adrenalin Edition X.Y.Z` fara match).");
    return normalizeUpdate({
      id: match[1],
      title: `AMD Radeon Adrenalin v${match[1]}`,
      link: "https://www.amd.com",
      excerpt: "Driver disponibil.",
      thumbnail: game.thumbnail
    });
  }

  async function fetchIntelUpdate(game: GameConfig): Promise<NormalizedUpdate> {
    const { fetchWithProxy, conditionalGet, logger, normalizeUpdate } = deps;
    const q = game.key === "intelpro"
      ? 'site:intel.com "Intel Arc Pro Graphics"'
      : 'site:intel.com "Intel Arc & Iris Xe Graphics - Windows"';
    try {
      return await conditionalGet(
        `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US`,
        parseDriverRssFeed("Intel", game, "Update intel.com detectat.")
      );
    } catch (rssErr) {
      logger("WARN", "SCRAPE", `Intel RSS (sursa primara) a esuat pentru ${game.key} — incerc pagina oficiala ca fallback`, errorMessage(rssErr));
    }
    const rawContent = await fetchWithProxy(game.url as string);
    const match = rawContent.match(/\b(\d{2,3}\.\d+\.\d+\.\d+)\b/);
    if (!match) throw new Error(`Eșec Intel (${game.key}): RSS-ul primar a esuat, iar pagina oficiala nu expune versiunea in HTML static.`);
    return normalizeUpdate({
      id: match[1],
      title: `${game.name} v${match[1]}`,
      link: game.url,
      excerpt: `Versiune găsită: ${match[1]}`,
      thumbnail: game.thumbnail
    });
  }

  async function fetchNvidiaUpdate(g: GameConfig): Promise<NormalizedUpdate> {
    const { conditionalGet } = deps;
    const q = g.key === "nvidiastudio" ? '"Studio Driver"' : '"Game Ready Driver"';
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`site:nvidia.com ${q} release`)}&hl=en-US`;
    return conditionalGet(url, parseDriverRssFeed("Nvidia", g, "Update nvidia.com detectat."));
  }

  return { fetchAmdUpdate, fetchIntelUpdate, fetchNvidiaUpdate };
}

export { createDriverUpdates };
export type { DriverUpdatesDeps };
