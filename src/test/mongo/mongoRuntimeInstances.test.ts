import test from "node:test";
import assert from "node:assert/strict";
import attachSystemState from "../../infra/mongo/systemState.js";
import attachSourceHealth from "../../infra/mongo/sourceHealth.js";
import attachFetchSnapshots from "../../infra/mongo/fetchSnapshots.js";

function fakeSystemModel() {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    findOneAndUpdate: () => ({ lean: async () => null }),
    findByIdAndUpdate: async (_id: string, update: Record<string, unknown>) => { calls.push(update); },
    findById: () => ({ lean: async () => null })
  };
}

test("systemState: instantele buildFrom sunt independente (fara stare de modul partajata)", async () => {
  const a = fakeSystemModel();
  const b = fakeSystemModel();
  const instA = attachSystemState.buildFrom({ SystemModel: a });
  const instB = attachSystemState.buildFrom({ SystemModel: b });

  await instA.setOutboxPaused(true);

  assert.equal(a.calls.length, 1, "instanta A scrie pe modelul A");
  assert.equal(b.calls.length, 0, "instanta B nu e afectata de A (nu impart runtimeContext global)");
});

test("sourceHealth: fiecare instanta citeste din propriul CircuitBreakerModel", async () => {
  const docsA = [{ _id: "steam", fails: 2 }];
  const docsB = [{ _id: "epic", fails: 5 }];
  const instA = attachSourceHealth.buildFrom({ CircuitBreakerModel: { find: () => ({ lean: async () => docsA }) }, logger: () => undefined });
  const instB = attachSourceHealth.buildFrom({ CircuitBreakerModel: { find: () => ({ lean: async () => docsB }) }, logger: () => undefined });

  const [a, b] = await Promise.all([instA.loadSourceHealth(), instB.loadSourceHealth()]);
  assert.deepEqual(a.map(d => d.key), ["steam"]);
  assert.deepEqual(b.map(d => d.key), ["epic"]);
});

test("fetchSnapshots: fiecare instanta scrie prin propriul model/retry injectat", async () => {
  const writesA: string[] = [];
  const writesB: string[] = [];
  const modelA = { updateOne: async (f: { _id: string }) => { writesA.push(f._id); }, findById: () => ({ lean: async () => null }), find: () => ({ lean: async () => [] }) };
  const modelB = { updateOne: async (f: { _id: string }) => { writesB.push(f._id); }, findById: () => ({ lean: async () => null }), find: () => ({ lean: async () => [] }) };
  const passthrough = async <T>(fn: () => Promise<T>) => fn();
  const instA = attachFetchSnapshots.buildFrom({ FetchSnapshotModel: modelA, withMongoRetry: passthrough, logger: () => undefined });
  const instB = attachFetchSnapshots.buildFrom({ FetchSnapshotModel: modelB, withMongoRetry: passthrough, logger: () => undefined });

  await instA.saveFetchSnapshot("updates", { x: 1 });

  assert.deepEqual(writesA, ["updates"]);
  assert.deepEqual(writesB, [], "instanta B nu primeste scrierea lui A");
});
