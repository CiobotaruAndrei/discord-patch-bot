export const YOUTUBE_FIELDS = [
  "youtubeChannels",
  "youtubeNotificationChannelId",
  "youtubeNotificationsEnabled",
  "youtubeHasActivated",
  "youtubeFilters",
  "youtubeMessageTemplate",
  "youtubeChannelRoutes",
  "youtubeTitleIncludeWords"
] as const;

export type YoutubeField = (typeof YOUTUBE_FIELDS)[number];
