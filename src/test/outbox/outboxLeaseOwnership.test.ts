import test from "node:test";
import assert from "node:assert/strict";
import { createOutboxRepository } from "../../features/notifications/outboxRepository.js";
import { createOutboxRuntime } from "../../features/notifications/notificationOutbox.js";
import type { OutboxJob } from "../../features/notifications/outboxTypes.js";
import type { OutboxModelMock, OutboxSentModelMock } from "../outboxTestKit.js";

function casModel(doc: { _id: string; lockedBy: string; leaseVersion: number }): OutboxModelMock {
  const matchesLease = (filter: Record<string, unknown>): boolean =>
    filter._id === doc._id
    && (filter.lockedBy === undefined || filter.lockedBy === doc.lockedBy)
    && (filter.leaseVersion === undefined || filter.leaseVersion === doc.leaseVersion);
  return {
    create: async d => d,
    findOneAndUpdate: async () => null,
    find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }),
    deleteOne: async (filter: Record<string, unknown>) => ({ deletedCount: matchesLease(filter) ? 1 : 0 }),
    updateOne: async (filter: Record<string, unknown>) => ({ modifiedCount: matchesLease(filter) ? 1 : 0, matchedCount: matchesLease(filter) ? 1 : 0 }),
    countDocuments: async () => 0
  };
}

const sentModel: OutboxSentModelMock = { exists: async () => null, updateOne: async () => ({ upsertedCount: 1 }) };

function makeRepo(doc: { _id: string; lockedBy: string; leaseVersion: number }) {
  return createOutboxRepository({ NotificationOutboxModel: casModel(doc), NotificationOutboxSentModel: sentModel, withMongoRetry: async <T>(fn: () => Promise<T>) => fn() });
}

test("finalizeJob e no-op daca leaseVersion nu mai corespunde (worker cu lease expirat nu suprascrie jobul preluat de altul)", async () => {
  const repo = makeRepo({ _id: "j1", lockedBy: "B", leaseVersion: 5 });
  const stale = await repo.finalizeJob({ _id: "j1", lockedBy: "A", leaseVersion: 4 }, "delivered", new Date());
  assert.equal(stale, 0, "workerul A (lease vechi) nu finalizeaza jobul preluat de B");
  const owner = await repo.finalizeJob({ _id: "j1", lockedBy: "B", leaseVersion: 5 }, "delivered", new Date());
  assert.equal(owner, 1, "proprietarul curent al lease-ului finalizeaza cu succes");
});

test("scheduleRetry si deleteJob folosesc si ele compare-and-set pe lease", async () => {
  const repo = makeRepo({ _id: "j1", lockedBy: "B", leaseVersion: 5 });
  assert.equal(await repo.scheduleRetry({ _id: "j1", lockedBy: "A", leaseVersion: 4 }, 1, new Date()), 0, "reprogramarea unui worker fara lease e no-op");
  assert.equal(await repo.deleteJob({ _id: "j1", lockedBy: "A", leaseVersion: 4 }), 0, "stergerea unui worker fara lease e no-op");
  assert.equal(await repo.scheduleRetry({ _id: "j1", lockedBy: "B", leaseVersion: 5 }, 1, new Date()), 1, "proprietarul reprogrameaza");
});

test("drainOutbox semnaleaza leaseLost cand finalizarea unei livrari pierde compare-and-set-ul", async () => {
  const job: OutboxJob = { _id: "j1", guildId: "g1", channelId: "c1", kind: "update", payload: { content: "x" }, attempts: 0, dedupeKey: "d1" };
  let served = 0;
  const model: OutboxModelMock = {
    create: async d => d,
    findOneAndUpdate: async () => (served++ === 0 ? { ...job, lockedBy: "A", leaseVersion: 1, status: "leased" } : null),
    find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }),
    deleteOne: async () => ({ deletedCount: 0 }),
    updateOne: async () => ({ modifiedCount: 0, matchedCount: 0 }),
    countDocuments: async () => 0
  };
  const runtime = createOutboxRuntime({ NotificationOutboxModel: model, NotificationOutboxSentModel: sentModel, withMongoRetry: async <T>(fn: () => Promise<T>) => fn(), logger: () => undefined });
  const result = await runtime.drainOutbox({ deliver: async () => ({ ok: true }), recordDeadLetter: async () => undefined, maxAttempts: 5, backoffMs: 1000, limit: 10 });
  assert.equal(result.sent, 1, "mesajul a fost livrat extern (se numara ca trimis)");
  assert.equal(result.leaseLost, 1, "finalizarea a pierdut compare-and-set-ul (alt worker detine jobul) si e semnalata explicit");
});
