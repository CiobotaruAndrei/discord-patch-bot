import test from "node:test";
import assert from "node:assert/strict";

import { createYoutubeStateReader } from "../../features/youtube/youtubeStateReader.js";
import type { YoutubeGuildReaderModel, YoutubeSliceDocument, YoutubeSliceReaderModel } from "../../features/youtube/youtubeStateReader.js";
import type { GuildSettings } from "../../features/guild-config/guildSettingsTypes.js";

interface RecordedFind {
  filter: Record<string, unknown>;
}

function guildModelOf(documents: GuildSettings[], calls: RecordedFind[] = []): YoutubeGuildReaderModel {
  return {
    find(filter: Record<string, unknown>) {
      calls.push({ filter });
      const ids = filter._id && typeof filter._id === "object" ? (filter._id as { $in?: unknown }).$in : null;
      if (Array.isArray(ids)) {
        const wanted = new Set(ids.map(String));
        return { lean: async () => documents.filter(document => wanted.has(document._id)) };
      }
      return { lean: async () => documents.filter(document => (document.youtubeChannels ?? []).length > 0) };
    }
  };
}

function stateModelOf(
  documents: YoutubeSliceDocument[],
  writes: Array<{ filter: Record<string, unknown>; update: Record<string, unknown> }> = [],
  failWrites = false
): YoutubeSliceReaderModel {
  return {
    find() {
      return { lean: async () => documents.filter(document => (document.youtubeChannels ?? []).length > 0) };
    },
    async updateOne(filter: Record<string, unknown>, update: Record<string, unknown>) {
      if (failWrites) throw new Error("mongo indisponibil");
      writes.push({ filter, update });
      return { acknowledged: true };
    }
  };
}

const subscription = { channelId: "UC1", channelName: "Canal", channelUrl: "https://youtube.com/channel/UC1", subscribedAt: "2026-01-01T00:00:00.000Z" };

test("enumerarea foloseste colectia dedicata ca sursa canonica", async () => {
  const reader = createYoutubeStateReader({
    guildModel: guildModelOf([{
      _id: "g1",
      youtubeChannels: [subscription],
      youtubeNotificationChannelId: "vechi",
      youtubeNotificationsEnabled: false
    }]),
    stateModel: stateModelOf([{
      _id: "g1",
      youtubeChannels: [subscription],
      youtubeNotificationChannelId: "nou",
      youtubeNotificationsEnabled: true
    }])
  });

  const guilds = await reader.listActiveGuilds();

  assert.equal(guilds.length, 1);
  assert.equal(guilds[0].youtubeNotificationChannelId, "nou");
  assert.equal(guilds[0].youtubeNotificationsEnabled, true);
});

test("campurile de guild din afara feliei raman din documentul vechi", async () => {
  const reader = createYoutubeStateReader({
    guildModel: guildModelOf([{
      _id: "g1",
      youtubeChannels: [subscription],
      outboxRecoveryVerify: true,
      notificationChannelId: "canal-general"
    }]),
    stateModel: stateModelOf([{ _id: "g1", youtubeChannels: [subscription] }])
  });

  const guilds = await reader.listActiveGuilds();

  assert.equal(guilds[0].outboxRecoveryVerify, true);
  assert.equal(guilds[0].notificationChannelId, "canal-general");
});

test("un camp absent din copia dedicata e completat din documentul vechi", async () => {
  const reader = createYoutubeStateReader({
    guildModel: guildModelOf([{
      _id: "g1",
      youtubeChannels: [subscription],
      youtubeMessageTemplate: "sablon vechi"
    }]),
    stateModel: stateModelOf([{ _id: "g1", youtubeChannels: [subscription] }])
  });

  const guilds = await reader.listActiveGuilds();

  assert.equal(guilds[0].youtubeMessageTemplate, "sablon vechi");
});

test("copia dedicata lipsa e raportata si refacuta din documentul vechi", async () => {
  const writes: Array<{ filter: Record<string, unknown>; update: Record<string, unknown> }> = [];
  const missing: string[] = [];
  const reader = createYoutubeStateReader({
    guildModel: guildModelOf([{
      _id: "g1",
      youtubeChannels: [subscription],
      youtubeNotificationChannelId: "vechi"
    }]),
    stateModel: stateModelOf([], writes),
    onMissingCopy: guildId => missing.push(guildId)
  });

  const guilds = await reader.listActiveGuilds();

  assert.deepEqual(missing, ["g1"]);
  assert.equal(guilds[0].youtubeNotificationChannelId, "vechi");
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].filter, { _id: "g1" });
  assert.deepEqual(writes[0].update, {
    $set: { youtubeChannels: [subscription], youtubeNotificationChannelId: "vechi" }
  });
});

test("o reparare esuata e raportata, dar enumerarea continua cu datele vechi", async () => {
  const failures: Array<{ guildId: string; error: unknown }> = [];
  const reader = createYoutubeStateReader({
    guildModel: guildModelOf([{ _id: "g1", youtubeChannels: [subscription], youtubeNotificationsEnabled: true }]),
    stateModel: stateModelOf([], [], true),
    onRepairFailed: (guildId, error) => failures.push({ guildId, error })
  });

  const guilds = await reader.listActiveGuilds();

  assert.equal(guilds.length, 1);
  assert.equal(guilds[0].youtubeNotificationsEnabled, true);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].guildId, "g1");
});

test("un guild activ doar in colectia dedicata e enumerat cu restul setarilor lui", async () => {
  const reader = createYoutubeStateReader({
    guildModel: guildModelOf([{ _id: "g1", outboxRecoveryVerify: true }]),
    stateModel: stateModelOf([{
      _id: "g1",
      youtubeChannels: [subscription],
      youtubeNotificationChannelId: "nou"
    }])
  });

  const guilds = await reader.listActiveGuilds();

  assert.equal(guilds.length, 1);
  assert.equal(guilds[0]._id, "g1");
  assert.equal(guilds[0].youtubeNotificationChannelId, "nou");
  assert.equal(guilds[0].outboxRecoveryVerify, true);
});

test("un guild dedicat fara document vechi ramane enumerat", async () => {
  const reader = createYoutubeStateReader({
    guildModel: guildModelOf([]),
    stateModel: stateModelOf([{ _id: "g9", youtubeChannels: [subscription] }])
  });

  const guilds = await reader.listActiveGuilds();

  assert.deepEqual(guilds.map(guild => guild._id), ["g9"]);
});

test("fara colectie dedicata enumerarea ramane pe documentul vechi", async () => {
  const calls: RecordedFind[] = [];
  const reader = createYoutubeStateReader({
    guildModel: guildModelOf([{ _id: "g1", youtubeChannels: [subscription] }], calls)
  });

  const guilds = await reader.listActiveGuilds();

  assert.deepEqual(guilds.map(guild => guild._id), ["g1"]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].filter, { "youtubeChannels.0": { $exists: true } });
});

test("documentele vechi fara guild activ dedicat nu produc citiri suplimentare", async () => {
  const calls: RecordedFind[] = [];
  const reader = createYoutubeStateReader({
    guildModel: guildModelOf([{ _id: "g1", youtubeChannels: [subscription] }], calls),
    stateModel: stateModelOf([{ _id: "g1", youtubeChannels: [subscription] }])
  });

  await reader.listActiveGuilds();

  assert.equal(calls.length, 1);
});
