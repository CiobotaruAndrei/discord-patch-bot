const installYouTube = require("../features/command-handlers/youtubeInteractionHandler") as typeof import("../features/command-handlers/youtubeInteractionHandler");
type HandlerDeps = Parameters<typeof installYouTube.createYouTubeInteractionHandler>[0];
type HandlerInteraction = Parameters<ReturnType<typeof installYouTube.createYouTubeInteractionHandler>["handleYouTubeInteraction"]>[0];

interface InteractionOptions {
  group?: string | null;
  subcommand: string;
  strings?: Record<string, string>;
  integers?: Record<string, number>;
  booleans?: Record<string, boolean>;
  channelId?: string;
}

export function makeInteraction(options: InteractionOptions): HandlerInteraction {
  return {
    commandName: "youtube",
    guild: { id: "guild-1" },
    client: { user: { id: "bot" }, channels: { fetch: async () => null } },
    isChatInputCommand: () => true,
    options: {
      getSubcommand: () => options.subcommand,
      getSubcommandGroup: () => options.group || null,
      getString: name => options.strings?.[name] ?? null,
      getInteger: name => options.integers?.[name] ?? null,
      getBoolean: name => options.booleans?.[name] ?? null,
      getChannel: () => options.channelId ? { id: options.channelId } : null
    }
  };
}

type FindOneAndUpdateImpl = (filter: object, update: object, options?: object) => Promise<{ youtubeChannels?: Array<{ channelId: string }>; youtubeChannelRoutes?: Array<{ channelId: string; discordChannelIds: string[] }>; youtubeTitleIncludeWords?: string[] } | null>;
type HarnessOverrides = {
  findOneAndUpdate?: FindOneAndUpdateImpl;
  checkChannelPermissions?: () => Promise<{ viewChannel: boolean; sendMessages: boolean; embedLinks: boolean; readMessageHistory: boolean } | null>;
  removeSeenChannel?: (guildId: string, channelId: string) => Promise<void>;
};

export function createHarness(settingsOverrides: object = {}, preparedCount = 3, outboxEnabled = false, skippedCount = 0, overrides: HarnessOverrides = {}) {
  const findOneAndUpdateOverride = overrides.findOneAndUpdate;
  const replies: unknown[] = [];
  const writes: Array<{ filter: object; update: object; options?: object }> = [];
  const seeded: string[][] = [];
  const removed: string[] = [];
  const invalidated: string[] = [];
  const manualShows: string[] = [];
  const manualDeliveries: number[] = [];
  const manualBypassOutbox: boolean[] = [];
  const manualClaimed: boolean[] = [];
  let cleared = 0;
  const settings = {
    _id: "guild-1",
    youtubeChannels: [],
    youtubeNotificationChannelId: null,
    youtubeNotificationsEnabled: false,
    youtubeFilters: {
      excludeShorts: true,
      excludeLives: true,
      excludePremieres: true,
      minDurationSeconds: 0
    },
    youtubeErrors: [],
    ...settingsOverrides
  };
  const deps = {
    GuildModel: {
      updateOne: async (filter, update, options) => {
        writes.push({ filter, update, options });
        return { matchedCount: 1, modifiedCount: 1 };
      },
      findOneAndUpdate: async (filter, update, options) => {
        writes.push({ filter, update, options });
        if (findOneAndUpdateOverride) return findOneAndUpdateOverride(filter, update, options);
        const stage = (Array.isArray(update) ? update[0] : {}) as { $set?: Record<string, unknown> };
        if (stage.$set && "youtubeChannels" in stage.$set) {
          return { youtubeChannels: settings.youtubeChannels || [] };
        }
        if (stage.$set && "youtubeTitleIncludeWords" in stage.$set) {
          const word = (((((((stage.$set?.youtubeTitleIncludeWords as { $let?: { in?: { $cond?: unknown[] } } })?.$let)?.in)?.$cond)?.[2]) as { $concatArrays?: unknown[] })?.$concatArrays)?.[1] as string[] | undefined;
          const current = (settings as { youtubeTitleIncludeWords?: string[] }).youtubeTitleIncludeWords || [];
          const next = [...current];
          const newWord = word?.[0];
          if (newWord && !next.includes(newWord) && next.length < 10) next.push(newWord);
          return { youtubeTitleIncludeWords: next };
        }
        const literal = (((((((stage.$set?.youtubeChannelRoutes as { $let?: { in?: { $cond?: unknown[] } } })?.$let)?.in)?.$cond)?.[2]) as { $concatArrays?: unknown[] })?.$concatArrays)?.[1] as Array<{ channelId: string; discordChannelIds: string[] }> | undefined;
        const newRoute = literal?.[0];
        const currentRoutes = (settings as { youtubeChannelRoutes?: Array<{ channelId: string; discordChannelIds: string[] }> }).youtubeChannelRoutes || [];
        const routes = currentRoutes.map(route => ({ ...route, discordChannelIds: [...(route.discordChannelIds || [])] }));
        if (newRoute) {
          const existingRoute = routes.find(route => route.channelId === newRoute.channelId);
          const discordId = newRoute.discordChannelIds[0];
          if (existingRoute) {
            if (!existingRoute.discordChannelIds.includes(discordId) && existingRoute.discordChannelIds.length < 5) {
              existingRoute.discordChannelIds.push(discordId);
            }
          } else {
            routes.push(newRoute);
          }
        }
        return { youtubeChannelRoutes: routes };
      }
    },
    getGuildSettings: async () => settings,
    invalidateGuildCache: (guildId: string) => { invalidated.push(guildId); },
    resolveYouTubeChannel: async () => ({
      channelId: "UC1234567890123456789012",
      channelName: "Canal Test",
      channelUrl: "https://www.youtube.com/channel/UC1234567890123456789012"
    }),
    fetchYouTubeFeed: async () => [{
      videoId: "abcdefghijk",
      channelId: "UC1234567890123456789012",
      channelName: "Canal Test",
      title: "Video",
      link: "https://www.youtube.com/watch?v=abcdefghijk",
      publishedAt: "2026-06-24T06:00:00.000Z",
      thumbnail: ""
    }],
    seedSeenVideos: async (_guildId, _channelId, videos) => { seeded.push(videos.map(video => video.videoId)); },
    removeSeenChannel: overrides.removeSeenChannel || (async (_guildId, channelId) => { removed.push(channelId); }),
    clearYouTubeErrors: async () => { cleared++; },
    prepareManualYouTubeVideos: async (_guild, selectedChannelId, force = false) => {
      manualShows.push(selectedChannelId);
      return {
        deliverable: Array.from({ length: preparedCount }, (_unused, index) => ({
          channel: { channelId: `UC${index}`, channelName: "x", channelUrl: "https://www.youtube.com/x", subscribedAt: new Date() },
          video: { videoId: `v${index}`, channelId: `UC${index}`, channelName: "x", title: "t", link: "https://www.youtube.com/watch?v=x", publishedAt: "2026-06-24T06:00:00.000Z", thumbnail: "" },
          metadata: { durationSeconds: 120, isShort: false, isLive: false, isPremiere: false }
        })),
        skipped: skippedCount,
        claimed: !force
      };
    },
    deliverManualYouTubeVideos: async (_client, _guild, batch, bypassOutbox = true) => {
      manualDeliveries.push(batch.items.length);
      manualBypassOutbox.push(bypassOutbox);
      manualClaimed.push(batch.claimed);
      return { videos: batch.items.length, batches: 1, destinations: 1 };
    },
    checkChannelPermissions: overrides.checkChannelPermissions || (async () => ({
      viewChannel: true,
      sendMessages: true,
      embedLinks: true,
      readMessageHistory: true
    })),
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload) => { replies.push(payload); return {}; },
    formatUserError: (_error, fallback) => fallback,
    logger: () => undefined,
    MessageFlags: { Ephemeral: 64 },
    outboxEnabled
  } satisfies HandlerDeps;
  return {
    handler: installYouTube.createYouTubeInteractionHandler(deps),
    replies,
    writes,
    seeded,
    removed,
    invalidated,
    manualShows,
    manualDeliveries,
    manualClaimed,
    manualBypassOutbox,
    getCleared: () => cleared
  };
}
