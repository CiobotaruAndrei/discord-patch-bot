import test from "node:test";
import assert from "node:assert/strict";
import { createOutboxRuntime, OutboxJob, DeliverResult } from "../features/notifications/notificationOutbox";

function makeFakeModel(jobs: OutboxJob[], initialSent: string[] = []) {
  const created: Record<string, unknown>[] = [];
  const deleted: unknown[] = [];
  const updated: Array<{ filter: unknown; update: unknown }> = [];
  const claims: Array<{ filter: unknown; update: unknown }> = [];
  const sentKeys = new Set<string>(initialSent);
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
  const sentModel = {
    exists: async (filter: { dedupeKey: string }) => (sentKeys.has(filter.dedupeKey) ? { _id: filter.dedupeKey } : null),
    updateOne: async (filter: { dedupeKey: string }) => { sentKeys.add(filter.dedupeKey); return { upsertedCount: 1 }; }
  };
  return { model, sentModel, created, deleted, updated, claims, sentKeys };
}

function makeRuntime(jobs: OutboxJob[], initialSent: string[] = []) {
  const fake = makeFakeModel(jobs, initialSent);
  const runtime = createOutboxRuntime({
    NotificationOutboxModel: fake.model as never,
    NotificationOutboxSentModel: fake.sentModel as never,
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
  assert.equal(typeof created[0].dedupeKey, "string", "jobul primeste un dedupeKey stabil");
  assert.match(String(created[0].dedupeKey), /^[0-9a-f]{64}$/, "dedupeKey este un hash SHA-256 (64 hex)");
});

test("enqueueOutbox: dedupeKey e stabil indiferent de ordinea cheilor din payload", async () => {
  const a = makeRuntime([]);
  await a.runtime.enqueueOutbox({ guildId: "g1", channelId: "c1", kind: "update", payload: { x: 1, y: { p: 2, q: 3 } } });
  const b = makeRuntime([]);
  await b.runtime.enqueueOutbox({ guildId: "g1", channelId: "c1", kind: "update", payload: { y: { q: 3, p: 2 }, x: 1 } });
  assert.equal(a.created[0].dedupeKey, b.created[0].dedupeKey, "normalizare stabila -> acelasi dedupeKey la chei reordonate");
});

test("enqueueOutbox: nu re-enqueue daca dedupeKey a fost livrat recent (idempotent)", async () => {
  const probe = makeRuntime([]);
  const dedupeKey = (await (async () => {
    await probe.runtime.enqueueOutbox({ guildId: "g1", channelId: "c1", kind: "update", payload: { x: 1 } });
    return String(probe.created[0].dedupeKey);
  })());
  const { runtime, created } = makeRuntime([], [dedupeKey]);
  await runtime.enqueueOutbox({ guildId: "g1", channelId: "c1", kind: "update", payload: { x: 1 } });
  assert.equal(created.length, 0, "acelasi continut deja livrat -> nu se mai creeaza job");
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

test("drainOutbox: livrarea reusita inregistreaza dedupeKey in istoricul de trimiteri", async () => {
  const job: OutboxJob = { _id: "j1", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0, dedupeKey: "k1" };
  const { runtime, deleted, sentKeys } = makeRuntime([job]);
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => ({ ok: true }),
    recordDeadLetter: async () => undefined,
    maxAttempts: 5, backoffMs: 1000, limit: 50
  });
  assert.equal(result.sent, 1);
  assert.ok(sentKeys.has("k1"), "dedupeKey marcat ca trimis inainte de stergerea jobului");
  assert.deepEqual(deleted, [{ _id: "j1" }]);
});

test("drainOutbox: job cu dedupeKey deja in istoric -> nu re-trimite (recovery dupa crash)", async () => {
  const job: OutboxJob = { _id: "j1", guildId: "g1", channelId: "c1", kind: "update", payload: {}, attempts: 0, dedupeKey: "k1" };
  const { runtime, deleted } = makeRuntime([job], ["k1"]);
  let delivered = 0;
  const result = await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => { delivered++; return { ok: true }; },
    recordDeadLetter: async () => undefined,
    maxAttempts: 5, backoffMs: 1000, limit: 50
  });
  assert.equal(delivered, 0, "nu se re-trimite ce e deja in istoricul de livrari");
  assert.equal(result.sent, 0);
  assert.deepEqual(deleted, [{ _id: "j1" }], "jobul ramas dupa crash e curatat fara re-trimitere");
});
