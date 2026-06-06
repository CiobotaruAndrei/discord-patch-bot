import test from "node:test";
import assert from "node:assert/strict";
import { runOutboxPhaseBreakdown } from "../scripts/outboxLoadBenchmark";
import type { OutboxLoadModels } from "../scripts/outboxLoadBenchmark";

function makeMockModels(): { models: OutboxLoadModels; calls: Record<string, number> } {
  const calls = { insertMany: 0, findOneAndUpdate: 0, exists: 0, updateOne: 0, deleteOne: 0 };
  let claimCounter = 0;
  const models: OutboxLoadModels = {
    outboxModel: {
      insertMany: async () => { calls.insertMany++; return undefined; },
      findOneAndUpdate: async () => { const id = claimCounter++; return { _id: id, dedupeKey: `k-${id}` }; },
      find: () => undefined,
      deleteOne: async () => { calls.deleteOne++; return undefined; },
      deleteMany: async () => undefined,
      updateOne: async () => undefined,
      countDocuments: async () => 0
    },
    sentModel: {
      exists: async () => { calls.exists++; return null; },
      updateOne: async () => { calls.updateOne++; return undefined; },
      deleteMany: async () => undefined
    }
  };
  const wrappedFind = models.outboxModel.findOneAndUpdate;
  models.outboxModel.findOneAndUpdate = async (...args: unknown[]) => { calls.findOneAndUpdate++; return wrappedFind(args[0], args[1], args[2]); };
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
