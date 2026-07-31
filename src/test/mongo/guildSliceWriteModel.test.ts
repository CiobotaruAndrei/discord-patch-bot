import test from "node:test";
import assert from "node:assert/strict";

import { createGuildSliceWriteModel } from "../../features/guild-config/guildSliceWriteModel.js";
import { composeGuildSliceWriteModel } from "../../features/guild-config/guildSliceWriteComposition.js";
import { MODERATION_FIELDS } from "../../shared/guildModerationFields.js";
import { SECURITY_FIELDS } from "../../shared/guildSecurityFields.js";
import { YOUTUBE_FIELDS } from "../../shared/guildYoutubeFields.js";
import { fakeJournalModel } from "./operationJournalTestKit.js";
import type { SliceUpdate } from "../../shared/guildDomainSliceStore.js";

interface Write {
  filter: Record<string, unknown>;
  update: SliceUpdate;
}

function collector(writes: Write[], fail = false) {
  return {
    async updateOne(filter: Record<string, unknown>, update: SliceUpdate) {
      if (fail) throw new Error("colectia dedicata a picat");
      writes.push({ filter, update });
      return { matchedCount: 1, modifiedCount: 1 };
    }
  };
}

function guildCollector(writes: Write[]) {
  return {
    async updateOne(filter: Record<string, unknown>, update: Record<string, unknown> | Record<string, unknown>[]) {
      writes.push({ filter, update });
      return { matchedCount: 1, modifiedCount: 1 };
    }
  };
}

test("o scriere de configurare care atinge felia YouTube ajunge si in colectia dedicata", async () => {
  const legacy: Write[] = [];
  const youtube: Write[] = [];
  const model = createGuildSliceWriteModel(guildCollector(legacy), [
    { domain: "youtube", fields: YOUTUBE_FIELDS, model: collector(youtube) }
  ]);

  await model.updateOne({ _id: "g1" }, { $set: { youtubeNotificationsEnabled: true, notificationChannelId: "canal" } });

  assert.equal(legacy.length, 1);
  assert.equal(youtube.length, 1);
  assert.deepEqual(youtube[0].filter, { _id: "g1" });
});

test("o scriere care nu atinge nicio felie ramane doar pe documentul vechi", async () => {
  const legacy: Write[] = [];
  const youtube: Write[] = [];
  const model = createGuildSliceWriteModel(guildCollector(legacy), [
    { domain: "youtube", fields: YOUTUBE_FIELDS, model: collector(youtube) }
  ]);

  await model.updateOne({ _id: "g2" }, { $set: { notificationChannelId: "canal" } });

  assert.equal(legacy.length, 1);
  assert.deepEqual(youtube, []);
});

test("o restaurare care atinge doua domenii ajunge in ambele colectii", async () => {
  const legacy: Write[] = [];
  const youtube: Write[] = [];
  const moderation: Write[] = [];
  const model = createGuildSliceWriteModel(guildCollector(legacy), [
    { domain: "moderation", fields: MODERATION_FIELDS, model: collector(moderation) },
    { domain: "youtube", fields: YOUTUBE_FIELDS, model: collector(youtube) }
  ]);

  await model.updateOne({ _id: "g3" }, { $set: { youtubeChannels: [], moderationWarnBanLimit: 3 } });

  assert.equal(youtube.length, 1);
  assert.equal(moderation.length, 1);
});

test("campurile de felie nu mai ating documentul vechi, iar esecul lor se propaga", async () => {
  const legacy: Write[] = [];
  const model = createGuildSliceWriteModel(
    guildCollector(legacy),
    [{ domain: "security", fields: SECURITY_FIELDS, model: collector([], true) }]
  );

  await assert.rejects(model.updateOne({ _id: "g4" }, { $set: { threatProtectionEnabled: true } }));

  assert.deepEqual(
    legacy,
    [],
    "colectia dedicata detine campul, deci un esec acolo nu are voie sa lase documentul vechi cu o valoare pe care nimeni nu o mai citeste"
  );
});

test("o scriere mixta imparte campurile intre colectia dedicata si documentul vechi", async () => {
  const legacy: Write[] = [];
  const security: Write[] = [];
  const model = createGuildSliceWriteModel(guildCollector(legacy), [
    { domain: "security", fields: SECURITY_FIELDS, model: collector(security) }
  ]);

  await model.updateOne({ _id: "g6" }, { $set: { threatProtectionEnabled: true, notificationChannelId: "canal" } });

  assert.deepEqual(security[0].update, { $set: { threatProtectionEnabled: true } });
  assert.deepEqual(legacy[0].update, { $set: { notificationChannelId: "canal" } });
});

test("o scriere fara _id de guild nu incearca sa oglindeasca nimic", async () => {
  const youtube: Write[] = [];
  const model = createGuildSliceWriteModel(guildCollector([]), [
    { domain: "youtube", fields: YOUTUBE_FIELDS, model: collector(youtube) }
  ]);

  await model.updateOne({ subscribed: true }, { $set: { youtubeNotificationsEnabled: false } });

  assert.deepEqual(youtube, []);
});

test("o scriere de felie separabila merge direct in colectia dedicata, fara jurnal", async () => {
  const journal = fakeJournalModel();
  const youtube: Write[] = [];
  const model = composeGuildSliceWriteModel({
    GuildModel: guildCollector([]),
    GuildYoutubeStateModel: collector(youtube),
    OperationJournalModel: journal,
    logger: () => undefined
  });

  await model.updateOne({ _id: "g5" }, { $set: { youtubeHasActivated: true } });

  assert.equal(youtube.length, 1);
  assert.equal(
    journal.docs.size,
    0,
    "dupa ce campul e detinut de colectia dedicata, scrierea nu mai e o copie de protejat, ci scrierea principala"
  );
});

test("un pipeline de agregare nu poate fi impartit, deci ramane copie jurnalizata", async () => {
  const journal = fakeJournalModel();
  const youtube: Write[] = [];
  const legacy: Write[] = [];
  const model = composeGuildSliceWriteModel({
    GuildModel: guildCollector(legacy),
    GuildYoutubeStateModel: collector(youtube),
    OperationJournalModel: journal,
    logger: () => undefined
  });

  await model.updateOne({ _id: "g7" }, [{ $set: { youtubeChannels: [] } }]);

  assert.equal(youtube.length, 1);
  assert.equal(legacy.length, 1);
  const entries = [...journal.docs.values()];
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, "guild-slice-copy");
});

test("fara colectii dedicate compunerea intoarce exact modelul vechi", async () => {
  const legacy = guildCollector([]);
  const model = composeGuildSliceWriteModel({ GuildModel: legacy });

  assert.equal(model, legacy);
});
