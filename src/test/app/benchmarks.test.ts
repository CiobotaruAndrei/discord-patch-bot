import test from "node:test";
import assert from "node:assert/strict";
import { runCpuBenchmark, levenshteinParityMismatches, runAreaBenchmarks } from "../../scripts/cpuBenchmark.js";
import { runOutboxLoad, OutboxLoadModels } from "../../scripts/outboxLoadBenchmark.js";
import type { OutboxJob } from "../../features/notifications/notificationOutbox.js";

type JobDoc = OutboxJob & {
  _id: string;
  lockedUntil?: Date | null;
  [key: string]: unknown;
};

type OutboxLoadModel = OutboxLoadModels["outboxModel"];
type OutboxSentLoadModel = OutboxLoadModels["sentModel"];

function makeInMemoryModels(): OutboxLoadModels & { jobs: JobDoc[] } {
  const jobs: JobDoc[] = [];
  const sent = new Set<string>();
  let idCounter = 0;
  const outboxModel: OutboxLoadModel = {
    create: async (doc: Record<string, unknown>) => { const job = { _id: `j-${++idCounter}`, ...doc } as JobDoc; jobs.push(job); return job; },
    insertMany: async (docs: Record<string, unknown>[]) => { for (const d of docs) jobs.push({ _id: `j-${++idCounter}`, ...d } as JobDoc); return docs; },
    findOneAndUpdate: async (filter: { availableAt?: { $lte?: Date } }, update: { $set?: Record<string, unknown>; $inc?: { deliveries?: number } }) => {
      const now = filter?.availableAt?.$lte ?? new Date();
      const job = jobs.find(j => !["delivered", "dead-lettered", "dropped"].includes(String(j.status ?? "")) && (!j.availableAt || j.availableAt.getTime() <= now.getTime()) && (!j.lockedUntil || j.lockedUntil.getTime() <= now.getTime()));
      if (!job) return null;
      if (update.$set) Object.assign(job, update.$set);
      if (update.$inc?.deliveries) job.deliveries = ((job.deliveries as number) || 0) + update.$inc.deliveries;
      return job;
    },
    find: () => ({ sort: () => ({ limit: () => ({ lean: async () => jobs.slice() }) }) }),
    deleteOne: async (filter: { _id: string }) => { const i = jobs.findIndex(j => j._id === filter._id); if (i >= 0) jobs.splice(i, 1); return { deletedCount: 1 }; },
    deleteMany: async () => ({ deletedCount: 0 }),
    updateOne: async (filter: { _id?: string }, update: { $set?: Record<string, unknown>; $unset?: Record<string, string> }) => {
      const job = jobs.find(j => j._id === filter?._id);
      if (job && update.$set) Object.assign(job, update.$set);
      if (job && update.$unset) for (const key of Object.keys(update.$unset)) delete (job as Record<string, unknown>)[key];
      return { matchedCount: job ? 1 : 0, modifiedCount: job ? 1 : 0 };
    },
    countDocuments: async () => jobs.filter(j => !["delivered", "dead-lettered", "dropped"].includes(String(j.status ?? ""))).length
  };
  const sentModel: OutboxSentLoadModel = {
    exists: async (filter: { dedupeKey: string }) => (sent.has(filter.dedupeKey) ? { _id: filter.dedupeKey } : null),
    updateOne: async (filter: { dedupeKey: string }) => { sent.add(filter.dedupeKey); return { upsertedCount: 1 }; },
    deleteMany: async () => ({ deletedCount: 0 })
  };
  return { outboxModel, sentModel, jobs };
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

test("cpuBenchmark: runAreaBenchmarks acopera fuzzy/hashing/autocomplete/deal-filters cu paritate native==TS", () => {
  const results = runAreaBenchmarks(200);
  const areas = results.map(r => r.area);
  for (const expected of ["fuzzy-match (findGameKeys)", "hashing (dealHash)", "autocomplete (buildAutocompleteChoices)", "deal-filters (dealPassesFilters)", "listing-batch (extractAndRankListingCandidates)", "steam-patch (selectLatestSteamPatchNote)", "steam-match (chooseBestSteamMatch)", "deals-dedupe (dedupeAndRankDeals)"]) {
    assert.ok(areas.includes(expected), `acopera zona ${expected}`);
  }
  for (const r of results) {
    assert.ok(r.ts.callsPerSecond > 0, `${r.area}: TS masurat`);
    assert.equal(r.parityOk, true, `${r.area}: rezultatele native si TS sunt identice (paritate)`);
    if (r.native) {
      assert.ok(r.native.callsPerSecond > 0, `${r.area}: native masurat`);
      assert.ok(typeof r.speedup === "number" && r.speedup > 0, `${r.area}: speedup raportat`);
    }
  }
});

test("outboxLoadBenchmark: drenarea proceseaza tot lotul (livrare exact-o-data la N mare)", async () => {
  const models = makeInMemoryModels();
  const result = await runOutboxLoad(models, 2000, "bench-test");
  assert.equal(result.jobs, 2000);
  assert.equal(result.delivered, 2000, "toate cele 2000 de joburi sunt livrate o data");
  assert.equal(models.jobs.filter(j => !["delivered", "dead-lettered", "dropped"].includes(String(j.status ?? ""))).length, 0, "coada activa e goala dupa drenare (docurile finalizate raman pana la TTL)");
  assert.ok(result.msPerJob >= 0 && result.jobsPerSec > 0, "metrici de throughput valide");
});
