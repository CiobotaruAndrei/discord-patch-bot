"use strict";

import type { YouTubeChannelSubscription, YouTubeVideo, YouTubeVideoMetadata } from "./youtubeTypes.js";
import { embedCharCost } from "../../shared/discordEmbedChunks.js";
import { YOUTUBE_BATCH_SIZE, renderYouTubeMessageTemplate } from "./youtubeDeliveryPolicy.js";

export interface PreparedVideo {
  channel: YouTubeChannelSubscription;
  video: YouTubeVideo;
  metadata: YouTubeVideoMetadata;
}

export function buildYouTubeEmbed(item: PreparedVideo): Record<string, unknown> {
  const duration = item.metadata.durationSeconds === null
    ? "necunoscuta"
    : `${Math.floor(item.metadata.durationSeconds / 60)}m ${item.metadata.durationSeconds % 60}s`;
  return {
    title: item.video.title,
    url: item.video.link,
    description: `Videoclip nou de la **${item.channel.channelName}**`,
    color: 0xff0000,
    thumbnail: { url: item.video.thumbnail },
    fields: [
      { name: "Durata", value: duration, inline: true },
      { name: "Canal", value: `[${item.channel.channelName}](${item.channel.channelUrl})`, inline: true }
    ],
    timestamp: item.video.publishedAt || new Date().toISOString()
  };
}

export function sortedVideos(videos: YouTubeVideo[]): YouTubeVideo[] {
  return videos.slice().sort((left, right) => {
    const leftTime = Date.parse(left.publishedAt) || 0;
    const rightTime = Date.parse(right.publishedAt) || 0;
    return leftTime - rightTime;
  });
}

export function packYouTubeDeliveries(items: PreparedVideo[], template: string | null | undefined): PreparedVideo[][] {
  const batches: PreparedVideo[][] = [];
  let current: PreparedVideo[] = [];
  let currentEmbedChars = 0;
  let currentContentChars = 0;
  for (const item of items) {
    const embedChars = embedCharCost(buildYouTubeEmbed(item));
    const contentChars = renderYouTubeMessageTemplate(template, item.channel, item.video).length + (current.length ? 2 : 0);
    if (
      current.length > 0
      && (
        current.length >= YOUTUBE_BATCH_SIZE
        || currentEmbedChars + embedChars > 5800
        || currentContentChars + contentChars > 1900
      )
    ) {
      batches.push(current);
      current = [];
      currentEmbedChars = 0;
      currentContentChars = 0;
    }
    current.push(item);
    currentEmbedChars += embedChars;
    currentContentChars += renderYouTubeMessageTemplate(template, item.channel, item.video).length + (current.length > 1 ? 2 : 0);
  }
  if (current.length) batches.push(current);
  return batches;
}
