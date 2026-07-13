"use strict";

import type { GuildSettings, YouTubeVideo } from "../../types.js";

export interface FeedResult {
  videos: YouTubeVideo[];
  error: string;
}

export interface YouTubeFeedLoaderDeps {
  runConcurrent<T>(
    items: T[],
    concurrency: number,
    fn: (item: T) => Promise<unknown>
  ): Promise<{ processed: number; errors: Array<{ error: unknown }> }>;
  fetchYouTubeFeed(channel: { channelId: string; channelName: string }): Promise<YouTubeVideo[]>;
  transientErrorMessage(error: unknown): string;
  fetchConcurrency: number;
}

export function createYouTubeFeedLoader(deps: YouTubeFeedLoaderDeps) {
  const { runConcurrent, fetchYouTubeFeed, transientErrorMessage, fetchConcurrency } = deps;

  async function loadFeeds(guilds: GuildSettings[]): Promise<Map<string, FeedResult>> {
    const unique = new Map<string, { channelId: string; channelName: string }>();
    for (const guild of guilds) {
      for (const channel of guild.youtubeChannels || []) {
        if (!unique.has(channel.channelId)) {
          unique.set(channel.channelId, {
            channelId: channel.channelId,
            channelName: channel.channelName
          });
        }
      }
    }
    const results = new Map<string, FeedResult>();
    await runConcurrent(
      Array.from(unique.values()),
      Math.max(1, fetchConcurrency),
      async channel => {
        try {
          const videos = await fetchYouTubeFeed(channel);
          results.set(channel.channelId, { videos, error: "" });
        } catch (error) {
          results.set(channel.channelId, {
            videos: [],
            error: transientErrorMessage(error)
          });
        }
      }
    );
    return results;
  }

  return { loadFeeds };
}
