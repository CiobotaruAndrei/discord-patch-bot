import test from "node:test";
import assert from "node:assert/strict";
import { createOutboxRuntime, OutboxJob, DeliverResult } from "../features/notifications/notificationOutbox";

function makeFakeModel(jobs: OutboxJob[]) {
  const created: Record<string, unknown>[] = [];
  const deleted: unknown[] = [];
  const updated: Array<{ filter: unknown; update: unknown }> = [];
  const claims: Array<{ filter: unknown; update: unknown }> = [];
  const pending = [...jobs];
  const model = {
    create: async (doc: Record<string, unknown>) => { created.push(doc); return doc; },
    findOneAndUpdate: async (filter: unknown, update: unknown) => {
      claims.push({ filter, update });
      return pending.shift() ?? null;
    },
    find: (_filter: unknown) => ({
      sort: (_spec: unknown) => ({
        limit: (_count: number) => ({
          lean: async () => jobs.slice(0, 1)
        })
      })
    }),
    deleteOne: async (filter: unknown) => { deleted.push(filter); return { deletedCount: 1 }; },
    updateOne: async (filter: unknown, update: unknown) => { updated.push({ filter, update }); return { matchedCount: 1 }; },
    countDocuments: async () => jobs.length - deleted.length
  };
  return { model, created, deleted, updated, claims };
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

test("enqueueOutbox creeaza un job cu attempts 0, createdAt si availableAt", async () => {
  const { runtime, created } = makeRuntime([]);
  await runtime.enqueueOutbox({ guildId: "g1", channelId: "c1", kind: "update", payload: { embeds: [] } });
  assert.equal(created.length, 1);
  assert.equal(created[0].guildId, "g1");
  assert.equal(created[0].kind, "update");
  assert.equal(created[0].attempts, 0);
  assert.ok(created[0].availableAt instanceof Date);
  assert.ok(created[0].createdAt instanceof Date);
});

test("drainOutbox: claim atomic prin lease (lockedUntil/lockedBy) inainte de livrare", async () => {
  const job: OutboxJob = { _id: "j1", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0 };
  const { runtime, claims } = makeRuntime([job]);
  await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => ({ ok: true }),
    recordDeadLetter: async () => undefined,
    maxAttempts: 5, backoffMs: 1000, limit: 50, workerId: "worker-7"
  });
  assert.ok(claims.length >= 1, "jobul este revendicat printr-un findOneAndUpdate");
  const claimUpdate = claims[0].update as { $set: { lockedUntil: Date; lockedBy: string } };
  assert.ok(claimUpdate.$set.lockedUntil instanceof Date, "lease seteaza lockedUntil");
  assert.equal(claimUpdate.$set.lockedBy, "worker-7", "lease seteaza lockedBy");
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
  assert.equal(result.sent, 1);
  assert.equal(result.deadLettered, 0);
  assert.equal(result.retried, 0);
  assert.equal(result.total, 1);
  assert.equal(result.queued, 0);
  assert.ok(typeof result.deliveryMsTotal === "number" && result.deliveryMsTotal >= 0);
  assert.ok(typeof result.oldestJobAgeMs === "number" && result.oldestJobAgeMs >= 0);
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
  assert.equal(result.sent, 0);
  assert.equal(result.deadLettered, 1);
  assert.equal(result.retried, 0);
  assert.equal(result.queued, 0);
  assert.deepEqual(deleted, [{ _id: "j1" }]);
  assert.equal(deadLetters.length, 1);
  assert.equal(deadLetters[0].reason, "permanent");
});

test("drainOutbox: esec tranzitoriu sub max -> reincercare cu backoff + release lease", async () => {
  const job: OutboxJob = { _id: "j1", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 1 };
  const { runtime, updated, deleted } = makeRuntime([job]);
  const now = new Date(10_000);
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => ({ ok: false, permanent: false }),
    recordDeadLetter: async () => undefined,
    maxAttempts: 5, backoffMs: 1000, limit: 50, now
  });
  assert.equal(result.retried, 1);
  assert.equal(result.queued, 1);
  assert.equal(deleted.length, 0);
  assert.equal(updated.length, 1);
  const update = updated[0].update as { $set: { attempts: number; availableAt: Date }; $unset: Record<string, string> };
  assert.equal(update.$set.attempts, 2);
  assert.equal(update.$set.availableAt.getTime(), 10_000 + 1000 * 2, "backoff scaleaza cu attempts");
  assert.ok("lockedUntil" in update.$unset && "lockedBy" in update.$unset, "lease eliberat la reincercare");
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
  assert.equal(result.deadLettered, 1);
  assert.equal(result.queued, 0);
  assert.deepEqual(deleted, [{ _id: "j1" }]);
  assert.equal(updated.length, 0);
  assert.equal(deadLetters[0].reason, "max-attempts");
});
