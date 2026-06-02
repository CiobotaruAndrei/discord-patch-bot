import test from "node:test";
import assert from "node:assert/strict";
import { runCpuBenchmark, levenshteinParityMismatches } from "../scripts/cpuBenchmark";
import { runOutboxLoad, OutboxLoadModels } from "../scripts/outboxLoadBenchmark";

interface JobDoc {
  _id: string;
  guildId: string;
  dedupeKey?: string;
  availableAt?: Date;
  lockedUntil?: Date | null;
  [key: string]: unknown;
}

function makeInMemoryModels(): OutboxLoadModels & { jobs: JobDoc[] } {
  const jobs: JobDoc[] = [];
  const sent = new Set<string>();
  let idCounter = 0;
  const outboxModel = {
    insertMany: async (docs: Record<string, unknown>[]) => { for (const d of docs) jobs.push({ _id: `j-${++idCounter}`, ...d } as JobDoc); return docs; },
    findOneAndUpdate: async (filter: { availableAt?: { $lte?: Date } }, update: { $set?: Record<string, unknown>; $inc?: { deliveries?: number } }) => {
      const now = filter?.availableAt?.$lte ?? new Date();
      const job = jobs.find(j => (!j.availableAt || j.availableAt.getTime() <= now.getTime()) && (!j.lockedUntil || j.lockedUntil.getTime() <= now.getTime()));
      if (!job) return null;
      if (update.$set) Object.assign(job, update.$set);
      if (update.$inc?.deliveries) job.deliveries = ((job.deliveries as number) || 0) + update.$inc.deliveries;
      return job;
    },
    find: () => ({ sort: () => ({ limit: () => ({ lean: async () => jobs.slice() }) }) }),
    deleteOne: async (filter: { _id: string }) => { const i = jobs.findIndex(j => j._id === filter._id); if (i >= 0) jobs.splice(i, 1); return { deletedCount: 1 }; },
    deleteMany: async () => ({ deletedCount: 0 }),
    updateOne: async () => ({ matchedCount: 1 }),
    countDocuments: async () => jobs.length
  };
  const sentModel = {
    exists: async (filter: { dedupeKey: string }) => (sent.has(filter.dedupeKey) ? { _id: filter.dedupeKey } : null),
    updateOne: async (filter: { dedupeKey: string }) => { sent.add(filter.dedupeKey); return { upsertedCount: 1 }; },
    deleteMany: async () => ({ deletedCount: 0 })
  };
  return { outboxModel: outboxModel as never, sentModel: sentModel as never, jobs };
}

test("cpuBenchmark: native si TS dau acelasi rezultat pentru levenshtein (paritate)", () => {
  const mismatches = levenshteinParityMismatches();
  assert.deepEqual(mismatches, [], "rezultatele native si TS trebuie sa fie identice");
});

test("cpuBenchmark: runCpuBenchmark intoarce metrici valide", () => {
  const result = runCpuBenchmark(200);
  assert.equal(result.iterations, 200);
  assert.ok(result.ts.totalMs >= 0 && result.ts.callsPerSecond > 0, "TS masurat");
  if (result.native) {
    assert.ok(result.native.callsPerSecond > 0, "native masurat");
    assert.ok(typeof result.speedup === "number");
  }
});

test("outboxLoadBenchmark: drenarea proceseaza tot lotul (livrare exact-o-data la N mare)", async () => {
  const models = makeInMemoryModels();
  const result = await runOutboxLoad(models, 2000, "bench-test");
  assert.equal(result.jobs, 2000);
  assert.equal(result.delivered, 2000, "toate cele 2000 de joburi sunt livrate o data");
  assert.equal(models.jobs.length, 0, "coada e goala dupa drenare");
  assert.ok(result.msPerJob >= 0 && result.jobsPerSec > 0, "metrici de throughput valide");
});
