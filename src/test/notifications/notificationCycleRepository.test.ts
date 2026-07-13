import test from "node:test";
import assert from "node:assert/strict";

import { persistGuildCycleState } from "../../features/notifications/notificationCycleRepository.js";
import { buildDeadLetterEntry } from "../../features/notifications/deadLetter.js";
import type { GuildDeadLetterRecord } from "../../features/notifications/deadLetterRepository.js";

function makeModels(matchedCount: number) {
  const writes: Array<{ filter: Record<string, unknown>; update: unknown }> = [];
  const deadLetterDocs: GuildDeadLetterRecord[] = [];
  const GuildModel = {
    updateOne: async (filter: Record<string, unknown>, update: unknown) => {
      writes.push({ filter, update });
      return { matchedCount, modifiedCount: matchedCount };
    }
  };
  const GuildDeadLetterModel = {
    insertMany: async (docs: GuildDeadLetterRecord[]) => { for (const doc of docs) deadLetterDocs.push(doc); return docs; },
    find: () => { const chain = { sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => [] }; return chain; },
    deleteMany: async () => ({ deletedCount: 0 })
  };
  return { GuildModel, GuildDeadLetterModel, writes, deadLetterDocs };
}

const ENTRY = buildDeadLetterEntry({ kind: "update", itemId: "u-1", reason: "max-attempts", attempts: 5 });

test("persistGuildCycleState scrie $set pe filtrul de abonare si inregistreaza dead-letter-ele doar dupa un match", async () => {
  const { GuildModel, GuildDeadLetterModel, writes, deadLetterDocs } = makeModels(1);

  await persistGuildCycleState(GuildModel, GuildDeadLetterModel, "guild-1",
    { _id: "guild-1", subscribed: true, notificationChannelId: "chan-1" },
    { pendingUpdates: {} }, [ENTRY]);

  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].filter, { _id: "guild-1", subscribed: true, notificationChannelId: "chan-1" });
  assert.deepEqual(writes[0].update, { $set: { pendingUpdates: {} } });
  assert.equal(deadLetterDocs.length, 1);
  assert.equal(deadLetterDocs[0].guildId, "guild-1");
  assert.equal(deadLetterDocs[0].itemId, "u-1");
});

test("persistGuildCycleState NU scrie dead-letter cand guild-ul nu mai e abonat pe canal (matchedCount 0)", async () => {
  const { GuildModel, GuildDeadLetterModel, writes, deadLetterDocs } = makeModels(0);

  await persistGuildCycleState(GuildModel, GuildDeadLetterModel, "guild-1",
    { _id: "guild-1", discountsSubscribed: true, discountChannelId: "chan-2" },
    { pendingDiscounts: [] }, [ENTRY]);

  assert.equal(writes.length, 1, "scrierea principala e incercata");
  assert.equal(deadLetterDocs.length, 0, "fara audit fantoma pentru un ciclu al carui guild a disparut/dezabonat");
});

test("persistGuildCycleState fara dead-letter-e face doar scrierea principala", async () => {
  const { GuildModel, GuildDeadLetterModel, writes, deadLetterDocs } = makeModels(1);

  await persistGuildCycleState(GuildModel, GuildDeadLetterModel, "guild-1",
    { _id: "guild-1", subscribed: true, notificationChannelId: "chan-1" },
    { pendingUpdates: {}, lastProcessedGameKey: "cs2" }, []);

  assert.equal(writes.length, 1);
  assert.deepEqual((writes[0].update as { $set: Record<string, unknown> }).$set.lastProcessedGameKey, "cs2");
  assert.equal(deadLetterDocs.length, 0);
});
