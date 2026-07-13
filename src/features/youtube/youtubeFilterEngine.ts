"use strict";

import type { GuildSettings, YouTubeChannelSubscription, YouTubeFilters, YouTubeVideo, YouTubeVideoMetadata } from "../../types.js";
import type { PreparedVideo } from "./youtubeDeliveryPlanner.js";
import type { MetadataResolver } from "./youtubeMetadataResolver.js";
import { videoPassesYouTubeTitleFilter } from "./youtubeDeliveryPolicy.js";

export interface YouTubeFilterEngineDeps {
  fetchYouTubeVideoMetadata: MetadataResolver;
  videoPassesYouTubeFilters(metadata: YouTubeVideoMetadata, filters?: YouTubeFilters | null): boolean;
}

export function createYouTubeFilterEngine(deps: YouTubeFilterEngineDeps) {
  async function prepareVideo(
    guild: GuildSettings,
    channel: YouTubeChannelSubscription,
    video: YouTubeVideo,
    resolveMetadata: MetadataResolver = deps.fetchYouTubeVideoMetadata
  ): Promise<PreparedVideo | null> {
    const metadata = await resolveMetadata(video);
    if (!deps.videoPassesYouTubeFilters(metadata, guild.youtubeFilters)) return null;
    if (!videoPassesYouTubeTitleFilter(video, guild.youtubeTitleIncludeWords)) return null;
    return { channel, video, metadata };
  }

  return { prepareVideo };
}
