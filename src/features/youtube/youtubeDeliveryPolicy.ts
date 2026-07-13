import type {
  GuildSettings,
  YouTubeChannelSubscription,
  YouTubeVideo
} from "../../types.js";

export const DEFAULT_YOUTUBE_MESSAGE_TEMPLATE = "Videoclip nou de la {channel}: {title}\n{url}";
export const YOUTUBE_BATCH_SIZE = 5;
export const YOUTUBE_BATCH_DELAY_MS = 10 * 60 * 1000;
export const YOUTUBE_RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const YOUTUBE_TEMPLATE_MAX_LENGTH = 1000;
export const YOUTUBE_TITLE_WORD_LIMIT = 50;

const TEMPLATE_VARIABLES = new Set(["channel", "title", "url"]);
const CHANNEL_REFERENCE_PATTERN = /^<#!?(\d{5,30})>$|^(\d{5,30})$/;

export function validateYouTubeMessageTemplate(template: string): string {
  const normalized = template.trim();
  if (!normalized) throw new Error("Sablonul YouTube nu poate fi gol.");
  if (normalized.length > YOUTUBE_TEMPLATE_MAX_LENGTH) {
    throw new Error(`Sablonul YouTube poate avea cel mult ${YOUTUBE_TEMPLATE_MAX_LENGTH} caractere.`);
  }
  const placeholders = normalized.matchAll(/\{([^{}]+)\}/g);
  for (const match of placeholders) {
    if (!TEMPLATE_VARIABLES.has(match[1])) {
      throw new Error(`Variabila {${match[1]}} nu este acceptata. Foloseste {channel}, {title} sau {url}.`);
    }
  }
  return normalized;
}

export function renderYouTubeMessageTemplate(
  template: string | null | undefined,
  channel: YouTubeChannelSubscription,
  video: YouTubeVideo
): string {
  const selected = template?.trim() || DEFAULT_YOUTUBE_MESSAGE_TEMPLATE;
  return selected
    .replaceAll("{channel}", channel.channelName)
    .replaceAll("{title}", video.title)
    .replaceAll("{url}", video.link);
}

export function normalizeYouTubeTitleWord(word: string): string {
  const normalized = word.trim().replace(/\s+/g, " ").toLocaleLowerCase("ro-RO");
  if (!normalized) throw new Error("Cuvantul pentru filtrul de titlu nu poate fi gol.");
  if (normalized.length > 100) throw new Error("Cuvantul pentru filtrul de titlu poate avea cel mult 100 de caractere.");
  return normalized;
}

export function videoPassesYouTubeTitleFilter(video: YouTubeVideo, words: string[] | null | undefined): boolean {
  const activeWords = (words || []).map(word => word.trim().toLocaleLowerCase("ro-RO")).filter(Boolean);
  if (!activeWords.length) return true;
  const title = video.title.toLocaleLowerCase("ro-RO");
  return activeWords.some(word => title.includes(word));
}

export function isRecentYouTubeVideo(video: YouTubeVideo, now: Date): boolean {
  const publishedAt = Date.parse(video.publishedAt);
  if (!Number.isFinite(publishedAt)) return false;
  const age = now.getTime() - publishedAt;
  return age >= 0 && age <= YOUTUBE_RECENT_WINDOW_MS;
}

export function parseDiscordChannelReference(value: string): string | null {
  const match = value.trim().match(CHANNEL_REFERENCE_PATTERN);
  return match ? String(match[1] || match[2]) : null;
}

export const MAX_YOUTUBE_ROUTE_DESTINATIONS = 5;

export function youtubeDestinationIds(
  guild: GuildSettings,
  youtubeChannelId: string
): string[] {
  const route = (guild.youtubeChannelRoutes || []).find(item => item.channelId === youtubeChannelId);
  const routed = Array.from(new Set((route?.discordChannelIds || []).filter(Boolean)));
  if (routed.length) return routed.slice(0, MAX_YOUTUBE_ROUTE_DESTINATIONS);
  return guild.youtubeNotificationChannelId ? [guild.youtubeNotificationChannelId] : [];
}
