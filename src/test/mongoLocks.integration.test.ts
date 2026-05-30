import test from "node:test";
import assert from "node:assert/strict";

process.env.MONGO_URI ||= "mongodb://localhost:27017/discord-patch-bot-test";
process.env.DISCORD_TOKEN ||= "test_discord_token";
process.env.DISCORD_CLIENT_ID ||= "test_discord_client_id";
process.env.METRICS_PUBLIC ||= "true";

const mongoose = require("mongoose") as typeof import("mongoose");
const crypto = require("crypto") as typeof import("crypto");
const attachLocks = require("../infra/mongo/locks") as (target: Record<string, unknown>) => void;

type LockApi = {
  acquireDbLock: (jobName: string, ttlMs?: number) => Promise<string | null>;
  renewDbLock: (jobName: string, token: string | null, ttlMs?: number) => Promise<boolean>;
  releaseDbLock: (jobName: string, token: string | null) => Promise<void>;
};

test("MongoDB integration: distributed lock acquire/renew/release against a real server", async (t) => {
  const uri = String(process.env.MONGO_URI || "");
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 2000 });
  } catch {
    t.skip("MongoDB indisponibil pe MONGO_URI - sar testul de integrare");
    return;
  }

  try {
    const jobLockSchema = new mongoose.Schema({
      _id: String,
      lockedUntil: { type: Date, default: null },
      ownerToken: { type: String, default: null }
    }, { minimize: false });
    const JobLockModel = mongoose.models.JobLock || mongoose.model("JobLock", jobLockSchema);

    const target: Record<string, unknown> = { crypto, JobLockModel, logger: () => undefined };
    attachLocks(target);
    const { acquireDbLock, renewDbLock, releaseDbLock } = target as unknown as LockApi;

    const jobName = `it_lock_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

    const first = await acquireDbLock(jobName, 60_000);
    assert.ok(first, "prima achizitie trebuie sa returneze un token");

    const second = await acquireDbLock(jobName, 60_000);
    assert.equal(second, null, "a doua achizitie pe un lock detinut trebuie sa esueze");

    assert.equal(await renewDbLock(jobName, first, 60_000), true, "reinnoirea cu tokenul corect reuseste");
    assert.equal(await renewDbLock(jobName, "token-gresit", 60_000), false, "reinnoirea cu token gresit esueaza");

    await releaseDbLock(jobName, first);

    const third = await acquireDbLock(jobName, 60_000);
    assert.ok(third, "dupa eliberare lock-ul redevine disponibil");
    await releaseDbLock(jobName, third);
  } finally {
    await mongoose.disconnect();
  }
});
