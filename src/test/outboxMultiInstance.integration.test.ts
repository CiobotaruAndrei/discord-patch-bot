import test from "node:test";
import assert from "node:assert/strict";
import { createOutboxRuntime, DeliverResult } from "../features/notifications/notificationOutbox";
import type { Model } from "mongoose";

const mongoose = require("mongoose") as typeof import("mongoose");
const attachMongoModels = require("../infra/mongo/models");

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/discord-patch-bot-itest";

type OutboxModel = Model<Record<string, unknown>>;

function getModels(): { outbox: OutboxModel; sent: OutboxModel } {
  let outbox: unknown;
  let sent: unknown;
  try {
    const target: Record<string, unknown> = {
      mongoose,
      SUPPORTED_CURRENCIES: { USD: {} },
      DEFAULT_CURRENCY: "USD",
      ONE_DAY_MS: 86_400_000,
      env: { GUILD_SEEN_DISCOUNT_TTL_DAYS: 60, NOTIFICATION_OUTBOX_SENT_TTL_HOURS: 24, NOTIFICATION_HISTORY_TTL_DAYS: 30, FEEDBACK_REPORT_TTL_DAYS: 90, NOTIFICATION_DEAD_LETTER_REPLAY_TTL_DAYS: 7 }
    };
    attachMongoModels(target);
    outbox = target.NotificationOutboxModel;
    sent = target.NotificationOutboxSentModel;
  } catch {  }
  return {
    outbox: (outbox ?? mongoose.model("NotificationOutbox")) as OutboxModel,
    sent: (sent ?? mongoose.model("NotificationOutboxSent")) as OutboxModel
  };
}

let connected = false;
const ready = (async () => {
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 2000, dbName: "discord-patch-bot-itest-multiinstance" });
    connected = true;
  } catch {
    connected = false;
  }
})();

test("real Mongo: doi workeri care drenaza simultan NU livreaza acelasi job de doua ori (lease atomic)", async (t) => {
  await ready;
  if (!connected) { t.skip("MongoDB indisponibil (porneste un Mongo si seteaza MONGO_URI)"); return; }
  const { outbox, sent } = getModels();
  const marker = `itest-multi-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const jobCount = 25;
  try {
    await outbox.syncIndexes();
    const past = new Date(Date.now() - 1000);
    for (let i = 0; i < jobCount; i++) {
      await outbox.create({
        guildId: marker, channelId: "c1", kind: "update", payload: { i },
        attempts: 0, dedupeKey: `${marker}-${i}`, createdAt: past, availableAt: past
      });
    }

    const runtime = createOutboxRuntime({
      NotificationOutboxModel: outbox,
      NotificationOutboxSentModel: sent,
      withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
      logger: () => undefined
    });

    const deliveredCounts = new Map<string, number>();
    let totalDelivered = 0;
    const deliver = async (job: { dedupeKey?: string }): Promise<DeliverResult> => {
      const key = String(job.dedupeKey);
      deliveredCounts.set(key, (deliveredCounts.get(key) || 0) + 1);
      totalDelivered++;
      return { ok: true };
    };
    const baseOptions = { deliver, recordDeadLetter: async () => undefined, maxAttempts: 5, backoffMs: 1000, limit: jobCount };

    const [a, b] = await Promise.all([
      runtime.drainOutbox({ ...baseOptions, workerId: "instance-A" }),
      runtime.drainOutbox({ ...baseOptions, workerId: "instance-B" })
    ]);

    assert.equal(totalDelivered, jobCount, "fiecare job livrat exact o data, in total");
    for (const [key, count] of deliveredCounts) {
      assert.equal(count, 1, `jobul ${key} a fost livrat o singura data (fara duplicat de la al doilea worker)`);
    }
    assert.equal(deliveredCounts.size, jobCount, "toate joburile au fost livrate");
    assert.equal(a.sent + b.sent, jobCount, "suma livrarilor celor doi workeri = numarul de joburi");
    assert.equal(await outbox.countDocuments({ guildId: marker }), 0, "coada e goala dupa drenare");
  } finally {
    await outbox.deleteMany({ guildId: marker });
    const sentModel = sent as { deleteMany(filter: Record<string, unknown>): Promise<unknown> };
    for (let i = 0; i < jobCount; i++) await sentModel.deleteMany({ dedupeKey: `${marker}-${i}` }).catch(() => undefined);
  }
});

test("real Mongo: inchide conexiunea de test", async (t) => {
  if (!connected) { t.skip("MongoDB indisponibil"); return; }
  await mongoose.disconnect();
});
