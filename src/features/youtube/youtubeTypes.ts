import type { LastErrorInfo } from "../notifications/notificationTypes";

export interface YouTubeChannelSubscription {
  channelId: string;
  channelName: string;
  channelUrl: string;
  subscribedAt: Date | string;
  lastCheckedAt?: Date | string | null;
  lastVideoId?: string;
  lastError?: LastErrorInfo;
}

export interface YouTubeFilters {
  excludeShorts?: boolean;
  excludeLives?: boolean;
  excludePremieres?: boolean;
  minDurationSeconds?: number;
}

export interface YouTubeChannelRoute {
  channelId: string;
  discordChannelIds: string[];
}

export interface YouTubeErrorEntry {
  channelId: string;
  channelName: string;
  message: string;
  at: Date | string;
}

export interface YouTubeVideo {
  videoId: string;
  channelId: string;
  channelName: string;
  title: string;
  link: string;
  publishedAt: string;
  thumbnail: string;
}

export interface YouTubeVideoMetadata {
  durationSeconds: number | null;
  isShort: boolean;
  isLive: boolean;
  isPremiere: boolean;
}
