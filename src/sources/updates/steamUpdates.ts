import type { GameConfig } from "../../config/configTypes.js";
import type { HttpRequestOptions } from "../httpRequestTypes.js";
import type { NormalizedUpdate, PatchUpdate } from "../sourceTypes.js";
import { selectLatestSteamPatchNoteIndex } from "../../native/fuzzy.js";
import { decodeSteamNewsResponse } from "../responseDecoders.js";

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

interface SteamUpdatesDeps {
  conditionalGet: <T>(url: string, parse: (data: unknown) => T | Promise<T>, options?: HttpRequestOptions) => Promise<T>;
  normalizeUpdate: (data: PatchUpdate) => NormalizedUpdate;
  cleanText: (text: unknown) => string;
}

function createSteamUpdates(deps: SteamUpdatesDeps) {
  async function fetchSteamUpdate(game: GameConfig): Promise<NormalizedUpdate> {
    const { conditionalGet, normalizeUpdate, cleanText } = deps;
    const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v0002/?appid=${game.appId}&count=50&format=json`;
    return conditionalGet(url, (raw) => {
      const data = decodeSteamNewsResponse(raw);
      const newsitems = data.appnews?.newsitems || [];
      const latestIndex = selectLatestSteamPatchNoteIndex(newsitems);
      if (latestIndex < 0) throw new Error("Lipsă patch notes Steam valabile.");
      const latest = newsitems[latestIndex];
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

  return { fetchSteamUpdate };
}

export { createSteamUpdates };
export type { SteamUpdatesDeps };
