import test from "node:test";
import assert from "node:assert/strict";

const { createYouTubeRepository } = require("../features/youtube/youtubeRepository") as typeof import("../features/youtube/youtubeRepository");
type RepositoryDeps = Parameters<typeof createYouTubeRepository>[0];

test("YouTube repository face baseline prin bulk upsert si claim atomic", async () => {
  const bulkOperations: object[][] = [];
  const created = new Set<string>();
  const repository = createYouTubeRepository({
    GuildModel: { updateOne: async () => ({ modifiedCount: 1 }) },
    GuildSeenYoutubeModel: {
      create: async doc => {
        const videoId = String((doc as { videoId?: string }).videoId || "");
        if (created.has(videoId)) throw Object.assign(new Error("duplicate"), { code: 11000 });
        created.add(videoId);
        return {};
      },
      bulkWrite: async operations => { bulkOperations.push(operations); return {}; },
      deleteOne: async () => ({}),
      deleteMany: async () => ({})
    },
    withMongoRetry: async fn => fn(),
    invalidateGuildCache: () => undefined,
    adminAlert: async () => undefined,
    logger: () => undefined
  } satisfies RepositoryDeps);
  const video = {
    videoId: "abcdefghijk",
    channelId: "UC1234567890123456789012",
    channelName: "Canal",
    title: "Video",
    link: "https://www.youtube.com/watch?v=abcdefghijk",
    publishedAt: "",
    thumbnail: ""
  };
  await repository.seedSeenVideos("g1", video.channelId, [video, video]);
  assert.equal(bulkOperations.length, 1);
  assert.equal(bulkOperations[0].length, 1);
  assert.equal(await repository.claimVideo("g1", video.channelId, video.videoId), true);
  assert.equal(await repository.claimVideo("g1", video.channelId, video.videoId), false);
});

test("YouTube repository limiteaza erorile si dezactiveaza canalul Discord permanent invalid", async () => {
  const writes: Array<{ filter: object; update: object; options?: object }> = [];
  const alerts: string[] = [];
  const repository = createYouTubeRepository({
    GuildModel: {
      updateOne: async (filter, update, options) => {
        writes.push({ filter, update, options });
        return { modifiedCount: 1 };
      }
    },
    GuildSeenYoutubeModel: {
      create: async () => ({}),
      bulkWrite: async () => ({}),
      deleteOne: async () => ({}),
      deleteMany: async () => ({})
    },
    withMongoRetry: async fn => fn(),
    invalidateGuildCache: () => undefined,
    adminAlert: async kind => { alerts.push(kind); },
    logger: () => undefined
  } satisfies RepositoryDeps);
  await repository.recordChannelError("g1", {
    channelId: "UC1234567890123456789012",
    channelName: "Canal",
    channelUrl: "https://www.youtube.com/channel/UC1234567890123456789012",
    subscribedAt: new Date()
  }, "feed indisponibil");
  await repository.disableNotificationsForChannelError("g1", "discord-1", "Missing Access");
  assert.equal(writes.length, 2);
  assert.deepEqual(alerts, ["youtube:source", "discord:youtube-channel"]);
  assert.match(JSON.stringify(writes[0].update), /youtubeErrors/);
  assert.match(JSON.stringify(writes[1].update), /youtubeNotificationsEnabled/);
});
