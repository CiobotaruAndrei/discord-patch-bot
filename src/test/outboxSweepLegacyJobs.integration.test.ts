import test from "node:test";
import assert from "node:assert/strict";
import { createOutboxRuntime } from "../features/notifications/notificationOutbox";
import type { OutboxJob } from "../features/notifications/notificationOutbox";
import type { Model } from "mongoose";

const mongoose = require("mongoose") as typeof import("mongoose");
const attachMongoModels = require("../infra/mongo/models");

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/discord-patch-bot-itest";

type SweepTestModel = Model<Record<string, unknown>>;

function getModels(): { outbox: SweepTestModel; sent: SweepTestModel } {
  try {
    const target: Record<string, unknown> = {
      mongoose,
      SUPPORTED_CURRENCIES: { USD: {} },
      DEFAULT_CURRENCY: "USD",
      ONE_DAY_MS: 86_400_000,
      env: { GUILD_SEEN_DISCOUNT_TTL_DAYS: 60, NOTIFICATION_OUTBOX_SENT_TTL_HOURS: 24, NOTIFICATION_HISTORY_TTL_DAYS: 30, FEEDBACK_REPORT_TTL_DAYS: 90, NOTIFICATION_DEAD_LETTER_REPLAY_TTL_DAYS: 7 }
    };
    Object.assign(target, attachMongoModels.buildFrom(target));
    if (target.NotificationOutboxModel) {
      return { outbox: target.NotificationOutboxModel as SweepTestModel, sent: target.NotificationOutboxSentModel as SweepTestModel };
    }
  } catch {  }
  return {
    outbox: mongoose.model("NotificationOutbox") as SweepTestModel,
    sent: mongoose.model("NotificationOutboxSent") as SweepTestModel
  };
}

let connected = false;
const ready = (async () => {
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 2000, dbName: "discord-patch-bot-itest-sweep" });
    connected = true;
  } catch {
    connected = false;
  }
})();

test("real Mongo: sweep-ul expired-near-ttl prinde si joburile legacy FARA campul lockedUntil (semantica null-equality, review #3 respins)", async (t) => {
  await ready;
  if (!connected) { t.skip("MongoDB indisponibil (porneste un Mongo si seteaza MONGO_URI)"); return; }

  const { outbox, sent } = getModels();
  const guildMarker = `itest-sweep-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const now = Date.now();
  const maxAgeMs = 3_600_000;
  const oldCreatedAt = new Date(now - 2 * maxAgeMs);
  const notClaimableYet = new Date(now + maxAgeMs);

  try {
    await outbox.collection.insertOne({
      guildId: guildMarker, channelId: "c-legacy", kind: "update", payload: { x: 1 },
      attempts: 0, deliveries: 0, availableAt: notClaimableYet, createdAt: oldCreatedAt
    });
    await outbox.collection.insertOne({
      guildId: guildMarker, channelId: "c-null", kind: "update", payload: { x: 2 },
      attempts: 0, deliveries: 0, availableAt: notClaimableYet, createdAt: oldCreatedAt,
      lockedUntil: null, lockedBy: null
    });
    await outbox.collection.insertOne({
      guildId: guildMarker, channelId: "c-leased", kind: "update", payload: { x: 3 },
      attempts: 0, deliveries: 0, availableAt: notClaimableYet, createdAt: oldCreatedAt,
      lockedUntil: new Date(now + 10 * 60_000), lockedBy: "alt-worker"
    });

    const deadLettered: Array<{ channelId: string; reason: string }> = [];
    const runtime = createOutboxRuntime({
      NotificationOutboxModel: outbox,
      NotificationOutboxSentModel: sent,
      withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
      logger: () => undefined
    });

    const result = await runtime.drainOutbox({
      deliver: async () => ({ ok: true }),
      recordDeadLetter: async (job: OutboxJob, reason: string) => {
        if (job.guildId === guildMarker) deadLettered.push({ channelId: String(job.channelId), reason });
      },
      maxAttempts: 5,
      backoffMs: 1000,
      limit: 20,
      maxAgeMs
    });

    const sweptChannels = deadLettered.map(entry => entry.channelId).sort();
    assert.deepEqual(sweptChannels, ["c-legacy", "c-null"],
      "claim-ul mentioneaza explicit $exists:false, dar sweep-ul cu { lockedUntil: null } prinde DEJA si campul lipsa: null-equality din MongoDB face match pe null SI pe missing");
    assert.ok(deadLettered.every(entry => entry.reason === "expired-near-ttl"));
    assert.ok(result.expired >= 2, "ambele joburi lease-free au fost expirate de sweep");

    const remaining = await outbox.countDocuments({ guildId: guildMarker });
    assert.equal(remaining, 1, "jobul cu lease activa NU este maturat (conditia lease-free il protejeaza)");
  } finally {
    await outbox.deleteMany({ guildId: guildMarker });
  }
});

test("real Mongo: inchide conexiunea de test", async (t) => {
  await ready;
  if (!connected) { t.skip("MongoDB indisponibil"); return; }
  await mongoose.disconnect();
});
