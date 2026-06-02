import test from "node:test";
import assert from "node:assert/strict";

const mongoose = require("mongoose");
const attachMongoModels = require("../infra/mongo/models");

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/discord-patch-bot-itest";

interface OutboxModel {
  syncIndexes(): Promise<unknown>;
  create(doc: Record<string, unknown>): Promise<unknown>;
  countDocuments(filter: Record<string, unknown>): Promise<number>;
  deleteMany(filter: Record<string, unknown>): Promise<unknown>;
}

function getOutboxModel(): OutboxModel {
  try {
    const target: Record<string, unknown> = {
      mongoose,
      SUPPORTED_CURRENCIES: { USD: {} },
      DEFAULT_CURRENCY: "USD",
      ONE_DAY_MS: 86_400_000
    };
    attachMongoModels(target);
    if (target.NotificationOutboxModel) return target.NotificationOutboxModel as OutboxModel;
  } catch {  }
  return mongoose.model("NotificationOutbox") as unknown as OutboxModel;
}

let connected = false;
const ready = (async () => {
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 2000 });
    connected = true;
  } catch {
    connected = false;
  }
})();

test("real Mongo: indexul unic sparse pe dedupeKey respinge al doilea job pending cu acelasi dedupeKey", async (t) => {
  await ready;
  if (!connected) { t.skip("MongoDB indisponibil (porneste un Mongo si seteaza MONGO_URI)"); return; }
  const Model = getOutboxModel();
  const dedupeKey = `itest-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await Model.syncIndexes();
    await Model.create({ guildId: "itest", channelId: "c1", kind: "update", payload: {}, attempts: 0, dedupeKey, createdAt: new Date(), availableAt: new Date() });
    let code: number | undefined;
    try {
      await Model.create({ guildId: "itest", channelId: "c2", kind: "update", payload: { y: 1 }, attempts: 0, dedupeKey, createdAt: new Date(), availableAt: new Date() });
    } catch (err) {
      code = (err as { code?: number }).code;
    }
    assert.equal(code, 11000, "al doilea insert cu acelasi dedupeKey trebuie respins cu E11000 de indexul unic");
  } finally {
    await Model.deleteMany({ dedupeKey });
  }
});

test("real Mongo: doua joburi fara dedupeKey pot coexista (indexul sparse nu indexeaza absenta)", async (t) => {
  await ready;
  if (!connected) { t.skip("MongoDB indisponibil"); return; }
  const Model = getOutboxModel();
  const marker = `itest-nodedupe-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await Model.syncIndexes();
    await Model.create({ guildId: marker, channelId: "c1", kind: "update", payload: {}, attempts: 0, createdAt: new Date(), availableAt: new Date() });
    await Model.create({ guildId: marker, channelId: "c2", kind: "update", payload: {}, attempts: 0, createdAt: new Date(), availableAt: new Date() });
    const count = await Model.countDocuments({ guildId: marker });
    assert.equal(count, 2, "indexul e sparse -> joburile fara dedupeKey nu se ciocnesc");
  } finally {
    await Model.deleteMany({ guildId: marker });
  }
});

test("real Mongo: inchide conexiunea de test", async (t) => {
  if (!connected) { t.skip("MongoDB indisponibil"); return; }
  await mongoose.disconnect();
});
