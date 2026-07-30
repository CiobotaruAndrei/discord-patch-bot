"use strict";

import type { YouTubeVideo, YouTubeVideoMetadata } from "./youtubeTypes.js";

export type MetadataResolver = (video: YouTubeVideo) => Promise<YouTubeVideoMetadata>;

export interface YouTubeMetadataResolverDeps {
  fetchYouTubeVideoMetadata: MetadataResolver;
}

export function createYouTubeMetadataResolver(deps: YouTubeMetadataResolverDeps) {
  function createMetadataCache(): MetadataResolver {
    const cache = new Map<string, Promise<YouTubeVideoMetadata>>();
    return (video: YouTubeVideo) => {
      const cached = cache.get(video.videoId);
      if (cached) return cached;
      const pending = deps.fetchYouTubeVideoMetadata(video);
      cache.set(video.videoId, pending);
      return pending;
    };
  }

  return { createMetadataCache };
}
