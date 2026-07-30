import { requestOptionsFor } from "../../sources/sourcePolicies.js";
import Parser from "rss-parser";
import type { CheerioAPI } from "cheerio";
import type { YouTubeFilters, YouTubeVideo, YouTubeVideoMetadata } from "./youtubeTypes.js";
import type { HttpRequestOptions } from "../../sources/httpRequestTypes.js";

type HttpReq = (
  method: string,
  url: string,
  options?: HttpRequestOptions,
  retries?: number,
  backoff?: number
) => Promise<{ data: unknown }>;

interface YouTubeSourceDeps {
  httpReq: HttpReq;
  safeCheerioLoad(html: unknown): CheerioAPI;
}

export interface ResolvedYouTubeChannel {
  channelId: string;
  channelName: string;
  channelUrl: string;
}

interface YouTubeFeedItem {
  title?: string;
  link?: string;
  pubDate?: string;
  isoDate?: string;
  id?: string;
  guid?: string;
  author?: string;
}

const CHANNEL_ID_PATTERN = /^UC[a-zA-Z0-9_-]{22}$/;
const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const parser = new Parser();

function normalizeChannelId(value: unknown): string | null {
  const candidate = String(value ?? "").trim();
  return CHANNEL_ID_PATTERN.test(candidate) ? candidate : null;
}

function channelIdFromUrl(url: URL): string | null {
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "channel") return normalizeChannelId(parts[1]);
  return null;
}

function normalizeYouTubeInput(value: unknown): { directChannelId: string | null; pageUrl: string } {
  const input = String(value ?? "").trim();
  const directChannelId = normalizeChannelId(input);
  if (directChannelId) {
    return {
      directChannelId,
      pageUrl: `https://www.youtube.com/channel/${directChannelId}`
    };
  }
  const normalizedUrl = /^https?:\/\//i.test(input)
    ? input
    : input.startsWith("@")
      ? `https://www.youtube.com/${input}`
      : `https://www.youtube.com/@${input}`;
  let url: URL;
  try {
    url = new URL(normalizedUrl);
  } catch {
    throw new Error("Canal YouTube invalid. Foloseste un link, un handle @nume sau un channel ID.");
  }
  if (url.protocol !== "https:" || !YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("Canal YouTube invalid. Sunt acceptate numai link-uri youtube.com.");
  }
  const directFromUrl = channelIdFromUrl(url);
  return {
    directChannelId: directFromUrl,
    pageUrl: directFromUrl
      ? `https://www.youtube.com/channel/${directFromUrl}`
      : `https://www.youtube.com${url.pathname}`
  };
}

function extractChannelId(html: string, page: CheerioAPI): string | null {
  const candidates = [
    page('meta[itemprop="channelId"]').attr("content"),
    page('link[rel="canonical"]').attr("href"),
    html.match(/"channelId":"(UC[a-zA-Z0-9_-]{22})"/)?.[1],
    html.match(/"externalId":"(UC[a-zA-Z0-9_-]{22})"/)?.[1]
  ];
  for (const candidate of candidates) {
    const direct = normalizeChannelId(candidate);
    if (direct) return direct;
    if (typeof candidate === "string") {
      try {
        const fromUrl = channelIdFromUrl(new URL(candidate));
        if (fromUrl) return fromUrl;
      } catch {}
    }
  }
  return null;
}

function extractChannelName(page: CheerioAPI, channelId: string): string {
  const raw = page('meta[property="og:title"]').attr("content")
    || page('meta[name="title"]').attr("content")
    || page("title").first().text()
    || channelId;
  return raw.replace(/\s*-\s*YouTube\s*$/i, "").trim().slice(0, 100) || channelId;
}

function videoIdFromItem(item: YouTubeFeedItem): string | null {
  const direct = [item.id, item.guid]
    .map(value => String(value ?? "").trim())
    .find(value => VIDEO_ID_PATTERN.test(value));
  if (direct) return direct;
  const tagged = [item.id, item.guid]
    .map(value => String(value ?? "").match(/yt:video:([a-zA-Z0-9_-]{11})/)?.[1])
    .find(Boolean);
  if (tagged && VIDEO_ID_PATTERN.test(tagged)) return tagged;
  if (!item.link) return null;
  try {
    const url = new URL(item.link);
    const queryId = url.searchParams.get("v");
    if (queryId && VIDEO_ID_PATTERN.test(queryId)) return queryId;
    const parts = url.pathname.split("/").filter(Boolean);
    const pathId = parts.at(-1);
    return pathId && VIDEO_ID_PATTERN.test(pathId) ? pathId : null;
  } catch {
    return null;
  }
}

function parseBooleanProperty(html: string, property: string): boolean {
  return new RegExp(`"${property}"\\s*:\\s*true`, "i").test(html);
}

function parseLengthSeconds(html: string): number | null {
  const raw = html.match(/"lengthSeconds"\s*:\s*"(\d{1,8})"/)?.[1];
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function videoPassesYouTubeFilters(metadata: YouTubeVideoMetadata, filters: YouTubeFilters | null | undefined): boolean {
  if ((filters?.excludeShorts ?? true) && metadata.isShort) return false;
  if ((filters?.excludeLives ?? true) && metadata.isLive) return false;
  if ((filters?.excludePremieres ?? true) && metadata.isPremiere) return false;
  const minimum = Number.isFinite(filters?.minDurationSeconds)
    ? Math.max(0, Number(filters?.minDurationSeconds))
    : 0;
  if (minimum > 0 && (metadata.durationSeconds === null || metadata.durationSeconds < minimum)) return false;
  return true;
}

export function createYouTubeSource(deps: YouTubeSourceDeps) {
  const { httpReq, safeCheerioLoad } = deps;

  async function resolveYouTubeChannel(input: string): Promise<ResolvedYouTubeChannel> {
    const normalized = normalizeYouTubeInput(input);
    const response = await httpReq("GET", normalized.pageUrl, {
      ...requestOptionsFor("youtube-channel-page"),
      headers: { "Accept-Language": "en-US,en;q=0.9" }
    });
    const html = String(response.data ?? "");
    const page = safeCheerioLoad(html);
    const channelId = normalized.directChannelId || extractChannelId(html, page);
    if (!channelId) {
      throw new Error("Nu am putut identifica channel ID-ul YouTube din pagina indicata.");
    }
    return {
      channelId,
      channelName: extractChannelName(page, channelId),
      channelUrl: `https://www.youtube.com/channel/${channelId}`
    };
  }

  async function fetchYouTubeFeed(channel: ResolvedYouTubeChannel | { channelId: string; channelName: string }): Promise<YouTubeVideo[]> {
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channel.channelId)}`;
    const response = await httpReq("GET", feedUrl, {
      ...requestOptionsFor("youtube-feed"),
      headers: { Accept: "application/atom+xml,application/xml;q=0.9,text/xml;q=0.8" }
    });
    const feed = await parser.parseString(String(response.data ?? ""));
    const videos: YouTubeVideo[] = [];
    for (const rawItem of feed.items || []) {
      const item = rawItem as YouTubeFeedItem;
      const videoId = videoIdFromItem(item);
      if (!videoId) continue;
      videos.push({
        videoId,
        channelId: channel.channelId,
        channelName: channel.channelName,
        title: String(item.title || "Videoclip nou").slice(0, 250),
        link: `https://www.youtube.com/watch?v=${videoId}`,
        publishedAt: String(item.isoDate || item.pubDate || ""),
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
      });
    }
    return videos;
  }

  async function fetchYouTubeVideoMetadata(video: YouTubeVideo): Promise<YouTubeVideoMetadata> {
    const response = await httpReq("GET", video.link, {
      ...requestOptionsFor("youtube-video-metadata"),
      headers: { "Accept-Language": "en-US,en;q=0.9" }
    });
    const html = String(response.data ?? "");
    const durationSeconds = parseLengthSeconds(html);
    const isPremiere = parseBooleanProperty(html, "isPremiere");
    const isLiveContent = parseBooleanProperty(html, "isLiveContent");
    const isLive = !isPremiere && (parseBooleanProperty(html, "isLive") || isLiveContent);
    const isShort = parseBooleanProperty(html, "isShort")
      || /"webPageType"\s*:\s*"WEB_PAGE_TYPE_SHORTS"/i.test(html)
      || (durationSeconds !== null && durationSeconds <= 60);
    return { durationSeconds, isShort, isLive, isPremiere };
  }

  return {
    resolveYouTubeChannel,
    fetchYouTubeFeed,
    fetchYouTubeVideoMetadata,
    videoPassesYouTubeFilters
  };
}

export {
  normalizeChannelId,
  normalizeYouTubeInput,
  extractChannelId,
  videoIdFromItem,
  parseLengthSeconds,
  videoPassesYouTubeFilters
};
