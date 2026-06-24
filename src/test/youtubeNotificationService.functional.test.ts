import test from "node:test";
import assert from "node:assert/strict";

const { createYouTubeNotificationService } = require("../features/youtube/youtubeNotificationService") as typeof import("../features/youtube/youtubeNotificationService");
type ServiceDeps = Parameters<typeof createYouTubeNotificationService>[0];

const channel = {
  channelId: "UC1234567890123456789012",
  channelName: "Canal Test",
  channelUrl: "https://www.youtube.com/channel/UC1234567890123456789012",
  subscribedAt: new Date()
};

const video = {
  videoId: "abcdefghijk",
  channelId: channel.channelId,
  channelName: channel.channelName,
  title: "Videoclip nou",
  link: "https://www.youtube.com/watch?v=abcdefghijk",
  publishedAt: "2026-06-24T06:00:00.000Z",
  thumbnail: "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg"
};

function sequentialRunConcurrent<T>(
  items: T[],
  _concurrency: number,
  fn: (item: T) => Promise<unknown>
): Promise<{ processed: number; errors: Array<{ error: unknown }> }> {
  return (async () => {
    const errors: Array<{ error: unknown }> = [];
    let processed = 0;
    for (const item of items) {
      try {
        await fn(item);
        processed++;
      } catch (error) {
        errors.push({ error });
      }
    }
    return { processed, errors };
  })();
}

test("YouTube cron descarca un feed comun o singura data si livreaza per guild cu dedupe", async () => {
  const sent: Array<{ payload: unknown; meta: unknown }> = [];
  const claims = new Set<string>();
  let feedCalls = 0;
  const guilds = ["g1", "g2"].map(id => ({
    _id: id,
    youtubeChannels: [channel],
    youtubeNotificationChannelId: `discord-${id}`,
    youtubeNotificationsEnabled: true,
    youtubeFilters: {
      excludeShorts: true,
      excludeLives: true,
      excludePremieres: true,
      minDurationSeconds: 61
    }
  }));
  const service = createYouTubeNotificationService({
    GuildModel: { find: () => ({ lean: async () => guilds }) },
    logger: () => undefined,
    runConcurrent: sequentialRunConcurrent,
    fetchYouTubeFeed: async () => { feedCalls++; return [video]; },
    fetchYouTubeVideoMetadata: async () => ({
      durationSeconds: 120,
      isShort: false,
      isLive: false,
      isPremiere: false
    }),
    videoPassesYouTubeFilters: () => true,
    claimVideo: async (guildId, _channelId, videoId) => {
      const key = `${guildId}:${videoId}`;
      if (claims.has(key)) return false;
      claims.add(key);
      return true;
    },
    rollbackVideo: async () => undefined,
    recordChannelSuccess: async () => undefined,
    recordChannelError: async () => undefined,
    disableNotificationsForChannelError: async () => ({}),
    resolveOutboundChannel: async () => ({
      abort: false,
      channel: {
        id: "discord",
        send: async (payload, meta) => { sent.push({ payload, meta }); return {}; }
      }
    }),
    sleepIfPositive: async () => undefined,
    transientErrorMessage: error => String(error),
    DISCORD_SEND_DELAY_MS: 0,
    GUILD_PROCESS_CONCURRENCY: 2,
    FETCH_CONCURRENCY: 2
  } satisfies ServiceDeps);
  await service.checkForYouTube({ user: { id: "bot" }, channels: { fetch: async () => null } });
  assert.equal(feedCalls, 1);
  assert.equal(sent.length, 2);
  assert.match(JSON.stringify(sent[0].payload), /Videoclip nou/);
  assert.match(JSON.stringify(sent[0].meta), /youtube/);
});

test("YouTube cron marcheaza videoclipurile vazute fara livrare cand notificarile sunt oprite", async () => {
  let claims = 0;
  let resolves = 0;
  const service = createYouTubeNotificationService({
    GuildModel: {
      find: () => ({
        lean: async () => [{
          _id: "g1",
          youtubeChannels: [channel],
          youtubeNotificationsEnabled: false,
          youtubeNotificationChannelId: null
        }]
      })
    },
    logger: () => undefined,
    runConcurrent: sequentialRunConcurrent,
    fetchYouTubeFeed: async () => [video],
    fetchYouTubeVideoMetadata: async () => ({
      durationSeconds: 120,
      isShort: false,
      isLive: false,
      isPremiere: false
    }),
    videoPassesYouTubeFilters: () => true,
    claimVideo: async () => { claims++; return true; },
    rollbackVideo: async () => undefined,
    recordChannelSuccess: async () => undefined,
    recordChannelError: async () => undefined,
    disableNotificationsForChannelError: async () => ({}),
    resolveOutboundChannel: async () => { resolves++; return { abort: true, channel: null }; },
    sleepIfPositive: async () => undefined,
    transientErrorMessage: error => String(error),
    DISCORD_SEND_DELAY_MS: 0,
    GUILD_PROCESS_CONCURRENCY: 1,
    FETCH_CONCURRENCY: 1
  } satisfies ServiceDeps);
  await service.checkForYouTube({ user: { id: "bot" }, channels: { fetch: async () => null } });
  assert.equal(claims, 1);
  assert.equal(resolves, 0);
});

test("YouTube cron face rollback daca pierde lock-ul dupa claim si inainte de livrare", async () => {
  const rolledBack: string[] = [];
  let abortChecks = 0;
  let sends = 0;
  const service = createYouTubeNotificationService({
    GuildModel: { find: () => ({ lean: async () => [] }) },
    logger: () => undefined,
    runConcurrent: sequentialRunConcurrent,
    fetchYouTubeFeed: async () => [video],
    fetchYouTubeVideoMetadata: async () => ({
      durationSeconds: 120,
      isShort: false,
      isLive: false,
      isPremiere: false
    }),
    videoPassesYouTubeFilters: () => true,
    claimVideo: async () => true,
    rollbackVideo: async (_guildId, _channelId, videoId) => { rolledBack.push(videoId); },
    recordChannelSuccess: async () => undefined,
    recordChannelError: async () => undefined,
    disableNotificationsForChannelError: async () => ({}),
    resolveOutboundChannel: async () => ({
      abort: false,
      channel: {
        id: "discord",
        send: async () => { sends++; return {}; }
      }
    }),
    sleepIfPositive: async () => undefined,
    transientErrorMessage: error => String(error),
    DISCORD_SEND_DELAY_MS: 0,
    GUILD_PROCESS_CONCURRENCY: 1,
    FETCH_CONCURRENCY: 1
  } satisfies ServiceDeps);
  await service.processGuild(
    { user: { id: "bot" }, channels: { fetch: async () => null } },
    {
      _id: "g1",
      youtubeChannels: [channel],
      youtubeNotificationsEnabled: true,
      youtubeNotificationChannelId: "discord"
    },
    new Map([[channel.channelId, { videos: [video], error: "" }]]),
    () => ++abortChecks >= 3
  );
  assert.deepEqual(rolledBack, [video.videoId]);
  assert.equal(sends, 0);
});

test("YouTube cron imparte embed-urile si dupa bugetul Discord de caractere", async () => {
  const sentCounts: number[] = [];
  const oversizedChannel = {
    ...channel,
    channelName: "C".repeat(300),
    channelUrl: `https://www.youtube.com/channel/${"x".repeat(300)}`
  };
  const videos = Array.from({ length: 10 }, (_, index) => ({
    ...video,
    videoId: `${String(index).padStart(10, "0")}x`,
    title: `Videoclip ${index} ${"T".repeat(230)}`
  }));
  const service = createYouTubeNotificationService({
    GuildModel: { find: () => ({ lean: async () => [] }) },
    logger: () => undefined,
    runConcurrent: sequentialRunConcurrent,
    fetchYouTubeFeed: async () => videos,
    fetchYouTubeVideoMetadata: async () => ({
      durationSeconds: 120,
      isShort: false,
      isLive: false,
      isPremiere: false
    }),
    videoPassesYouTubeFilters: () => true,
    claimVideo: async () => true,
    rollbackVideo: async () => undefined,
    recordChannelSuccess: async () => undefined,
    recordChannelError: async () => undefined,
    disableNotificationsForChannelError: async () => ({}),
    resolveOutboundChannel: async () => ({
      abort: false,
      channel: {
        id: "discord",
        send: async payload => {
          const embeds = (payload as { embeds?: object[] }).embeds || [];
          sentCounts.push(embeds.length);
          return {};
        }
      }
    }),
    sleepIfPositive: async () => undefined,
    transientErrorMessage: error => String(error),
    DISCORD_SEND_DELAY_MS: 0,
    GUILD_PROCESS_CONCURRENCY: 1,
    FETCH_CONCURRENCY: 1
  } satisfies ServiceDeps);
  await service.processGuild(
    { user: { id: "bot" }, channels: { fetch: async () => null } },
    {
      _id: "g1",
      youtubeChannels: [oversizedChannel],
      youtubeNotificationsEnabled: true,
      youtubeNotificationChannelId: "discord"
    },
    new Map([[oversizedChannel.channelId, { videos, error: "" }]]),
    () => false
  );
  assert.ok(sentCounts.length > 1);
  assert.equal(sentCounts.reduce((sum, count) => sum + count, 0), videos.length);
  assert.ok(sentCounts.every(count => count <= 10));
});
