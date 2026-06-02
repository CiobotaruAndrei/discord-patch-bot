import test from "node:test";
import assert from "node:assert/strict";
import {
  createOutboxRuntime,
  applyDedupeMarker,
  messageHasDedupeMarker,
  outboxDedupeMarker
} from "../features/notifications/notificationOutbox";
import { createOutboxDelivery } from "../features/notifications/outboxDelivery";

const { createOutboundChannelResolver } = require("../features/notifications/outboundChannel") as {
  createOutboundChannelResolver: (deps: Record<string, unknown>) => (args: Record<string, unknown>) => Promise<{ channel: { send: (payload: unknown) => Promise<unknown> } | null; abort: boolean }>;
};

interface OutboxJobDoc {
  _id: string;
  guildId: string;
  channelId: string;
  kind: "update" | "discount";
  payload: unknown;
  attempts: number;
  deliveries?: number;
  dedupeKey?: string;
  recoveryVerify?: boolean;
  availableAt?: Date;
  createdAt?: Date;
  lockedUntil?: Date | null;
  lockedBy?: string;
}

function makeInMemoryOutbox() {
  const jobs: OutboxJobDoc[] = [];
  const sent = new Set<string>();
  let idCounter = 0;

  function isAvailable(job: OutboxJobDoc, now: Date): boolean {
    const availableOk = !job.availableAt || job.availableAt.getTime() <= now.getTime();
    const lockOk = !job.lockedUntil || job.lockedUntil.getTime() <= now.getTime();
    return availableOk && lockOk;
  }

  const NotificationOutboxModel = {
    create: async (doc: Record<string, unknown>) => {
      const job = { _id: `job-${++idCounter}`, ...doc } as OutboxJobDoc;
      jobs.push(job);
      return job;
    },
    findOneAndUpdate: async (filter: { availableAt?: { $lte?: Date } }, update: { $set?: Record<string, unknown>; $inc?: { deliveries?: number } }) => {
      const now = filter?.availableAt?.$lte ?? new Date();
      const job = jobs.find(j => isAvailable(j, now));
      if (!job) return null;
      if (update.$set) Object.assign(job, update.$set);
      if (update.$inc?.deliveries) job.deliveries = (job.deliveries || 0) + update.$inc.deliveries;
      return job;
    },
    find: () => ({ sort: () => ({ limit: () => ({ lean: async () => jobs.slice() }) }) }),
    deleteOne: async (filter: { _id: string }) => {
      const i = jobs.findIndex(j => j._id === filter._id);
      if (i >= 0) jobs.splice(i, 1);
      return { deletedCount: i >= 0 ? 1 : 0 };
    },
    updateOne: async (filter: { _id: string }, update: { $set?: Record<string, unknown>; $unset?: Record<string, string> }) => {
      const job = jobs.find(j => j._id === filter._id);
      if (job) {
        if (update.$set) Object.assign(job, update.$set);
        if (update.$unset) for (const key of Object.keys(update.$unset)) delete (job as unknown as Record<string, unknown>)[key];
      }
      return { matchedCount: job ? 1 : 0 };
    },
    countDocuments: async () => jobs.length
  };

  const NotificationOutboxSentModel = {
    exists: async (filter: { dedupeKey: string }) => (sent.has(filter.dedupeKey) ? { _id: filter.dedupeKey } : null),
    updateOne: async (filter: { dedupeKey: string }) => { sent.add(filter.dedupeKey); return { upsertedCount: 1 }; }
  };

  return { NotificationOutboxModel, NotificationOutboxSentModel, jobs, sent };
}

test("E2E outbox: cron -> enqueue (cu recoveryVerify) -> drain -> delivery -> markSent -> job sters", async () => {
  const store = makeInMemoryOutbox();
  const runtime = createOutboxRuntime({
    NotificationOutboxModel: store.NotificationOutboxModel as never,
    NotificationOutboxSentModel: store.NotificationOutboxSentModel as never,
    withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
    logger: () => undefined
  });

  const resolveOutboundChannel = createOutboundChannelResolver({
    logger: () => undefined,
    canSendEmbeds: () => true,
    enqueueOutbox: runtime.enqueueOutbox
  });

  const resolverClient = {
    user: { id: "bot-1" },
    channels: { fetch: async () => ({ id: "chan-1", send: async () => ({ id: "noop" }) }) }
  };

  const resolved = await resolveOutboundChannel({
    client: resolverClient,
    guild: { _id: "guild-1", outboxRecoveryVerify: true },
    channelId: "chan-1",
    context: "CRON_UPDATES",
    disableFn: async () => undefined
  });
  assert.equal(resolved.abort, false, "canal rezolvat, fara abort");
  assert.ok(resolved.channel, "canal outbox returnat");

  await resolved.channel!.send({ embeds: [{ title: "Patch 1.2", footer: { text: "joc" } }] });

  assert.equal(await store.NotificationOutboxModel.countDocuments(), 1, "send-ul a pus un job in coada");
  const dedupeKey = String(store.jobs[0].dedupeKey);
  assert.match(dedupeKey, /^[0-9a-f]{64}$/, "jobul are dedupeKey SHA-256");
  assert.equal(store.jobs[0].recoveryVerify, true, "jobul poarta recoveryVerify din setarea guild-ului");

  const delivered: Array<{ embeds?: Array<{ footer?: { text?: string } }> }> = [];
  const deliveryChannel = { id: "chan-1", send: async (payload: unknown) => { delivered.push(payload as never); return { id: "msg-1" }; } };
  const deliveryClient = { user: { id: "bot-1" }, channels: { fetch: async () => deliveryChannel } };

  const delivery = createOutboxDelivery({
    canSendEmbeds: () => true,
    isPermanentDiscordError: () => false,
    acquireSendSlot: async () => undefined,
    applyDedupeMarker, messageHasDedupeMarker, outboxDedupeMarker,
    recoveryVerify: true
  });

  const result = await runtime.drainOutbox({
    deliver: (job) => delivery.deliver(deliveryClient as never, job as never),
    recordDeadLetter: async () => undefined,
    maxAttempts: 5, backoffMs: 1000, limit: 50
  });

  assert.equal(result.sent, 1, "un job livrat");
  assert.equal(result.deadLettered, 0);
  assert.equal(result.retried, 0);
  assert.equal(delivered.length, 1, "mesajul a ajuns pe canalul Discord");
  assert.ok(messageHasDedupeMarker(delivered[0], outboxDedupeMarker(dedupeKey)), "embed-ul livrat poarta marker-ul dedupeKey");
  assert.ok(store.sent.has(dedupeKey), "markSent a inregistrat dedupeKey in istoric");
  assert.equal(await store.NotificationOutboxModel.countDocuments(), 0, "jobul a fost sters dupa livrare");
});

test("E2E outbox: re-enqueue acelasi continut dupa livrare e idempotent (nu reapare in coada)", async () => {
  const store = makeInMemoryOutbox();
  const runtime = createOutboxRuntime({
    NotificationOutboxModel: store.NotificationOutboxModel as never,
    NotificationOutboxSentModel: store.NotificationOutboxSentModel as never,
    withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
    logger: () => undefined
  });

  const payload = { embeds: [{ title: "Patch 1.2" }] };
  await runtime.enqueueOutbox({ guildId: "guild-1", channelId: "chan-1", kind: "update", payload });

  const deliveryChannel = { id: "chan-1", send: async () => ({ id: "msg-1" }) };
  const deliveryClient = { user: { id: "bot-1" }, channels: { fetch: async () => deliveryChannel } };
  const delivery = createOutboxDelivery({
    canSendEmbeds: () => true,
    isPermanentDiscordError: () => false,
    acquireSendSlot: async () => undefined,
    applyDedupeMarker, messageHasDedupeMarker, outboxDedupeMarker,
    recoveryVerify: false
  });
  await runtime.drainOutbox({
    deliver: (job) => delivery.deliver(deliveryClient as never, job as never),
    recordDeadLetter: async () => undefined,
    maxAttempts: 5, backoffMs: 1000, limit: 50
  });
  assert.equal(await store.NotificationOutboxModel.countDocuments(), 0, "livrat si sters");

  await runtime.enqueueOutbox({ guildId: "guild-1", channelId: "chan-1", kind: "update", payload });
  assert.equal(await store.NotificationOutboxModel.countDocuments(), 0, "acelasi continut deja livrat -> nu se re-enqueue");
});
