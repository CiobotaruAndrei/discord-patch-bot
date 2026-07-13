import test from "node:test";
import assert from "node:assert/strict";

import mongoose from "mongoose";
import attachMongoModels from "../../infra/mongo/models.js";
import type { MongoModelsContext } from "../../infra/mongo/models.js";

type SchemaIndex = [Record<string, unknown>, Record<string, unknown>];

interface SchemaLike {
  schema: { indexes(): SchemaIndex[] };
}

function attachOnce(): Record<string, unknown> {
  const target: Record<string, unknown> = {
    mongoose,
    SUPPORTED_CURRENCIES: { USD: {} },
    DEFAULT_CURRENCY: "USD",
    ONE_DAY_MS: 86_400_000,
    env: { GUILD_SEEN_DISCOUNT_TTL_DAYS: 45, NOTIFICATION_OUTBOX_SENT_TTL_HOURS: 24, NOTIFICATION_HISTORY_TTL_DAYS: 30, FEEDBACK_REPORT_TTL_DAYS: 90, NOTIFICATION_DEAD_LETTER_REPLAY_TTL_DAYS: 7 }
  };
  try {
    Object.assign(target, attachMongoModels.buildFrom(target as MongoModelsContext));
  } catch {  }
  return target;
}

function getModel(target: Record<string, unknown>, key: string, modelName: string): SchemaLike {
  if (target[key]) return target[key] as SchemaLike;
  return mongoose.model(modelName);
}

function findTtlSeconds(model: SchemaLike, field: string): number | null {
  for (const entry of model.schema.indexes()) {
    const keys = entry[0] || {};
    const opts = entry[1] || {};
    if (keys[field] === 1 && typeof opts.expireAfterSeconds === "number") {
      return opts.expireAfterSeconds as number;
    }
  }
  return null;
}

test("GuildSeenDiscount: index TTL pe seenAt mentine setul de dedup marginit (clamp 30..365 zile, default 60)", () => {
  const target = attachOnce();
  const model = getModel(target, "GuildSeenDiscountModel", "GuildSeenDiscount");
  const ttl = findTtlSeconds(model, "seenAt");
  assert.notEqual(ttl, null, "GuildSeenDiscount trebuie sa aiba index TTL pe seenAt");
  assert.equal(ttl, 45 * 86_400, "TTL-ul schemei provine din env.GUILD_SEEN_DISCOUNT_TTL_DAYS injectat (45 zile), nu din process.env citit local");
});

test("GuildSeenUpdate: NU are TTL pe seenAt (latest poate ramane valid la nesfarsit -> un TTL ar re-notifica jocurile dormante)", () => {
  const target = attachOnce();
  const model = getModel(target, "GuildSeenUpdateModel", "GuildSeenUpdate");
  const ttl = findTtlSeconds(model, "seenAt");
  assert.equal(ttl, null, "GuildSeenUpdate nu trebuie sa expire: ar reaparea ca nevazut si ar re-trimite patch-ul curent al jocurilor inactive");
});
