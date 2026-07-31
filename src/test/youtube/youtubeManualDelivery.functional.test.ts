import test from "node:test";
import assert from "node:assert/strict";
import { channel, createYouTubeNotificationService, manualShow, parallelRunConcurrent, sequentialRunConcurrent, video, type ServiceDeps, type YouTubeService } from "../youtubeServiceTestKit.js";

test("YouTube manual: a doua rulare implicita NU repostează videoclipul deja afisat; repeta=true repostează (R14 #1)", async () => {
  const claims = new Set<string>();
  const guild = { _id: "g1", youtubeChannels: [channel], youtubeNotificationChannelId: "discord-main" };
  const service = createYouTubeNotificationService({
    listActiveGuilds: async () => [],
    logger: () => undefined,
    runConcurrent: sequentialRunConcurrent,
    fetchYouTubeFeed: async () => [video],
    fetchYouTubeVideoMetadata: async () => ({ durationSeconds: 120, isShort: false, isLive: false, isPremiere: false }),
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
    removeRouteForChannelError: async () => ({}),
    resolveOutboundChannel: async () => ({ abort: false, channel: { id: "discord-main", send: async () => ({}) } }),
    sleepIfPositive: async () => undefined,
    transientErrorMessage: error => String(error),
    GUILD_PROCESS_CONCURRENCY: 1,
    FETCH_CONCURRENCY: 1,
    youtubeBatchDelayMs: 0,
    now: () => new Date("2026-06-25T06:00:00.000Z")
  } satisfies ServiceDeps);

  const first = await service.prepareManualVideos(guild, "toate");
  assert.equal(first.deliverable.length, 1, "prima rulare pregateste si claim-uieste videoclipul recent");
  assert.equal(first.claimed, true, "implicit (fara force) videoclipurile sunt claim-uite");
  const second = await service.prepareManualVideos(guild, "toate");
  assert.equal(second.deliverable.length, 0, "a doua rulare implicita nu mai pregateste nimic (deja claim-uit) -> fara duplicate");
  const forced = await service.prepareManualVideos(guild, "toate", true);
  assert.equal(forced.deliverable.length, 1, "repeta=true ignora claim-ul si repostează videoclipul");
  assert.equal(forced.claimed, false, "cu force, videoclipurile NU sunt claim-uite (deci deliverManualVideos nu face rollback)");
});

test("YouTube prepareManualVideos: NU descarca metadata pentru canale fara destinatie (verificarea destinatiei e inainte de prepare/metadata, R19 #1)", async () => {
  let metadataCalls = 0;
  const guild = { _id: "g1", youtubeChannels: [channel], youtubeNotificationChannelId: null, youtubeChannelRoutes: [] };
  const service = createYouTubeNotificationService({
    listActiveGuilds: async () => [],
    logger: () => undefined,
    runConcurrent: sequentialRunConcurrent,
    fetchYouTubeFeed: async () => [video],
    fetchYouTubeVideoMetadata: async () => { metadataCalls++; return { durationSeconds: 120, isShort: false, isLive: false, isPremiere: false }; },
    videoPassesYouTubeFilters: () => true,
    claimVideo: async () => true,
    rollbackVideo: async () => undefined,
    recordChannelSuccess: async () => undefined,
    recordChannelError: async () => undefined,
    disableNotificationsForChannelError: async () => ({}),
    removeRouteForChannelError: async () => ({}),
    resolveOutboundChannel: async () => ({ abort: false, channel: { id: "x", send: async () => ({}) } }),
    sleepIfPositive: async () => undefined,
    transientErrorMessage: error => String(error),
    GUILD_PROCESS_CONCURRENCY: 1,
    FETCH_CONCURRENCY: 1,
    youtubeBatchDelayMs: 0,
    now: () => new Date("2026-06-25T06:00:00.000Z")
  } satisfies ServiceDeps);

  const result = await service.prepareManualVideos(guild, "toate");
  assert.equal(metadataCalls, 0, "niciun fetch de metadata pentru un canal fara destinatie (verificarea destinatiei ruleaza inainte de prepareVideo, nu dupa)");
  assert.equal(result.deliverable.length, 0, "nimic livrabil fara destinatie");
  assert.equal(result.skipped, 1, "videoclipul recent de pe canalul fara destinatie e numarat ca sarit");
});

test("YouTube manual afiseaza numai ultima luna si claim-uieste implicit videoclipurile cu destinatie (dedup pe re-rulare, R14 #1)", async () => {
  let claims = 0;
  const sentTitles: string[] = [];
  const oldVideo = {
    ...video,
    videoId: "oldoldold01",
    title: "Videoclip vechi",
    publishedAt: "2026-04-01T06:00:00.000Z"
  };
  const service = createYouTubeNotificationService({
    listActiveGuilds: async () => [],
    logger: () => undefined,
    runConcurrent: sequentialRunConcurrent,
    fetchYouTubeFeed: async () => [oldVideo, video],
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
    resolveOutboundChannel: async args => {
      assert.equal(args.bypassOutbox, true);
      return {
        abort: false,
        channel: {
          id: "main",
          send: async payload => {
            const embeds = (payload as { embeds?: Array<{ title?: string }> }).embeds || [];
            sentTitles.push(...embeds.map(embed => String(embed.title || "")));
            return {};
          }
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
  const result = await manualShow(service,
    { user: { id: "bot" }, channels: { fetch: async () => null } },
    {
      _id: "g1",
      youtubeChannels: [channel],
      youtubeNotificationChannelId: "main"
    },
    "toate"
  );
  assert.equal(claims, 1, "videoclipul recent cu destinatie e claim-uit (ca a doua rulare sa nu-l reposteze); cel vechi e filtrat dupa recenta inainte de claim");
  assert.deepEqual(sentTitles, ["Videoclip nou"]);
  assert.equal(result.videos, 1);
});

test("YouTube manual (prepareManualVideos + deliverManualVideos): la esec de livrare face rollback la claim, ca videoclipul sa poata fi reincercat (R16 #1)", async () => {
  const claims = new Set<string>();
  const rolledBack: string[] = [];
  const service = createYouTubeNotificationService({
    listActiveGuilds: async () => [],
    logger: () => undefined,
    runConcurrent: sequentialRunConcurrent,
    fetchYouTubeFeed: async () => [video],
    fetchYouTubeVideoMetadata: async () => ({ durationSeconds: 120, isShort: false, isLive: false, isPremiere: false }),
    videoPassesYouTubeFilters: () => true,
    claimVideo: async (guildId, _channelId, videoId) => {
      const key = `${guildId}:${videoId}`;
      if (claims.has(key)) return false;
      claims.add(key);
      return true;
    },
    rollbackVideo: async (guildId, _channelId, videoId) => { rolledBack.push(`${guildId}:${videoId}`); },
    recordChannelSuccess: async () => undefined,
    recordChannelError: async () => undefined,
    disableNotificationsForChannelError: async () => ({}),
    removeRouteForChannelError: async () => ({}),
    resolveOutboundChannel: async () => ({
      abort: false,
      channel: { id: "main", send: async () => { throw new Error("Discord send esuat"); } }
    }),
    sleepIfPositive: async () => undefined,
    transientErrorMessage: error => String(error),
    GUILD_PROCESS_CONCURRENCY: 1,
    FETCH_CONCURRENCY: 1,
    youtubeBatchDelayMs: 0,
    now: () => new Date("2026-06-25T06:00:00.000Z")
  } satisfies ServiceDeps);

  const result = await manualShow(service,
    { user: { id: "bot" }, channels: { fetch: async () => null } },
    { _id: "g1", youtubeChannels: [channel], youtubeNotificationChannelId: "main" },
    "toate"
  );
  assert.equal(result.videos, 0, "nimic livrat fiindca send-ul a esuat");
  assert.deepEqual(rolledBack, [`g1:${video.videoId}`], "videoclipul claim-uit dar nelivrat e rollback-uit (claimed=true), ca o re-rulare normala sa-l poata reposta");
});

test("YouTube manual (videos show) refoloseste cache-ul de metadata per apel: acelasi videoId pe doua canale -> 1 fetch", async () => {
  let metadataCalls = 0;
  const channelA = { ...channel, channelId: "UCAAAAAAAAAAAAAAAAAAAAA" };
  const channelB = { ...channel, channelId: "UCBBBBBBBBBBBBBBBBBBBBB" };
  const service = createYouTubeNotificationService({
    listActiveGuilds: async () => [],
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
    removeRouteForChannelError: async () => ({}),
    resolveOutboundChannel: async () => ({ abort: false, channel: { id: "main", send: async () => ({}) } }),
    sleepIfPositive: async () => undefined,
    transientErrorMessage: error => String(error),
    GUILD_PROCESS_CONCURRENCY: 1,
    FETCH_CONCURRENCY: 1,
    youtubeBatchDelayMs: 0,
    now: () => new Date("2026-06-25T06:00:00.000Z")
  } satisfies ServiceDeps);
  await manualShow(service,
    { user: { id: "bot" }, channels: { fetch: async () => null } },
    { _id: "g1", youtubeChannels: [channelA, channelB], youtubeNotificationChannelId: "main" },
    "toate"
  );
  assert.equal(metadataCalls, 1, "metadata pentru acelasi videoId se descarca o singura data in manual show (cache per apel)");
});

test("YouTube manual descarca feed-urile in paralel dar pastreaza ordinea canalelor la livrare", async () => {
  const channelA = { ...channel, channelId: "UCAAAAAAAAAAAAAAAAAAAAA" };
  const channelB = { ...channel, channelId: "UCBBBBBBBBBBBBBBBBBBBBB" };
  const videoA = { ...video, videoId: "aaaaaaaaaaa", channelId: channelA.channelId, title: "Video A" };
  const videoB = { ...video, videoId: "bbbbbbbbbbb", channelId: channelB.channelId, title: "Video B" };
  const sentTitles: string[] = [];
  const service = createYouTubeNotificationService({
    listActiveGuilds: async () => [],
    logger: () => undefined,
    runConcurrent: parallelRunConcurrent,
    fetchYouTubeFeed: async channel => {
      if (channel.channelId === channelA.channelId) {
        await new Promise(resolve => setTimeout(resolve, 15));
        return [videoA];
      }
      return [videoB];
    },
    fetchYouTubeVideoMetadata: async () => ({ durationSeconds: 120, isShort: false, isLive: false, isPremiere: false }),
    videoPassesYouTubeFilters: () => true,
    claimVideo: async () => true,
    rollbackVideo: async () => undefined,
    recordChannelSuccess: async () => undefined,
    recordChannelError: async () => undefined,
    disableNotificationsForChannelError: async () => ({}),
    removeRouteForChannelError: async () => ({}),
    resolveOutboundChannel: async () => ({
      abort: false,
      channel: {
        id: "main",
        send: async payload => {
          const embeds = (payload as { embeds?: Array<{ title?: string }> }).embeds || [];
          sentTitles.push(...embeds.map(embed => String(embed.title || "")));
          return {};
        }
      }
    }),
    sleepIfPositive: async () => undefined,
    transientErrorMessage: error => String(error),
    GUILD_PROCESS_CONCURRENCY: 1,
    FETCH_CONCURRENCY: 4,
    youtubeBatchDelayMs: 0,
    now: () => new Date("2026-06-25T06:00:00.000Z")
  } satisfies ServiceDeps);
  await manualShow(service,
    { user: { id: "bot" }, channels: { fetch: async () => null } },
    { _id: "g1", youtubeChannels: [channelA, channelB], youtubeNotificationChannelId: "main" },
    "toate"
  );
  assert.deepEqual(sentTitles, ["Video A", "Video B"], "ordinea canalelor (A, B) e pastrata desi feed-ul A se rezolva dupa B (fetch paralel)");
});

test("YouTube manual prin outbox (bypassOutbox=false): enqueue TOATE loturile imediat, fara sleep, cu availableAt decalat per lot (durabil la restart, 16 clipuri -> 4 loturi)", async () => {
  const now = new Date("2026-06-25T06:00:00.000Z");
  const batchDelayMs = 600000;
  const enqueuedAvailableAt: Array<number | undefined> = [];
  let sleepCalls = 0;
  const prepared = Array.from({ length: 16 }, (_value, index) => ({
    channel,
    video: { ...video, videoId: `vid${String(index).padStart(8, "0")}` },
    metadata: { durationSeconds: 120, isShort: false, isLive: false, isPremiere: false }
  }));
  const service = createYouTubeNotificationService({
    listActiveGuilds: async () => [],
    logger: () => undefined,
    runConcurrent: sequentialRunConcurrent,
    fetchYouTubeFeed: async () => [],
    fetchYouTubeVideoMetadata: async () => ({ durationSeconds: 120, isShort: false, isLive: false, isPremiere: false }),
    videoPassesYouTubeFilters: () => true,
    claimVideo: async () => true,
    rollbackVideo: async () => undefined,
    recordChannelSuccess: async () => undefined,
    recordChannelError: async () => undefined,
    disableNotificationsForChannelError: async () => ({}),
    removeRouteForChannelError: async () => ({}),
    resolveOutboundChannel: async () => ({
      abort: false,
      channel: {
        id: "main",
        send: async (_payload, meta) => {
          enqueuedAvailableAt.push((meta as { availableAt?: Date } | undefined)?.availableAt?.getTime());
          return {};
        }
      }
    }),
    sleepIfPositive: async () => { sleepCalls++; },
    transientErrorMessage: error => String(error),
    GUILD_PROCESS_CONCURRENCY: 1,
    FETCH_CONCURRENCY: 1,
    youtubeBatchDelayMs: batchDelayMs,
    now: () => now
  } satisfies ServiceDeps);
  await service.deliverManualVideos(
    { user: { id: "bot" }, channels: { fetch: async () => null } },
    { _id: "g1", youtubeChannels: [channel], youtubeNotificationChannelId: "main" },
    { items: prepared, claimed: false },
    false
  );
  assert.equal(enqueuedAvailableAt.length, 4, "16 videoclipuri -> 4 loturi (5/5/5/1), toate enqueue-uite imediat");
  assert.equal(sleepCalls, 0, "calea outbox NU doarme intre loturi (drain-ul pace-uieste prin availableAt); un restart nu mai pierde loturile neenqueue-uite");
  assert.deepEqual(enqueuedAvailableAt, [0, 1, 2, 3].map(i => now.getTime() + i * batchDelayMs), "fiecare lot are availableAt decalat cu batchDelayMs, ca drain-ul sa-l livreze esalonat");
});

test("YouTube livreaza cel mult 5 videoclipuri per lot si asteapta numai intre loturi", async () => {
  const counts: number[] = [];
  const waits: number[] = [];
  const videos = Array.from({ length: 11 }, (_, index) => ({
    ...video,
    videoId: `${String(index).padStart(10, "0")}x`,
    title: `Videoclip ${index}`
  }));
  const service = createYouTubeNotificationService({
    listActiveGuilds: async () => [],
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
    removeRouteForChannelError: async () => ({}),
    resolveOutboundChannel: async () => ({
      abort: false,
      channel: {
        id: "main",
        send: async payload => {
          counts.push(((payload as { embeds?: object[] }).embeds || []).length);
          return {};
        }
      }
    }),
    sleepIfPositive: async ms => { waits.push(ms); },
    transientErrorMessage: error => String(error),
    GUILD_PROCESS_CONCURRENCY: 1,
    FETCH_CONCURRENCY: 1,
    youtubeBatchDelayMs: 600000,
    now: () => new Date("2026-06-25T06:00:00.000Z")
  } satisfies ServiceDeps);
  await service.processGuild(
    { user: { id: "bot" }, channels: { fetch: async () => null } },
    {
      _id: "g1",
      youtubeChannels: [channel],
      youtubeNotificationChannelId: "main",
      youtubeNotificationsEnabled: true
    },
    new Map([[channel.channelId, { videos, error: "" }]]),
    () => false
  );
  assert.deepEqual(counts, [5, 5, 1]);
  assert.deepEqual(waits, [600000, 600000]);
});

test("YouTube deliverManualVideos: un item fara destinatie NU e marcat ca livrat (deliverPrepared refuza intern) si claim-ul e anulat (R20 #3)", async () => {
  let rollbackId = "";
  const service = createYouTubeNotificationService({
    listActiveGuilds: async () => [],
    logger: () => undefined,
    runConcurrent: sequentialRunConcurrent,
    fetchYouTubeFeed: async () => [],
    fetchYouTubeVideoMetadata: async () => ({ durationSeconds: 120, isShort: false, isLive: false, isPremiere: false }),
    videoPassesYouTubeFilters: () => true,
    claimVideo: async () => true,
    rollbackVideo: async (_guildId, _channelId, videoId) => { rollbackId = videoId; },
    recordChannelSuccess: async () => undefined,
    recordChannelError: async () => undefined,
    disableNotificationsForChannelError: async () => ({}),
    removeRouteForChannelError: async () => ({}),
    resolveOutboundChannel: async () => ({ abort: false, channel: { id: "x", send: async () => ({}) } }),
    sleepIfPositive: async () => undefined,
    transientErrorMessage: error => String(error),
    GUILD_PROCESS_CONCURRENCY: 1,
    FETCH_CONCURRENCY: 1,
    youtubeBatchDelayMs: 0,
    now: () => new Date("2026-06-25T06:00:00.000Z")
  } satisfies ServiceDeps);

  const guild = { _id: "g1", youtubeChannels: [channel], youtubeNotificationChannelId: null, youtubeChannelRoutes: [] };
  const item = { channel, video, metadata: { durationSeconds: 120, isShort: false, isLive: false, isPremiere: false } };
  const result = await service.deliverManualVideos(
    { user: { id: "bot" }, channels: { fetch: async () => null } },
    guild,
    { items: [item], claimed: true },
    true
  );

  assert.equal(result.videos, 0, "un item fara destinatie nu e numarat ca livrat (totalDestinations === 0 nu mai inseamna succes)");
  assert.equal(rollbackId, video.videoId, "claim-ul item-ului fara destinatie e anulat (rollback), nu lasat marcat ca vazut");
});

test("YouTube deliverManualVideos: cand rollback-ul claim-ului arunca, esecul e raportat (admin alert), nu inghitit (R21 #3)", async () => {
  const reported: Array<{ kind: string; itemId: string; guildId: string }> = [];
  const service = createYouTubeNotificationService({
    listActiveGuilds: async () => [],
    logger: () => undefined,
    runConcurrent: sequentialRunConcurrent,
    fetchYouTubeFeed: async () => [],
    fetchYouTubeVideoMetadata: async () => ({ durationSeconds: 120, isShort: false, isLive: false, isPremiere: false }),
    videoPassesYouTubeFilters: () => true,
    claimVideo: async () => true,
    rollbackVideo: async () => { throw new Error("mongo down"); },
    recordChannelSuccess: async () => undefined,
    recordChannelError: async () => undefined,
    disableNotificationsForChannelError: async () => ({}),
    removeRouteForChannelError: async () => ({}),
    resolveOutboundChannel: async () => ({ abort: false, channel: { id: "x", send: async () => ({}) } }),
    sleepIfPositive: async () => undefined,
    transientErrorMessage: error => String(error),
    GUILD_PROCESS_CONCURRENCY: 1,
    FETCH_CONCURRENCY: 1,
    youtubeBatchDelayMs: 0,
    now: () => new Date("2026-06-25T06:00:00.000Z"),
    reportRollbackFailure: context => { reported.push({ kind: context.kind, itemId: context.itemId, guildId: context.guildId }); }
  } satisfies ServiceDeps);

  const guild = { _id: "g1", youtubeChannels: [channel], youtubeNotificationChannelId: null, youtubeChannelRoutes: [] };
  const item = { channel, video, metadata: { durationSeconds: 120, isShort: false, isLive: false, isPremiere: false } };
  await service.deliverManualVideos(
    { user: { id: "bot" }, channels: { fetch: async () => null } },
    guild,
    { items: [item], claimed: true },
    true
  );

  assert.deepEqual(reported, [{ kind: "youtube", itemId: video.videoId, guildId: "g1" }], "esecul de rollback al claim-ului devine vizibil operational");
});

test("YouTube manual: un videoclip cu metadata defecta nu pica tot batch-ul (R[Medium] #1)", async () => {
  const errors: string[] = [];
  const badVideo = { ...video, videoId: "badbadbad11", link: "https://www.youtube.com/watch?v=badbadbad11" };
  const goodVideo = { ...video, videoId: "goodgood111", link: "https://www.youtube.com/watch?v=goodgood111" };
  const service = createYouTubeNotificationService({
    listActiveGuilds: async () => [],
    logger: () => undefined,
    runConcurrent: sequentialRunConcurrent,
    fetchYouTubeFeed: async () => [badVideo, goodVideo],
    fetchYouTubeVideoMetadata: async (vid) => {
      if (vid.videoId === "badbadbad11") throw new Error("metadata HTML invalid");
      return { durationSeconds: 120, isShort: false, isLive: false, isPremiere: false };
    },
    videoPassesYouTubeFilters: () => true,
    claimVideo: async () => true,
    rollbackVideo: async () => undefined,
    recordChannelSuccess: async () => undefined,
    recordChannelError: async (_guildId, _channel, message) => { errors.push(message); },
    disableNotificationsForChannelError: async () => ({}),
    resolveOutboundChannel: async () => ({ abort: false, channel: { id: "discord", send: async () => ({}) } }),
    sleepIfPositive: async () => undefined,
    transientErrorMessage: error => String(error),
    removeRouteForChannelError: async () => ({}),
    youtubeBatchDelayMs: 0,
    now: () => new Date("2026-06-25T06:00:00.000Z"),
    GUILD_PROCESS_CONCURRENCY: 1,
    FETCH_CONCURRENCY: 1
  } satisfies ServiceDeps);
  const prepared = await service.prepareManualVideos({
    _id: "g1",
    youtubeChannels: [channel],
    youtubeNotificationsEnabled: true,
    youtubeNotificationChannelId: "discord"
  }, "toate");
  assert.equal(prepared.deliverable.length, 1, "al doilea video e pregatit chiar daca primul a aruncat la metadata");
  assert.equal(prepared.deliverable[0].video.videoId, "goodgood111");
  assert.equal(errors.length, 1, "eroarea de metadata e inregistrata (recordChannelError), nu propagata ca sa avorteze batch-ul");
});
