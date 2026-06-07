import test from "node:test";
import assert from "node:assert/strict";

import { createDeadLetterReplayRepository, isReplayableReason } from "../features/notifications/deadLetterReplayRepository";

const passthroughRetry = <T>(fn: () => Promise<T>): Promise<T> => fn();
const noopLogger = () => undefined;

test("isReplayableReason: reia esecurile reale, refuza delivered-marksent-failed si gol", () => {
  assert.equal(isReplayableReason("permanent"), true);
  assert.equal(isReplayableReason("max-attempts"), true);
  assert.equal(isReplayableReason("expired-near-ttl"), true);
  assert.equal(isReplayableReason("delivered-marksent-failed"), false);
  assert.equal(isReplayableReason(""), false);
});

test("recordPayload scrie doar pentru motive replayabile si cu payload + canal", async () => {
  const created: Array<Record<string, unknown>> = [];
  const model = {
    create: async (doc: Record<string, unknown>) => { created.push(doc); return doc; },
    find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }),
    deleteMany: async () => ({ deletedCount: 0 })
  };
  const repo = createDeadLetterReplayRepository({ NotificationDeadLetterReplayModel: model, withMongoRetry: passthroughRetry, logger: noopLogger });

  await repo.recordPayload({ guildId: "g1", kind: "update", channelId: "c1", payload: { embeds: [{ title: "X" }] }, dedupeKey: "dk1", recoveryVerify: true, reason: "permanent", itemId: "i1" });
  assert.equal(created.length, 1, "scrie pentru motiv replayabil");
  assert.equal(created[0].guildId, "g1");
  assert.equal(created[0].recoveryVerify, true);

  await repo.recordPayload({ guildId: "g1", kind: "update", channelId: "c1", payload: { embeds: [] }, reason: "delivered-marksent-failed" });
  assert.equal(created.length, 1, "nu scrie pentru delivered-marksent-failed");

  await repo.recordPayload({ guildId: "g1", kind: "update", channelId: "c1", payload: null, reason: "permanent" });
  assert.equal(created.length, 1, "nu scrie fara payload");

  await repo.recordPayload({ guildId: "g1", kind: "update", channelId: "", payload: { a: 1 }, reason: "max-attempts" });
  assert.equal(created.length, 1, "nu scrie fara canal");
});

test("listForGuild normalizeaza documentele; deleteReplayed sterge dupa id-uri", async () => {
  const deleteCalls: Array<Record<string, unknown>> = [];
  const model = {
    create: async () => undefined,
    find: (filter: Record<string, unknown>) => {
      assert.deepEqual(filter, { guildId: "g1" });
      return { sort: () => ({ limit: () => ({ lean: async () => [
        { _id: "a", kind: "discount", channelId: "c9", payload: { content: "hi" }, dedupeKey: "dk", recoveryVerify: true },
        { _id: "b", kind: "weird", channelId: "c8", payload: { x: 1 } }
      ] }) }) };
    },
    deleteMany: async (filter: Record<string, unknown>) => { deleteCalls.push(filter); return { deletedCount: 2 }; }
  };
  const repo = createDeadLetterReplayRepository({ NotificationDeadLetterReplayModel: model, withMongoRetry: passthroughRetry, logger: noopLogger });

  const docs = await repo.listForGuild("g1");
  assert.equal(docs.length, 2);
  assert.equal(docs[0].kind, "discount");
  assert.equal(docs[0].recoveryVerify, true);
  assert.equal(docs[1].kind, "update", "kind necunoscut cade pe 'update'");
  assert.equal(docs[1].recoveryVerify, false);

  await repo.deleteReplayed("g1", ["a", "b"]);
  assert.equal(deleteCalls.length, 1);
  assert.deepEqual(deleteCalls[0], { guildId: "g1", _id: { $in: ["a", "b"] } });

  await repo.deleteReplayed("g1", []);
  assert.equal(deleteCalls.length, 1, "nu apeleaza deleteMany pentru lista goala");
});
