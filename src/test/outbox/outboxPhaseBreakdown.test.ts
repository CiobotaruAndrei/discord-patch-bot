import test from "node:test";
import assert from "node:assert/strict";
import { runOutboxPhaseBreakdown } from "../../scripts/outboxLoadBenchmark.js";
import type { OutboxLoadModels } from "../../scripts/outboxLoadBenchmark.js";

function makeMockModels(): { models: OutboxLoadModels; calls: Record<string, number> } {
  const calls = { insertMany: 0, findOneAndUpdate: 0, exists: 0, updateOne: 0, deleteOne: 0 };
  let claimCounter = 0;
  const models: OutboxLoadModels = {
    outboxModel: {
      create: async () => undefined,
      insertMany: async () => { calls.insertMany++; return undefined; },
      findOneAndUpdate: async () => {
        calls.findOneAndUpdate++;
        const id = claimCounter++;
        return { guildId: "g", channelId: "c", kind: "update", payload: {}, attempts: 0, _id: id, dedupeKey: `k-${id}` };
      },
      find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }),
      deleteOne: async () => { calls.deleteOne++; return { deletedCount: 1 }; },
      deleteMany: async () => undefined,
      updateOne: async () => ({ modifiedCount: 1 }),
      countDocuments: async () => 0
    },
    sentModel: {
      exists: async () => { calls.exists++; return null; },
      updateOne: async () => { calls.updateOne++; return { modifiedCount: 1 }; },
      deleteMany: async () => undefined
    }
  };
  return { models, calls };
}

test("runOutboxPhaseBreakdown: cheama fiecare faza o data per job si intoarce ms/job numerici care insumeaza totalul", async () => {
  const { models, calls } = makeMockModels();
  const jobs = 25;
  const result = await runOutboxPhaseBreakdown(models, jobs, "test-marker");

  assert.equal(calls.insertMany, 1, "se face un singur insertMany pentru seeding");
  assert.equal(calls.findOneAndUpdate, jobs, "claim o data per job");
  assert.equal(calls.exists, jobs, "dedupe-check o data per job");
  assert.equal(calls.updateOne, jobs, "markSent o data per job");
  assert.equal(calls.deleteOne, jobs, "delete o data per job");

  assert.equal(result.jobs, jobs);
  for (const value of [result.claimMsPerJob, result.dedupeMsPerJob, result.markSentMsPerJob, result.deleteMsPerJob, result.mongoMsPerJob]) {
    assert.ok(typeof value === "number" && Number.isFinite(value) && value >= 0, "fiecare faza intoarce ms/job numeric >= 0");
  }
  const sum = result.claimMsPerJob + result.dedupeMsPerJob + result.markSentMsPerJob + result.deleteMsPerJob;
  assert.ok(Math.abs(result.mongoMsPerJob - sum) < 1e-9, "mongoMsPerJob = suma fazelor");
});
