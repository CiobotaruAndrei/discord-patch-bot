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

test("documentul vechi se scrie primul, iar un esec al copiei nu il anuleaza", async () => {
  const order: string[] = [];
  const failures: Array<[string, string]> = [];
  const model = createGuildSliceWriteModel(
    {
      async updateOne() {
        order.push("canonic");
        return { matchedCount: 1, modifiedCount: 1 };
      }
    },
    [{ domain: "security", fields: SECURITY_FIELDS, model: collector([], true) }],
    { onCopyFailed: (domain, guildId) => failures.push([domain, guildId]) }
  );

  const result = await model.updateOne({ _id: "g4" }, { $set: { threatProtectionEnabled: true } });

  assert.deepEqual(order, ["canonic"]);
  assert.equal(result.modifiedCount, 1);
  assert.deepEqual(failures, [["security", "g4"]]);
});

test("o scriere fara _id de guild nu incearca sa oglindeasca nimic", async () => {
  const youtube: Write[] = [];
  const model = createGuildSliceWriteModel(guildCollector([]), [
    { domain: "youtube", fields: YOUTUBE_FIELDS, model: collector(youtube) }
  ]);

  await model.updateOne({ subscribed: true }, { $set: { youtubeNotificationsEnabled: false } });

  assert.deepEqual(youtube, []);
});

test("compunerea trece copia prin jurnal cand modelul de jurnal exista", async () => {
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
  const entries = [...journal.docs.values()];
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, "guild-slice-copy");
  assert.equal(entries[0].status, "done");
});

test("fara colectii dedicate compunerea intoarce exact modelul vechi", async () => {
  const legacy = guildCollector([]);
  const model = composeGuildSliceWriteModel({ GuildModel: legacy });

  assert.equal(model, legacy);
});
