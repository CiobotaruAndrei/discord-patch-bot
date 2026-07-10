import test from "node:test";
import assert from "node:assert/strict";

const { createYouTubeRepository } = require("../features/youtube/youtubeRepository") as typeof import("../features/youtube/youtubeRepository");
type RepositoryDeps = Parameters<typeof createYouTubeRepository>[0];

const noopYoutubeErrorModel = {
  create: async (doc: object) => doc,
  find: () => { const chain = { sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => [] }; return chain; },
  deleteMany: async () => ({ deletedCount: 0 })
};


test("YouTube repository face baseline prin bulk upsert si claim atomic", async () => {
  const bulkOperations: object[][] = [];
  const created = new Set<string>();
  const repository = createYouTubeRepository({
    GuildModel: { updateOne: async () => ({ modifiedCount: 1 }) },
    GuildYoutubeErrorModel: noopYoutubeErrorModel,
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

test("YouTube repository scrie erorile in colectia dedicata si dezactiveaza canalul Discord permanent invalid", async () => {
  const writes: Array<{ filter: object; update: object; options?: object }> = [];
  const alerts: string[] = [];
  const errorDocs: Array<{ guildId?: string; channelName?: string; message?: string }> = [];
  const repository = createYouTubeRepository({
    GuildModel: {
      updateOne: async (filter, update, options) => {
        writes.push({ filter, update, options });
        return { matchedCount: 1, modifiedCount: 1 };
      }
    },
    GuildYoutubeErrorModel: {
      create: async doc => { errorDocs.push(doc as { guildId?: string; channelName?: string; message?: string }); return doc; },
      find: () => { const chain = { sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => [] }; return chain; },
      deleteMany: async () => ({ deletedCount: 0 })
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
  assert.doesNotMatch(JSON.stringify(writes[0].update), /youtubeErrors/, "eroarea nu se mai impinge pe documentul guild");
  assert.match(JSON.stringify(writes[0].update), /lastError/, "ultima eroare per canal ramane pe subdocumentul youtubeChannels");
  assert.match(JSON.stringify(writes[1].update), /youtubeNotificationsEnabled/);
  assert.equal(errorDocs.length, 2, "ambele erori ajung ca documente in colectia guildYoutubeErrors");
  assert.equal(errorDocs[0].guildId, "g1");
  assert.match(String(errorDocs[0].message), /feed indisponibil/);
  assert.equal(errorDocs[1].channelName, "Canal Discord notificari");
});

test("YouTube repository elimina o ruta Discord invalida fara sa opreasca modulul", async () => {
  const writes: Array<{ filter: object; update: object; options?: object }> = [];
  const errorDocs: Array<{ channelName?: string }> = [];
  const repository = createYouTubeRepository({
    GuildModel: {
      updateOne: async (filter, update, options) => {
        writes.push({ filter, update, options });
        return { matchedCount: 1, modifiedCount: 1 };
      }
    },
    GuildYoutubeErrorModel: {
      create: async doc => { errorDocs.push(doc as { channelName?: string }); return doc; },
      find: () => { const chain = { sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => [] }; return chain; },
      deleteMany: async () => ({ deletedCount: 0 })
    },
    GuildSeenYoutubeModel: {
      create: async () => ({}),
      bulkWrite: async () => ({}),
      deleteOne: async () => ({}),
      deleteMany: async () => ({})
    },
    withMongoRetry: async fn => fn(),
    invalidateGuildCache: () => undefined,
    adminAlert: async () => undefined,
    logger: () => undefined
  } satisfies RepositoryDeps);
  await repository.removeRouteForChannelError("g1", "route-1", "Missing Access");
  assert.equal(writes.length, 2);
  assert.match(JSON.stringify(writes[0].update), /youtubeChannelRoutes/);
  assert.doesNotMatch(JSON.stringify(writes[0].update), /youtubeNotificationsEnabled/);
  assert.match(JSON.stringify(writes[1].update), /\$size/);
  assert.equal(errorDocs.length, 1, "eroarea de ruta ajunge in colectia guildYoutubeErrors");
  assert.equal(errorDocs[0].channelName, "Ruta Discord YouTube");
});
