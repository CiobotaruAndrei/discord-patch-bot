import test from "node:test";
import assert from "node:assert/strict";

const mongoose = require("mongoose");
const attachMongoModels = require("../infra/mongo/models");

interface OutboxModelLike {
  new (doc: Record<string, unknown>): { toObject(): Record<string, unknown> };
}

function getOutboxModel(): OutboxModelLike {
  try {
    const target: Record<string, unknown> = {
      mongoose,
      SUPPORTED_CURRENCIES: { USD: {} },
      DEFAULT_CURRENCY: "USD",
      ONE_DAY_MS: 86_400_000
    };
    attachMongoModels(target);
    if (target.NotificationOutboxModel) return target.NotificationOutboxModel as OutboxModelLike;
  } catch {  }
  return mongoose.model("NotificationOutbox") as unknown as OutboxModelLike;
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
    recoveryVerify: true
  });
  const obj = doc.toObject();
  assert.equal(obj.recoveryVerify, true, "recoveryVerify trebuie declarat in schema, altfel strict mode il sterge la salvare");
  assert.equal(obj.dedupeKey, "k-1", "dedupeKey persistat");
  assert.equal(obj.deliveries, 2, "deliveries persistat");
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
