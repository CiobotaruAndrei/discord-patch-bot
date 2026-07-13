import test from "node:test";
import assert from "node:assert/strict";
import type { Model } from "mongoose";
import type {
  FetchSnapshotDoc,
  GuildDoc,
  GuildSeenDiscountDoc,
  GuildSeenUpdateDoc,
  JobLockDoc,
  NotificationHistoryDoc,
  NotificationOutboxDoc
} from "../../infra/mongo/modelTypes.js";

process.env.MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/itest-mongo-ctx-api";
process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || "test-token";
process.env.DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "test-client-id";

type Mod = typeof import("../../infra/mongo/mongoContext.js")["default"];
type Expect<T extends true> = T;

type _GuildModelIsMongooseModel = Expect<
  Mod["GuildModel"] extends Model<infer _Doc> ? true : false
>;
type IsAny<T> = 0 extends (1 & T) ? true : false;
type ModelDoc<M> = M extends Model<infer D> ? D : never;
type _GuildDocNotAny = Expect<IsAny<ModelDoc<Mod["GuildModel"]>> extends false ? true : false>;
type _GuildDocTyped = Expect<ModelDoc<Mod["GuildModel"]> extends GuildDoc ? true : false>;
type _JobLockDocTyped = Expect<ModelDoc<Mod["JobLockModel"]> extends JobLockDoc ? true : false>;
type _FetchSnapshotDocTyped = Expect<ModelDoc<Mod["FetchSnapshotModel"]> extends FetchSnapshotDoc ? true : false>;
type _SeenDiscountDocTyped = Expect<ModelDoc<Mod["GuildSeenDiscountModel"]> extends GuildSeenDiscountDoc ? true : false>;
type _SeenUpdateDocTyped = Expect<ModelDoc<Mod["GuildSeenUpdateModel"]> extends GuildSeenUpdateDoc ? true : false>;
type _OutboxDocTyped = Expect<ModelDoc<Mod["NotificationOutboxModel"]> extends NotificationOutboxDoc ? true : false>;
type _HistoryDocTyped = Expect<ModelDoc<Mod["NotificationHistoryModel"]> extends NotificationHistoryDoc ? true : false>;
type _OutboxDocNotAny = Expect<IsAny<ModelDoc<Mod["NotificationOutboxModel"]>> extends false ? true : false>;
type _CacheSizeIsNumberFn = Expect<
  Mod["getGuildCacheSize"] extends () => number ? (number extends ReturnType<Mod["getGuildCacheSize"]> ? true : false) : false
>;
type _OutboxPausedIsBoolPromiseFn = Expect<
  Mod["getOutboxPaused"] extends () => Promise<boolean> ? true : false
>;
type _AdminAlertIsTyped = Expect<
  Mod["adminAlert"] extends (kind: string, title: string, body: unknown) => Promise<void> ? true : false
>;
type _ActiveLocksIsMap = Expect<
  Mod["activeLocks"] extends Map<string, unknown> ? true : false
>;

const mongoContext = (await import("../../infra/mongo/mongoContext.js")).default;

const MODEL_KEYS = [
  "GuildModel", "CircuitBreakerModel", "SystemModel", "JobLockModel", "AdminAlertCooldownModel",
  "FetchSnapshotModel", "GuildSeenDiscountModel", "GuildSeenUpdateModel", "NotificationOutboxModel",
  "NotificationOutboxSentModel", "NotificationHistoryModel", "FeedbackReportModel",
  "NotificationDeadLetterReplayModel"
];

const FUNCTION_KEYS = [
  "parseEnvNumber", "runConcurrent", "waitForMongoReady", "validatePendingDiscountSnapshot",
  "isTransientMongoError", "withMongoRetry", "saveFetchSnapshot", "loadFetchSnapshot",
  "loadDealsFetchSnapshots", "acquireDbLock", "renewDbLock", "releaseDbLock", "runMigrations",
  "getSystemTimes", "saveSystemTimes", "saveSystemTime", "getOutboxPaused", "setOutboxPaused",
  "getGuildSettings", "invalidateGuildCache", "cleanGuildCache", "getGuildCacheSize", "adminAlert",
  "getCurrencyConfig", "formatPrice", "getAbortSignal"
];

test("mongoContext expune cele 13 modele Mongoose ca obiecte/constructoare definite", () => {
  for (const key of MODEL_KEYS) {
    assert.notEqual((mongoContext as Record<string, unknown>)[key], undefined, `${key} definit`);
    assert.equal(typeof (mongoContext as Record<string, unknown>)[key], "function", `${key} e un model Mongoose (constructor)`);
  }
});

test("mongoContext expune toate cheile-functie tipate ca functii", () => {
  for (const key of FUNCTION_KEYS) {
    assert.equal(typeof (mongoContext as Record<string, unknown>)[key], "function", `mongoContext.${key} e functie`);
  }
});

test("mongoContext expune valorile non-functie cu shape-ul declarat", () => {
  assert.ok(mongoContext.activeLocks instanceof Map, "activeLocks e Map");
  assert.equal(typeof mongoContext.SchemaDriftError, "function", "SchemaDriftError e constructor de eroare");
  assert.ok(Array.isArray(mongoContext.ALL_MIGRATIONS), "ALL_MIGRATIONS e tablou");
  assert.equal(typeof mongoContext.SUPPORTED_CURRENCIES, "object", "SUPPORTED_CURRENCIES e un registry (obiect)");
  assert.ok(mongoContext.SUPPORTED_CURRENCIES && !Array.isArray(mongoContext.SUPPORTED_CURRENCIES), "SUPPORTED_CURRENCIES e obiect, nu tablou");
  assert.equal(typeof mongoContext.DEFAULT_CURRENCY, "string", "DEFAULT_CURRENCY e cod de moneda (string)");
  assert.equal(typeof mongoContext.getGuildCacheSize, "function", "getGuildCacheSize e functie");
  assert.equal(typeof (mongoContext.getGuildCacheSize as () => number)(), "number", "getGuildCacheSize() -> number");
});
