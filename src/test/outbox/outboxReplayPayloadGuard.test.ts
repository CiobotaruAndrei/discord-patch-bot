import test from "node:test";
import assert from "node:assert/strict";

import { createOutboxAdminOperations, type OutboxAdminOperationsDeps } from "../../features/command-handlers/outboxAdminOperations.js";
import type { ReplayDeadLetterDoc } from "../../features/command-handlers/outboxAdminContracts.js";

function makeDeps(docs: ReplayDeadLetterDoc[], overrides: Partial<OutboxAdminOperationsDeps> = {}) {
  const enqueued: Array<{ payload: unknown }> = [];
  const warnings: string[] = [];
  const deps: OutboxAdminOperationsDeps = {
    NotificationOutboxModel: { updateMany: async () => ({ modifiedCount: 0 }) },
    GuildDeadLetterModel: {
      countDocuments: async () => 0,
      deleteMany: async () => ({ deletedCount: 0 })
    },
    enqueueOutbox: async job => { enqueued.push({ payload: job.payload }); },
    listReplayableDeadLetters: async () => docs,
    deleteReplayedDeadLetters: async () => {},
    deleteAllReplayPayloads: async () => {},
    getGuildSettings: async () => null,
    getOutboxPaused: async () => false,
    acquireDbLock: async () => "token",
    releaseDbLock: async () => undefined,
    drainOutbox: async () => ({}),
    logger: (level, _context, message) => {
      if (level === "WARN") warnings.push(message);
    },
    outboxEnabled: true,
    outboxGlobalAdminIds: [],
    ...overrides
  };
  return { operations: createOutboxAdminOperations(deps), enqueued, warnings };
}

function makeDoc(id: string, payload: unknown): ReplayDeadLetterDoc {
  return { _id: id, kind: "update", channelId: "c1", payload, dedupeKey: `k-${id}`, recoveryVerify: false };
}

test("replay-deadletters sare peste payload-urile nelivrabile cu WARN si reintroduce doar payload-urile valide", async () => {
  const { operations, enqueued, warnings } = makeDeps([
    makeDoc("valid", { content: "mesaj" }),
    makeDoc("corupt", "payload-corupt"),
    makeDoc("null", null)
  ]);

  const message = await operations.replayDeadLetters("guild-1");

  assert.equal(enqueued.length, 1);
  assert.deepEqual(enqueued[0].payload, { content: "mesaj" });
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every(warning => warning.includes("payload nelivrabil")));
  assert.ok(message.startsWith("OK: 1 livrare(i)"), message);
});

test("replay-deadletters cu doar payload-uri nelivrabile nu enqueue-uieste nimic si raspunde ca nu exista replay-uri", async () => {
  const { operations, enqueued, warnings } = makeDeps([makeDoc("corupt", "text")]);

  const message = await operations.replayDeadLetters("guild-1");

  assert.equal(enqueued.length, 0);
  assert.equal(warnings.length, 1);
  assert.ok(message.startsWith("Nicio livrare dead-letter"), message);
});
