"use strict";

import type { GuildSettings, YouTubeFilters } from "../../../types.js";
import { paginateTextLines } from "../../command-presentation/discordListLimit.js";

export function defaultFilters(settings: GuildSettings | null): Required<YouTubeFilters> {
  return {
    excludeShorts: settings?.youtubeFilters?.excludeShorts ?? true,
    excludeLives: settings?.youtubeFilters?.excludeLives ?? true,
    excludePremieres: settings?.youtubeFilters?.excludePremieres ?? true,
    minDurationSeconds: Number(settings?.youtubeFilters?.minDurationSeconds ?? 0)
  };
}

export function onOff(value: boolean): string {
  return value ? "ON" : "OFF";
}

export function formatTime(value: Date | string | null | undefined): string {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) && time > 0 ? `<t:${Math.floor(time / 1000)}:R>` : "niciodata";
}

export function formatYouTubeList(settings: GuildSettings | null): string {
  return formatYouTubeListPages(settings)[0];
}

export function formatYouTubeListPages(settings: GuildSettings | null): string[] {
  const channels = settings?.youtubeChannels || [];
  if (!channels.length) return ["Nu exista canale YouTube urmarite."];
  const lines = channels.map((channel, index) => {
    const error = channel.lastError?.message ? `, ultima eroare: ${channel.lastError.message}` : "";
    return `${index + 1}. **${channel.channelName}** (\`${channel.channelId}\`) - ultima verificare ${formatTime(channel.lastCheckedAt)}${error}`;
  });
  return paginateTextLines(lines, { maxChars: 1900, firstPagePrefix: `Canale YouTube urmarite (${channels.length}):\n` });
}

export function formatFilters(filters: Required<YouTubeFilters>): string {
  return [
    `filtru Shorts: ${onOff(filters.excludeShorts)}`,
    `filtru live: ${onOff(filters.excludeLives)}`,
    `filtru premiere: ${onOff(filters.excludePremieres)}`,
    `durata minima: ${filters.minDurationSeconds}s`
  ].join("\n");
}

export function formatYouTubeStatus(settings: GuildSettings | null, recentErrorCount: number): string {
  const channels = settings?.youtubeChannels || [];
  const lastChecked = channels
    .map(channel => channel.lastCheckedAt ? new Date(channel.lastCheckedAt).getTime() : 0)
    .reduce((latest, value) => Math.max(latest, value), 0);
  return [
    `notificari: ${onOff(settings?.youtubeNotificationsEnabled === true)}`,
    `canal Discord: ${settings?.youtubeNotificationChannelId ? `<#${settings.youtubeNotificationChannelId}>` : "neconfigurat"}`,
    `canale urmarite: ${channels.length}`,
    `rute speciale: ${(settings?.youtubeChannelRoutes || []).reduce((total, route) => total + route.discordChannelIds.length, 0)}`,
    `filtre titlu: ${settings?.youtubeTitleIncludeWords?.length || 0}`,
    `sablon mesaj: ${settings?.youtubeMessageTemplate ? "personalizat" : "implicit"}`,
    `ultima verificare: ${lastChecked > 0 ? `<t:${Math.floor(lastChecked / 1000)}:R>` : "niciodata"}`,
    `erori recente: ${recentErrorCount}`,
    formatFilters(defaultFilters(settings))
  ].join("\n");
}

export function formatYouTubeRoutes(settings: GuildSettings | null): string {
  return formatYouTubeRoutesPages(settings)[0];
}

export function formatYouTubeRoutesPages(settings: GuildSettings | null): string[] {
  const routes = settings?.youtubeChannelRoutes || [];
  if (!routes.length) return ["Nu exista rute speciale YouTube. Toate videoclipurile folosesc canalul principal."];
  const channelNames = new Map((settings?.youtubeChannels || []).map(channel => [channel.channelId, channel.channelName]));
  const lines = routes.map(route => {
    const destinations = route.discordChannelIds.map(channelId => `<#${channelId}>`).join(", ");
    return `- **${channelNames.get(route.channelId) || route.channelId}**: ${destinations || "fara destinatii"}`;
  });
  return paginateTextLines(lines, { maxChars: 1900, firstPagePrefix: `Rute speciale YouTube (${routes.length}):\n` });
}
