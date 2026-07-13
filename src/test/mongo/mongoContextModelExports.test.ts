import test from "node:test";
import assert from "node:assert/strict";

process.env.MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/itest-ctx-exports";
process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || "test-token";
process.env.DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "test-client-id";

const mongoContext = (await import("../../infra/mongo/mongoContext.js")).default;

const EXPECTED_MODELS = [
  "GuildModel",
  "CircuitBreakerModel",
  "SystemModel",
  "JobLockModel",
  "AdminAlertCooldownModel",
  "FetchSnapshotModel",
  "GuildSeenDiscountModel",
  "GuildSeenUpdateModel",
  "NotificationOutboxModel",
  "NotificationOutboxSentModel"
];

test("mongoContext expune toate modelele Mongo create de attachMongoModels", () => {
  for (const name of EXPECTED_MODELS) {
    assert.ok((mongoContext as Record<string, unknown>)[name], `mongoContext trebuie sa expuna ${name}`);
  }
});

test("mongoContext expune NotificationOutboxSentModel (regresie: lipsea din exports -> outbox markSent/dedupe primeau undefined si crapau cand NOTIFICATION_OUTBOX_ENABLED=true)", () => {
  assert.ok(mongoContext.NotificationOutboxModel, "NotificationOutboxModel trebuie expus");
  assert.ok(mongoContext.NotificationOutboxSentModel, "NotificationOutboxSentModel trebuie expus alaturi de NotificationOutboxModel");
});
