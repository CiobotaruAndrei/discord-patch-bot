import test from "node:test";
import assert from "node:assert/strict";
import { createOutboxRuntime, OutboxJob, DeliverResult } from "../features/notifications/notificationOutbox";

function makeFakeModel(jobs: OutboxJob[]) {
  const created: Record<string, unknown>[] = [];
  const deleted: unknown[] = [];
  const updated: Array<{ filter: unknown; update: unknown }> = [];
  const model = {
    create: async (doc: Record<string, unknown>) => { created.push(doc); return doc; },
    find: (_filter: unknown) => ({
      sort: (_spec: unknown) => ({
        limit: (_count: number) => ({
          lean: async () => jobs
        })
      })
    }),
    deleteOne: async (filter: unknown) => { deleted.push(filter); return { deletedCount: 1 }; },
    updateOne: async (filter: unknown, update: unknown) => { updated.push({ filter, update }); return { matchedCount: 1 }; },
    countDocuments: async () => jobs.length - deleted.length
  };
  return { model, created, deleted, updated };
}

function makeRuntime(jobs: OutboxJob[]) {
  const fake = makeFakeModel(jobs);
  const runtime = createOutboxRuntime({
    NotificationOutboxModel: fake.model as never,
    withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
    logger: () => undefined
  });
  return { runtime, ...fake };
}

test("enqueueOutbox creeaza un job cu attempts 0 si availableAt", async () => {
  const { runtime, created } = makeRuntime([]);
  await runtime.enqueueOutbox({ guildId: "g1", channelId: "c1", kind: "update", payload: { embeds: [] } });
  assert.equal(created.length, 1);
  assert.equal(created[0].guildId, "g1");
  assert.equal(created[0].kind, "update");
  assert.equal(created[0].attempts, 0);
  assert.ok(created[0].availableAt instanceof Date);
});

test("drainOutbox: livrare reusita -> jobul e sters (sent)", async () => {
  const job: OutboxJob = { _id: "j1", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0 };
  const { runtime, deleted, updated } = makeRuntime([job]);
  const deadLetters: unknown[] = [];
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => ({ ok: true }),
    recordDeadLetter: async (j) => { deadLetters.push(j); },
    maxAttempts: 5, backoffMs: 1000, limit: 50
  });
  assert.deepEqual(result, { sent: 1, deadLettered: 0, retried: 0, total: 1, queued: 0 });
  assert.deepEqual(deleted, [{ _id: "j1" }]);
  assert.equal(updated.length, 0);
  assert.equal(deadLetters.length, 0);
});

test("drainOutbox: eroare permanenta -> dead-letter + sters", async () => {
  const job: OutboxJob = { _id: "j1", guildId: "g1", channelId: "c1", kind: "discount", payload: {}, attempts: 0 };
  const { runtime, deleted } = makeRuntime([job]);
  const deadLetters: Array<{ job: OutboxJob; reason: string }> = [];
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => ({ ok: false, permanent: true }),
    recordDeadLetter: async (j, reason) => { deadLetters.push({ job: j, reason }); },
    maxAttempts: 5, backoffMs: 1000, limit: 50
  });
  assert.deepEqual(result, { sent: 0, deadLettered: 1, retried: 0, total: 1, queued: 0 });
  assert.deepEqual(deleted, [{ _id: "j1" }]);
  assert.equal(deadLetters.length, 1);
  assert.equal(deadLetters[0].reason, "permanent");
});

test("drainOutbox: esec tranzitoriu sub max -> reincercare cu backoff (attempts++)", async () => {
  const job: OutboxJob = { _id: "j1", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 1 };
  const { runtime, updated, deleted } = makeRuntime([job]);
  const now = new Date(10_000);
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => ({ ok: false, permanent: false }),
    recordDeadLetter: async () => undefined,
    maxAttempts: 5, backoffMs: 1000, limit: 50, now
  });
  assert.deepEqual(result, { sent: 0, deadLettered: 0, retried: 1, total: 1, queued: 1 });
  assert.equal(deleted.length, 0);
  assert.equal(updated.length, 1);
  const update = updated[0].update as { $set: { attempts: number; availableAt: Date } };
  assert.equal(update.$set.attempts, 2);
  assert.equal(update.$set.availableAt.getTime(), 10_000 + 1000 * 2, "backoff scaleaza cu attempts");
});

test("drainOutbox: esec tranzitoriu la max attempts -> dead-letter + sters", async () => {
  const job: OutboxJob = { _id: "j1", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 4 };
  const { runtime, deleted, updated } = makeRuntime([job]);
  const deadLetters: Array<{ reason: string }> = [];
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => ({ ok: false, permanent: false }),
    recordDeadLetter: async (_j, reason) => { deadLetters.push({ reason }); },
    maxAttempts: 5, backoffMs: 1000, limit: 50
  });
  assert.deepEqual(result, { sent: 0, deadLettered: 1, retried: 0, total: 1, queued: 0 });
  assert.deepEqual(deleted, [{ _id: "j1" }]);
  assert.equal(updated.length, 0);
  assert.equal(deadLetters[0].reason, "max-attempts");
});
