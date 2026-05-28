import test from "node:test";
import assert from "node:assert/strict";

const attachLocks = require("../infra/mongo/locks") as
  (target: LocksTarget) => void;

type LockQuery = { _id: string };
type LockUpdate = { $set: { lockedUntil: Date; ownerToken: string } };
type LockRuntime = {
  acquireDbLock: (jobName: string, ttlMs?: number) => Promise<string | null>;
  activeLocks: Map<string, string>;
};
type LocksTarget = {
  crypto: { randomUUID: () => string };
  JobLockModel: {
    findOneAndUpdate: (filter: LockQuery, update: LockUpdate) => Promise<{ _id: string; lockedUntil: Date; ownerToken: string }>;
    deleteOne: () => Promise<{ deletedCount: number }>;
    updateOne: () => Promise<{ matchedCount: number; modifiedCount: number }>;
  };
  logger: (level: string, context: string, msg: string) => void;
} & Partial<LockRuntime>;

function makeLocksContext(opts: {
  findOneAndUpdateBehavior: "ok" | "throw-duplicate" | "throw-other";
  ownerTokenInDoc?: string;
}) {
  const findCalls: Array<{ filter: unknown; update: unknown }> = [];
  const logs: Array<{ level: string; context: string; msg: string }> = [];

  const JobLockModel = {
    async findOneAndUpdate(filter: LockQuery, update: LockUpdate) {
      findCalls.push({ filter, update });
      if (opts.findOneAndUpdateBehavior === "throw-duplicate") {
        const err = new Error("E11000 duplicate key") as Error & { code: number };
        err.code = 11000;
        throw err;
      }
      if (opts.findOneAndUpdateBehavior === "throw-other") {
        const err = new Error("MongoServerError: write concern timeout") as Error & { code: number };
        err.code = 64;
        throw err;
      }
      const setUpd = update.$set;
      return {
        _id: filter._id,
        lockedUntil: setUpd.lockedUntil,
        ownerToken: opts.ownerTokenInDoc ?? setUpd.ownerToken
      };
    },
    async deleteOne() { return { deletedCount: 1 }; },
    async updateOne() { return { matchedCount: 1, modifiedCount: 1 }; }
  };

  const target: LocksTarget = {
    crypto: { randomUUID: () => "test-token-fixed" },
    JobLockModel,
    logger: (level: string, context: string, msg: string) => { logs.push({ level, context, msg }); }
  };
  attachLocks(target);
  const runtime = target as LocksTarget & LockRuntime;
  return {
    acquireDbLock: runtime.acquireDbLock,
    activeLocks: runtime.activeLocks,
    findCalls, logs
  };
}

test("acquireDbLock returns token on successful upsert", async () => {
  const { acquireDbLock, activeLocks } = makeLocksContext({ findOneAndUpdateBehavior: "ok" });
  const token = await acquireDbLock("cron_main", 60_000);
  assert.equal(token, "test-token-fixed");
  assert.equal(activeLocks.get("cron_main"), "test-token-fixed");
});

test("acquireDbLock returns null on E11000 duplicate-key (legitimate race)", async () => {

  const { acquireDbLock, activeLocks } = makeLocksContext({ findOneAndUpdateBehavior: "throw-duplicate" });
  const token = await acquireDbLock("cron_main", 60_000);
  assert.equal(token, null, "E11000 trebuie sa returneze null, fara sa arunce");
  assert.equal(activeLocks.has("cron_main"), false, "nu populam activeLocks daca n-am castigat lock-ul");
});

test("acquireDbLock RETHROWS non-E11000 errors instead of swallowing them as 'race'", async () => {
  const { acquireDbLock } = makeLocksContext({ findOneAndUpdateBehavior: "throw-other" });
  await assert.rejects(
    () => acquireDbLock("cron_main", 60_000),
    /write concern timeout/,
    "non-E11000 errors trebuie sa propage, nu sa fie ascunse ca null"
  );
});

test("acquireDbLock returns null when the upserted doc has a different ownerToken (lost the race)", async () => {

  const { acquireDbLock } = makeLocksContext({
    findOneAndUpdateBehavior: "ok",
    ownerTokenInDoc: "other-instance-token"
  });
  const token = await acquireDbLock("cron_main", 60_000);
  assert.equal(token, null);
});
