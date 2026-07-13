import test from "node:test";
import assert from "node:assert/strict";

import mongoose from "mongoose";
import attachMongoModels from "../../infra/mongo/models.js";
import type { MongoModelsContext } from "../../infra/mongo/models.js";

interface OutboxModelLike {
  new (doc: Record<string, unknown>): { toObject(): Record<string, unknown> };
}

function getOutboxModel(): OutboxModelLike {
  try {
    const target: Record<string, unknown> = {
      mongoose,
      SUPPORTED_CURRENCIES: { USD: {} },
      DEFAULT_CURRENCY: "USD",
      ONE_DAY_MS: 86_400_000,
      env: { GUILD_SEEN_DISCOUNT_TTL_DAYS: 60, NOTIFICATION_OUTBOX_SENT_TTL_HOURS: 24, NOTIFICATION_HISTORY_TTL_DAYS: 30, FEEDBACK_REPORT_TTL_DAYS: 90, NOTIFICATION_DEAD_LETTER_REPLAY_TTL_DAYS: 7 }
    };
    Object.assign(target, attachMongoModels.buildFrom(target as MongoModelsContext));
    if (target.NotificationOutboxModel) return target.NotificationOutboxModel as OutboxModelLike;
  } catch {  }
  return mongoose.model("NotificationOutbox");
}

test("notificationOutbox: schema persista recoveryVerify / dedupeKey / deliveries (strict mode nu le sterge)", () => {
  const OutboxModel = getOutboxModel();
  const doc = new OutboxModel({
    guildId: "g1",
    channelId: "c1",
    kind: "update",
    payload: { x: 1 },
    dedupeKey: "k-1",
    deliveries: 2,
    recoveryVerify: true,
    history: [{ kind: "update", gameKey: "cs2", title: "Patch", link: "https://example.com", itemId: "u-77" }]
  });
  const obj = doc.toObject();
  assert.equal(obj.recoveryVerify, true, "recoveryVerify trebuie declarat in schema, altfel strict mode il sterge la salvare");
  assert.equal(obj.dedupeKey, "k-1", "dedupeKey persistat");
  assert.equal(obj.deliveries, 2, "deliveries persistat");
  assert.deepEqual(obj.history, [{ kind: "update", gameKey: "cs2", title: "Patch", link: "https://example.com", itemId: "u-77" }],
    "history (inclusiv itemId, pentru dedup-ul /history) trebuie declarat in schema, altfel jobul pierde istoricul la enqueue");
});

test("notificationOutbox: campurile necunoscute sunt eliminate de strict mode (confirma ca testul de mai sus e relevant)", () => {
  const OutboxModel = getOutboxModel();
  const doc = new OutboxModel({
    guildId: "g1", channelId: "c1", kind: "update", payload: {},
    somethingNotInSchema: "x"
  } as Record<string, unknown>);
  const obj = doc.toObject() as Record<string, unknown>;
  assert.equal(obj.somethingNotInSchema, undefined, "un camp nedeclarat e sters -> deci recoveryVerify trebuie declarat explicit");
});
