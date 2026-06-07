import test from "node:test";
import assert from "node:assert/strict";

import { createDeadLetterReplayRepository, isReplayableReason } from "../features/notifications/deadLetterReplayRepository";

const passthroughRetry = <T>(fn: () => Promise<T>): Promise<T> => fn();
const noopLogger = () => undefined;

function makeModel() {
  const created: Array<Record<string, unknown>> = [];
  const upserts: Array<{ filter: unknown; update: unknown; opts: unknown }> = [];
  const deletes: Array<Record<string, unknown>> = [];
  const model = {
    create: async (doc: Record<string, unknown>) => { created.push(doc); return doc; },
    updateOne: async (filter: unknown, update: unknown, opts: unknown) => { upserts.push({ filter, update, opts }); return { upsertedCount: 1 }; },
    find: (filter: Record<string, unknown>) => ({ sort: () => ({ limit: () => ({ lean: async () => [
      { _id: "a", kind: "discount", channelId: "c9", payload: { content: "hi" }, dedupeKey: "dk", recoveryVerify: true },
      { _id: "b", kind: "weird", channelId: "c8", payload: { x: 1 } }
    ] }) }), _filter: filter }),
    deleteMany: async (filter: Record<string, unknown>) => { deletes.push(filter); return { deletedCount: 2 }; }
  };
  return { model, created, upserts, deletes };
}

test("isReplayableReason: reia esecurile reale, refuza delivered-marksent-failed si gol", () => {
  assert.equal(isReplayableReason("permanent"), true);
  assert.equal(isReplayableReason("max-attempts"), true);
  assert.equal(isReplayableReason("expired-near-ttl"), true);
  assert.equal(isReplayableReason("delivered-marksent-failed"), false);
  assert.equal(isReplayableReason(""), false);
});

test("recordPayload cu dedupeKey face upsert (dedup); fara dedupeKey face create", async () => {
  const { model, created, upserts } = makeModel();
  const repo = createDeadLetterReplayRepository({ NotificationDeadLetterReplayModel: model, withMongoRetry: passthroughRetry, logger: noopLogger });

  await repo.recordPayload({ guildId: "g1", kind: "update", channelId: "c1", payload: { embeds: [{ title: "X" }] }, dedupeKey: "dk1", recoveryVerify: true, reason: "permanent", itemId: "i1" });
  assert.equal(upserts.length, 1, "dedupeKey non-gol -> upsert (nu duplica la re-record)");
  assert.deepEqual(upserts[0].filter, { guildId: "g1", dedupeKey: "dk1" });
  assert.deepEqual((upserts[0].opts as { upsert?: boolean }), { upsert: true });
  const update = upserts[0].update as { $set: { updatedAt?: unknown }; $setOnInsert: { createdAt?: unknown } };
  assert.ok(update.$set.updatedAt instanceof Date, "updatedAt e in $set -> TTL se reimprospateaza la re-record");
  assert.ok(update.$setOnInsert.createdAt instanceof Date, "createdAt doar la insert (nu se reseteaza)");
  assert.equal(created.length, 0);

  await repo.recordPayload({ guildId: "g1", kind: "update", channelId: "c1", payload: { content: "no-key" }, reason: "max-attempts" });
  assert.equal(created.length, 1, "fara dedupeKey -> create");
  assert.ok((created[0].createdAt instanceof Date) && (created[0].updatedAt instanceof Date), "create seteaza ambele timestampuri");
});

test("recordPayload sare peste motive ne-replayabile / fara payload / fara canal", async () => {
  const { model, created, upserts } = makeModel();
  const repo = createDeadLetterReplayRepository({ NotificationDeadLetterReplayModel: model, withMongoRetry: passthroughRetry, logger: noopLogger });
  await repo.recordPayload({ guildId: "g1", kind: "update", channelId: "c1", payload: { a: 1 }, dedupeKey: "d", reason: "delivered-marksent-failed" });
  await repo.recordPayload({ guildId: "g1", kind: "update", channelId: "c1", payload: null, dedupeKey: "d", reason: "permanent" });
  await repo.recordPayload({ guildId: "g1", kind: "update", channelId: "", payload: { a: 1 }, dedupeKey: "d", reason: "permanent" });
  assert.equal(created.length + upserts.length, 0, "niciuna nu scrie");
});

test("listForGuild normalizeaza; deleteReplayed dupa id-uri; deleteAllForGuild dupa guild", async () => {
  const { model, deletes } = makeModel();
  const repo = createDeadLetterReplayRepository({ NotificationDeadLetterReplayModel: model, withMongoRetry: passthroughRetry, logger: noopLogger });

  const docs = await repo.listForGuild("g1");
  assert.equal(docs.length, 2);
  assert.equal(docs[0].kind, "discount");
  assert.equal(docs[0].recoveryVerify, true);
  assert.equal(docs[1].kind, "update", "kind necunoscut cade pe 'update'");

  await repo.deleteReplayed("g1", ["a", "b"]);
  assert.deepEqual(deletes[0], { guildId: "g1", _id: { $in: ["a", "b"] } });
  await repo.deleteReplayed("g1", []);
  assert.equal(deletes.length, 1, "nu apeleaza deleteMany pentru lista goala");

  await repo.deleteAllForGuild("g1");
  assert.deepEqual(deletes[1], { guildId: "g1" }, "deleteAllForGuild sterge tot per guild");
});
