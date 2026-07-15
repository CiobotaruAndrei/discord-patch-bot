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

test("drainOutbox: confirmarea livrarii (markDeliveryAccepted) care pierde compare-and-set-ul semnaleaza leaseLost si opreste drain-ul", async () => {
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
  assert.equal(result.leaseLost, 1, "confirmarea livrarii a pierdut compare-and-set-ul (alt worker detine jobul) si e semnalata explicit");
  assert.equal(result.sent, 1, "mesajul a fost livrat extern (se numara ca trimis)");
});

test("drainOutbox: finalizeDelivered care pierde compare-and-set-ul (dupa markDeliveryAccepted reusit) propaga leaseLost si OPRESTE drain-ul - rezultatul CAS nu mai e ignorat (review nou, Major #1)", async () => {
  const job1: OutboxJob = { _id: "j1", guildId: "g1", channelId: "c1", kind: "update", payload: { content: "x" }, attempts: 0, dedupeKey: "d1" };
  const job2: OutboxJob = { _id: "j2", guildId: "g1", channelId: "c1", kind: "update", payload: { content: "y" }, attempts: 0, dedupeKey: "d2" };
  const claims = [job1, job2];
  let served = 0;
  let delivered = 0;
  const model: OutboxModelMock = {
    create: async d => d,
    findOneAndUpdate: async () => {
      const next = claims[served++];
      return next ? { ...next, lockedBy: "A", leaseVersion: 1, status: "leased" } : null;
    },
    find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }),
    deleteOne: async () => ({ deletedCount: 0 }),
    updateOne: async (_filter: Record<string, unknown>, update: { $set?: { status?: string } }) => {
      const ok = update.$set?.status === "delivered-pending";
      return { modifiedCount: ok ? 1 : 0, matchedCount: ok ? 1 : 0 };
    },
    countDocuments: async () => 0
  };
  const runtime = createOutboxRuntime({ NotificationOutboxModel: model, NotificationOutboxSentModel: sentModel, withMongoRetry: async <T>(fn: () => Promise<T>) => fn(), logger: () => undefined });
  const result = await runtime.drainOutbox({ deliver: async () => { delivered++; return { ok: true }; }, recordDeadLetter: async () => undefined, maxAttempts: 5, backoffMs: 1000, limit: 10 });
  assert.equal(result.leaseLost, 1, "finalizeDelivered a intors 'lease-lost' (CAS pierdut) si rezultatul e propagat, nu ignorat");
  assert.equal(result.sent, 1, "primul mesaj a fost livrat extern, se numara ca trimis");
  assert.equal(delivered, 1, "drain-ul s-a OPRIT dupa pierderea lease-ului: al doilea job nu mai e livrat (inainte de fix continua)");
});
