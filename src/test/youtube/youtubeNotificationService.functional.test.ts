import test from "node:test";
import assert from "node:assert/strict";
import { channel, createYouTubeNotificationService, manualShow, parallelRunConcurrent, sequentialRunConcurrent, video, type ServiceDeps, type YouTubeService } from "../youtubeServiceTestKit.js";

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
    removeRouteForChannelError: async () => ({}),
    youtubeBatchDelayMs: 0,
    now: () => new Date("2026-06-25T06:00:00.000Z"),
    GUILD_PROCESS_CONCURRENCY: 2,
    FETCH_CONCURRENCY: 2
  } satisfies ServiceDeps);
  await service.checkForYouTube({ user: { id: "bot" }, channels: { fetch: async () => null } });
  assert.equal(feedCalls, 1);
  assert.equal(sent.length, 2);
  assert.match(JSON.stringify(sent[0].payload), /Videoclip nou/);
  assert.match(JSON.stringify(sent[0].meta), /youtube/);
});

test("YouTube cron descarca metadata HTML a unui videoclip o singura data per ciclu, chiar daca mai multe servere il urmaresc", async () => {
  let metadataCalls = 0;
  const guilds = ["g1", "g2", "g3"].map(id => ({
    _id: id,
    youtubeChannels: [channel],
    youtubeNotificationChannelId: `discord-${id}`,
    youtubeNotificationsEnabled: true
  }));
  const service = createYouTubeNotificationService({
    GuildModel: { find: () => ({ lean: async () => guilds }) },
    logger: () => undefined,
    runConcurrent: sequentialRunConcurrent,
    fetchYouTubeFeed: async () => [video],
    fetchYouTubeVideoMetadata: async () => {
      metadataCalls++;
      return { durationSeconds: 120, isShort: false, isLive: false, isPremiere: false };
    },
    videoPassesYouTubeFilters: () => true,
    claimVideo: async () => true,
    rollbackVideo: async () => undefined,
    recordChannelSuccess: async () => undefined,
    recordChannelError: async () => undefined,
    disableNotificationsForChannelError: async () => ({}),
    resolveOutboundChannel: async () => ({
      abort: false,
      channel: { id: "discord", send: async () => ({}) }
    }),
    sleepIfPositive: async () => undefined,
    transientErrorMessage: error => String(error),
    removeRouteForChannelError: async () => ({}),
    youtubeBatchDelayMs: 0,
    now: () => new Date("2026-06-25T06:00:00.000Z"),
    GUILD_PROCESS_CONCURRENCY: 3,
    FETCH_CONCURRENCY: 3
  } satisfies ServiceDeps);
  await service.checkForYouTube({ user: { id: "bot" }, channels: { fetch: async () => null } });
  assert.equal(metadataCalls, 1, "acelasi videoId nu mai declanseaza un fetch de metadata per server (cache per ciclu)");
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
          youtubeHasActivated: true,
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
    removeRouteForChannelError: async () => ({}),
    youtubeBatchDelayMs: 0,
    now: () => new Date("2026-06-25T06:00:00.000Z"),
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
    removeRouteForChannelError: async () => ({}),
    youtubeBatchDelayMs: 0,
    now: () => new Date("2026-06-25T06:00:00.000Z"),
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

test("YouTube cron face rollback la un videoclip livrat partial pe rute (A reuseste, B esueaza) ca sa reincerce ruta esuata", async () => {
  const rolledBack: string[] = [];
  const sentTo: string[] = [];
  const service = createYouTubeNotificationService({
    GuildModel: { find: () => ({ lean: async () => [] }) },
    logger: () => undefined,
    runConcurrent: sequentialRunConcurrent,
    fetchYouTubeFeed: async () => [video],
    fetchYouTubeVideoMetadata: async () => ({ durationSeconds: 120, isShort: false, isLive: false, isPremiere: false }),
    videoPassesYouTubeFilters: () => true,
    claimVideo: async () => true,
    rollbackVideo: async (_guildId, _channelId, videoId) => { rolledBack.push(videoId); },
    recordChannelSuccess: async () => undefined,
    recordChannelError: async () => undefined,
    disableNotificationsForChannelError: async () => ({}),
    resolveOutboundChannel: async (options) => ({
      abort: false,
      channel: {
        id: String(options.channelId),
        send: async () => {
          if (options.channelId === "discord-B") throw new Error("rate limited");
          sentTo.push(String(options.channelId));
          return {};
        }
      }
    }),
    sleepIfPositive: async () => undefined,
    transientErrorMessage: error => String(error),
    removeRouteForChannelError: async () => ({}),
    youtubeBatchDelayMs: 0,
    now: () => new Date("2026-06-25T06:00:00.000Z"),
    GUILD_PROCESS_CONCURRENCY: 1,
    FETCH_CONCURRENCY: 1
  } satisfies ServiceDeps);
  await service.processGuild(
    { user: { id: "bot" }, channels: { fetch: async () => null } },
    {
      _id: "g1",
      youtubeChannels: [channel],
      youtubeNotificationsEnabled: true,
      youtubeNotificationChannelId: "discord-main",
      youtubeChannelRoutes: [{ channelId: channel.channelId, discordChannelIds: ["discord-A", "discord-B"] }]
    },
    new Map([[channel.channelId, { videos: [video], error: "" }]]),
    () => false
  );
  assert.deepEqual(sentTo, ["discord-A"], "ruta A a primit livrarea");
  assert.deepEqual(rolledBack, [video.videoId], "videoclipul livrat doar partial (A da, B nu) e rollback-uit ca sa reincerce ruta B");
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
    removeRouteForChannelError: async () => ({}),
    youtubeBatchDelayMs: 0,
    now: () => new Date("2026-06-25T06:00:00.000Z"),
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
  assert.ok(sentCounts.every(count => count <= 5));
});

test("YouTube cron pastreaza videoclipurile recente nevazute pana la prima activare", async () => {
  let claims = 0;
  const service = createYouTubeNotificationService({
    GuildModel: {
      find: () => ({
        lean: async () => [{
          _id: "g1",
          youtubeChannels: [channel],
          youtubeNotificationsEnabled: false,
          youtubeHasActivated: false,
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
    removeRouteForChannelError: async () => ({}),
    resolveOutboundChannel: async () => ({ abort: true, channel: null }),
    sleepIfPositive: async () => undefined,
    transientErrorMessage: error => String(error),
    GUILD_PROCESS_CONCURRENCY: 1,
    FETCH_CONCURRENCY: 1,
    youtubeBatchDelayMs: 0,
    now: () => new Date("2026-06-25T06:00:00.000Z")
  } satisfies ServiceDeps);
  await service.checkForYouTube({ user: { id: "bot" }, channels: { fetch: async () => null } });
  assert.equal(claims, 0);
});

test("YouTube cron foloseste exclusiv rutele speciale si sablonul personalizat", async () => {
  const destinations: string[] = [];
  const payloads: unknown[] = [];
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
    rollbackVideo: async () => undefined,
    recordChannelSuccess: async () => undefined,
    recordChannelError: async () => undefined,
    disableNotificationsForChannelError: async () => ({}),
    removeRouteForChannelError: async () => ({}),
    resolveOutboundChannel: async args => {
      destinations.push(String(args.channelId));
      return {
        abort: false,
        channel: {
          id: String(args.channelId),
          send: async payload => { payloads.push(payload); return {}; }
        }
      };
    },
    sleepIfPositive: async () => undefined,
    transientErrorMessage: error => String(error),
    GUILD_PROCESS_CONCURRENCY: 1,
    FETCH_CONCURRENCY: 1,
    youtubeBatchDelayMs: 0,
    now: () => new Date("2026-06-25T06:00:00.000Z")
  } satisfies ServiceDeps);
  await service.processGuild(
    { user: { id: "bot" }, channels: { fetch: async () => null } },
    {
      _id: "g1",
      youtubeChannels: [channel],
      youtubeNotificationChannelId: "main",
      youtubeNotificationsEnabled: true,
      youtubeMessageTemplate: "{channel} | {title} | {url}",
      youtubeChannelRoutes: [{
        channelId: channel.channelId,
        discordChannelIds: ["route-1", "route-2"]
      }]
    },
    new Map([[channel.channelId, { videos: [video], error: "" }]]),
    () => false
  );
  assert.deepEqual(destinations, ["route-1", "route-2"]);
  assert.equal(payloads.length, 2);
  assert.match(JSON.stringify(payloads[0]), /Canal Test \| Videoclip nou/);
  assert.match(JSON.stringify(payloads[0]), /"parse":\[\]/);
});

test("YouTube cron aplica filtrul inclusiv de titlu", async () => {
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
    rollbackVideo: async () => undefined,
    recordChannelSuccess: async () => undefined,
    recordChannelError: async () => undefined,
    disableNotificationsForChannelError: async () => ({}),
    removeRouteForChannelError: async () => ({}),
    resolveOutboundChannel: async () => ({
      abort: false,
      channel: { id: "main", send: async () => { sends++; return {}; } }
    }),
    sleepIfPositive: async () => undefined,
    transientErrorMessage: error => String(error),
    GUILD_PROCESS_CONCURRENCY: 1,
    FETCH_CONCURRENCY: 1,
    youtubeBatchDelayMs: 0,
    now: () => new Date("2026-06-25T06:00:00.000Z")
  } satisfies ServiceDeps);
  await service.processGuild(
    { user: { id: "bot" }, channels: { fetch: async () => null } },
    {
      _id: "g1",
      youtubeChannels: [channel],
      youtubeNotificationChannelId: "main",
      youtubeNotificationsEnabled: true,
      youtubeTitleIncludeWords: ["patch notes"]
    },
    new Map([[channel.channelId, { videos: [video], error: "" }]]),
    () => false
  );
  assert.equal(sends, 0);
});

test("YouTube cron: NU revendica si NU descarca metadata pentru un canal recent fara destinatie (verificarea destinatiei e inainte de claim/prepare, R20 #1)", async () => {
  let metadataCalls = 0;
  let claimCalls = 0;
  let rollbacks = 0;
  let sends = 0;
  const service = createYouTubeNotificationService({
    GuildModel: { find: () => ({ lean: async () => [] }) },
    logger: () => undefined,
    runConcurrent: sequentialRunConcurrent,
    fetchYouTubeFeed: async () => [video],
    fetchYouTubeVideoMetadata: async () => { metadataCalls++; return { durationSeconds: 120, isShort: false, isLive: false, isPremiere: false }; },
    videoPassesYouTubeFilters: () => true,
    claimVideo: async () => { claimCalls++; return true; },
    rollbackVideo: async () => { rollbacks++; },
    recordChannelSuccess: async () => undefined,
    recordChannelError: async () => undefined,
    disableNotificationsForChannelError: async () => ({}),
    removeRouteForChannelError: async () => ({}),
    resolveOutboundChannel: async () => ({ abort: false, channel: { id: "x", send: async () => { sends++; return {}; } } }),
    sleepIfPositive: async () => undefined,
    transientErrorMessage: error => String(error),
    GUILD_PROCESS_CONCURRENCY: 1,
    FETCH_CONCURRENCY: 1,
    youtubeBatchDelayMs: 0,
    now: () => new Date("2026-06-25T06:00:00.000Z")
  } satisfies ServiceDeps);

  await service.processGuild(
    { user: { id: "bot" }, channels: { fetch: async () => null } },
    {
      _id: "g1",
      youtubeChannels: [channel],
      youtubeNotificationsEnabled: true,
      youtubeNotificationChannelId: null,
      youtubeChannelRoutes: []
    },
    new Map([[channel.channelId, { videos: [video], error: "" }]]),
    () => false
  );

  assert.equal(metadataCalls, 0, "niciun fetch de metadata pentru un canal fara destinatie");
  assert.equal(claimCalls, 0, "videoclipul recent nu mai e revendicat-apoi-rollback-uit cand nu exista destinatie");
  assert.equal(rollbacks, 0, "nimic de anulat: nu s-a revendicat nimic");
  assert.equal(sends, 0, "nicio livrare");
});
