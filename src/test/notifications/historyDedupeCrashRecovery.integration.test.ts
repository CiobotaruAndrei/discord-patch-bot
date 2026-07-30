import test from "node:test";
import { createGuildSettingsEventBus } from "../../infra/mongo/guildSettingsEventBus.js";
import assert from "node:assert/strict";

import mongoose from "mongoose";
import attachMongoModels from "../../infra/mongo/models.js";
import type { MongoModelsContext } from "../../infra/mongo/models.js";
import { createHistoryRepository } from "../../features/notifications/historyRepository.js";

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/discord-patch-bot-itest";

interface HistoryModel {
  syncIndexes(): Promise<unknown>;
  countDocuments(filter: Record<string, unknown>): Promise<number>;
  deleteMany(filter: Record<string, unknown>): Promise<unknown>;
  insertMany(docs: unknown[], opts?: unknown): Promise<unknown>;
  bulkWrite(ops: unknown[], opts?: unknown): Promise<unknown>;
  find(filter: unknown, projection?: unknown): { sort(spec: unknown): { limit(count: number): { lean(): Promise<Array<Record<string, unknown>>> } } };
}

function getHistoryModel(): HistoryModel {
  try {
    const target: Record<string, unknown> = {
      mongoose,
      guildSettingsBus: createGuildSettingsEventBus(),
      SUPPORTED_CURRENCIES: { USD: {} },
      DEFAULT_CURRENCY: "USD",
      ONE_DAY_MS: 86_400_000,
      env: { GUILD_SEEN_DISCOUNT_TTL_DAYS: 60, NOTIFICATION_OUTBOX_SENT_TTL_HOURS: 24, NOTIFICATION_HISTORY_TTL_DAYS: 30, FEEDBACK_REPORT_TTL_DAYS: 90, NOTIFICATION_DEAD_LETTER_REPLAY_TTL_DAYS: 7 }
    };
    Object.assign(target, attachMongoModels.buildFrom(target as MongoModelsContext));
    if (target.NotificationHistoryModel) return target.NotificationHistoryModel as HistoryModel;
  } catch {  }
  return mongoose.model("NotificationHistory") as HistoryModel;
}

let connected = false;
const ready = (async () => {
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 2000, dbName: "discord-patch-bot-itest-history" });
    connected = true;
  } catch {
    connected = false;
  }
})();

const passThroughRetry = <T>(fn: () => Promise<T>): Promise<T> => fn();

test("real Mongo: re-livrarea aceluiasi job.history dupa crash recovery NU dubleaza intrarea din /history", async (t) => {
  await ready;
  if (!connected) { t.skip("MongoDB indisponibil (porneste un Mongo si seteaza MONGO_URI)"); return; }
  const Model = getHistoryModel();
  const guildId = `itest-history-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const repo = createHistoryRepository({ NotificationHistoryModel: Model, withMongoRetry: passThroughRetry, logger: () => undefined });
  const jobHistory = [{ kind: "update" as const, gameKey: "cs2", title: "Patch 1.2", link: `https://x/${guildId}` }];
  try {
    await Model.syncIndexes();
    await repo.recordSent(guildId, jobHistory);
    await repo.recordSent(guildId, jobHistory);
    await repo.recordSent(guildId, jobHistory);
    const count = await Model.countDocuments({ guildId });
    assert.equal(count, 1, "de 3 livrari (crash recovery / recoveryDuplicate) ramane un singur rand in /history datorita upsert-ului idempotent pe (guildId, dedupeKey)");
    const recent = await repo.getRecent(guildId, "all", 25);
    assert.equal(recent.length, 1, "/history arata o singura intrare");
    assert.equal(recent[0].link, `https://x/${guildId}`);
  } finally {
    await Model.deleteMany({ guildId });
  }
});

test("real Mongo: notificari diferite catre acelasi guild raman intrari distincte in /history", async (t) => {
  await ready;
  if (!connected) { t.skip("MongoDB indisponibil"); return; }
  const Model = getHistoryModel();
  const guildId = `itest-history-distinct-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const repo = createHistoryRepository({ NotificationHistoryModel: Model, withMongoRetry: passThroughRetry, logger: () => undefined });
  try {
    await Model.syncIndexes();
    await repo.recordSent(guildId, [{ kind: "update", gameKey: "cs2", title: "A", link: `https://x/a-${guildId}` }]);
    await repo.recordSent(guildId, [{ kind: "discount", gameKey: "cs2", title: "B", link: `https://x/b-${guildId}` }]);
    const count = await Model.countDocuments({ guildId });
    assert.equal(count, 2, "dedupeKey diferit (link/kind diferit) -> intrari distincte, dedup-ul nu colapseaza notificari reale");
  } finally {
    await Model.deleteMany({ guildId });
  }
});

test("real Mongo: inchide conexiunea de test (history)", async (t) => {
  if (!connected) { t.skip("MongoDB indisponibil"); return; }
  await mongoose.disconnect();
});
