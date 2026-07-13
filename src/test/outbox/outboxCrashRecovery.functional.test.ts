import test from "node:test";
import assert from "node:assert/strict";
import {
  createOutboxRuntime,
  applyDedupeMarker,
  messageHasDedupeMarker,
  outboxDedupeMarker
} from "../../features/notifications/notificationOutbox.js";
import { createOutboxDelivery } from "../../features/notifications/outboxDelivery.js";
import type { OutboxDeliveryClient } from "../../features/notifications/outboxDelivery.js";
import type { OutboxJob } from "../../features/notifications/notificationOutbox.js";
type OutboxRuntimeDeps = Parameters<typeof createOutboxRuntime>[0];
type OutboxModelMock = OutboxRuntimeDeps["NotificationOutboxModel"];
type OutboxSentModelMock = OutboxRuntimeDeps["NotificationOutboxSentModel"];

type OutboxJobDoc = OutboxJob & {
  _id: string;
  lockedUntil?: Date | null;
  lockedBy?: string;
  [key: string]: unknown;
};

function makeStore() {
  const jobs: OutboxJobDoc[] = [];
  const sent = new Set<string>();
  let idCounter = 0;
  function available(job: OutboxJobDoc, now: Date): boolean {
    const availableOk = !job.availableAt || job.availableAt.getTime() <= now.getTime();
    const lockOk = !job.lockedUntil || job.lockedUntil.getTime() <= now.getTime();
    return availableOk && lockOk;
  }
  const model: OutboxModelMock = {
    create: async (doc: Record<string, unknown>) => { const job = { _id: `job-${++idCounter}`, ...doc } as OutboxJobDoc; jobs.push(job); return job; },
    findOneAndUpdate: async (filter: { availableAt?: { $lte?: Date } }, update: { $set?: Record<string, unknown>; $inc?: { deliveries?: number } }) => {
      const now = filter?.availableAt?.$lte ?? new Date();
      const job = jobs.find(j => available(j, now));
      if (!job) return null;
      if (update.$set) Object.assign(job, update.$set);
      if (update.$inc?.deliveries) job.deliveries = (job.deliveries || 0) + update.$inc.deliveries;
      return job;
    },
    find: () => ({ sort: () => ({ limit: () => ({ lean: async () => jobs.slice() }) }) }),
    deleteOne: async (filter: { _id: string }) => { const i = jobs.findIndex(j => j._id === filter._id); if (i >= 0) jobs.splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 }; },
    updateOne: async (filter: { _id: string }, update: { $set?: Record<string, unknown>; $unset?: Record<string, string> }) => {
      const job = jobs.find(j => j._id === filter._id);
      if (job) {
        if (update.$set) Object.assign(job, update.$set);
        if (update.$unset) for (const key of Object.keys(update.$unset)) delete job[key];
      }
      return { matchedCount: job ? 1 : 0 };
    },
    countDocuments: async () => jobs.length
  };
  const sentModel: OutboxSentModelMock = {
    exists: async (filter: { dedupeKey: string }) => (sent.has(filter.dedupeKey) ? { _id: filter.dedupeKey } : null),
    updateOne: async (filter: { dedupeKey: string }) => { sent.add(filter.dedupeKey); return { upsertedCount: 1 }; }
  };
  return { model, sentModel, jobs, sent };
}

function makeChannel() {
  const sentPayloads: unknown[] = [];
  const channel = {
    id: "c1",
    send: async (payload: unknown) => { sentPayloads.push(payload); return { id: `m${sentPayloads.length}` }; },
    messages: { fetch: async (opts: { limit?: number }) => sentPayloads.slice(-(opts?.limit ?? 50)) }
  };
  const client: OutboxDeliveryClient = { isReady: () => true, user: { id: "bot-1" }, channels: { fetch: async () => channel } };
  return { client, sentPayloads };
}

function makeDelivery(recoveryVerify: boolean) {
  return createOutboxDelivery({
    canSendEmbeds: () => true,
    isPermanentDiscordError: () => false,
    acquireSendSlot: async () => undefined,
    applyDedupeMarker, messageHasDedupeMarker, outboxDedupeMarker,
    recoveryVerify
  });
}

test("crash-sim cu recovery-verify: send reuseste, markSent esueaza/crash, worker repornit NU duplica", async () => {
  const store = makeStore();
  const runtime = createOutboxRuntime({
    NotificationOutboxModel: store.model,
    NotificationOutboxSentModel: store.sentModel,
    withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
    logger: () => undefined
  });
  const { client, sentPayloads } = makeChannel();
  const delivery = makeDelivery(true);

  await runtime.enqueueOutbox({ guildId: "g1", channelId: "c1", kind: "update", payload: { embeds: [{ title: "Patch 1.2" }] }, recoveryVerify: true });

  const origDelete = store.model.deleteOne;
  const origSentUpdate = store.sentModel.updateOne;
  store.model.deleteOne = async () => { throw new Error("crash inainte de delete"); };
  store.sentModel.updateOne = async () => { throw new Error("crash inainte de markSent"); };
  const crashResult = await runtime.drainOutbox({
    deliver: (job) => delivery.deliver(client, job),
    recordDeadLetter: async () => undefined,
    maxAttempts: 5, backoffMs: 1000, limit: 1
  });
  store.model.deleteOne = origDelete;
  store.sentModel.updateOne = origSentUpdate;

  assert.equal(crashResult.markSentFailures, 1, "markSent a esuat in fereastra de crash");
  assert.equal(crashResult.deleteFailures, 1, "stergerea a esuat (crash), dar drain-ul a contorizat fara sa arunce");
  assert.equal(sentPayloads.length, 1, "mesajul a fost trimis o data inainte de crash");
  assert.equal(await store.model.countDocuments(), 1, "jobul a ramas in coada (markSent si delete nu s-au facut)");
  assert.equal(store.sent.size, 0, "markSent nu a apucat sa scrie in istoric (fereastra de risc)");

  store.jobs[0].lockedUntil = undefined;

  const result = await runtime.drainOutbox({
    deliver: (job) => delivery.deliver(client, job),
    recordDeadLetter: async () => undefined,
    maxAttempts: 5, backoffMs: 1000, limit: 5
  });

  assert.equal(sentPayloads.length, 1, "recovery-verify a gasit marker-ul in istoric -> NU re-trimite (zero duplicate)");
  assert.equal(result.recoveryDuplicates, 1, "drenarea numara un duplicat prevenit");
  assert.equal(await store.model.countDocuments(), 0, "jobul recuperat e curatat fara re-trimitere");
});

test("crash-sim FARA recovery-verify: aceeasi scapare produce un duplicat (demonstreaza valoarea recovery-verify)", async () => {
  const store = makeStore();
  const runtime = createOutboxRuntime({
    NotificationOutboxModel: store.model,
    NotificationOutboxSentModel: store.sentModel,
    withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
    logger: () => undefined
  });
  const { client, sentPayloads } = makeChannel();
  const delivery = makeDelivery(false);

  await runtime.enqueueOutbox({ guildId: "g1", channelId: "c1", kind: "update", payload: { embeds: [{ title: "Patch 1.2" }] } });

  const origDelete = store.model.deleteOne;
  const origSentUpdate = store.sentModel.updateOne;
  store.model.deleteOne = async () => { throw new Error("crash inainte de delete"); };
  store.sentModel.updateOne = async () => { throw new Error("crash inainte de markSent"); };
  const crashResult = await runtime.drainOutbox({
    deliver: (job) => delivery.deliver(client, job),
    recordDeadLetter: async () => undefined,
    maxAttempts: 5, backoffMs: 1000, limit: 1
  });
  store.model.deleteOne = origDelete;
  store.sentModel.updateOne = origSentUpdate;
  assert.equal(crashResult.deleteFailures, 1, "stergerea a esuat in crash, dar drain-ul a contorizat fara sa arunce");
  assert.equal(sentPayloads.length, 1);

  store.jobs[0].lockedUntil = undefined;

  await runtime.drainOutbox({
    deliver: (job) => delivery.deliver(client, job),
    recordDeadLetter: async () => undefined,
    maxAttempts: 5, backoffMs: 1000, limit: 5
  });

  assert.equal(sentPayloads.length, 2, "fara recovery-verify, jobul recuperat dupa crash se re-trimite -> duplicat");
});
