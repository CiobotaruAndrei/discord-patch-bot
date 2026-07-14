import test from "node:test";
import assert from "node:assert/strict";
import { createOperationJournal, type OperationJournalDoc } from "../../infra/mongo/operationJournal.js";

function fakeJournalModel(seed: OperationJournalDoc[] = []) {
  const docs = new Map<string, OperationJournalDoc>(seed.map(d => [d._id, { ...d }]));
  const writes: Array<{ filter: Record<string, unknown>; update: Record<string, unknown> }> = [];
  const model = {
    writes,
    docs,
    findOne: (filter: { _id: string }) => ({ lean: async () => docs.get(filter._id) ?? null }),
    updateOne: async (filter: { _id: string }, update: Record<string, unknown>) => {
      writes.push({ filter, update });
      const existing = docs.get(filter._id) ?? { _id: filter._id, kind: "", payload: null, status: "pending", attempts: 0, createdAt: new Date(), updatedAt: new Date() } as OperationJournalDoc;
      const set = (update.$set ?? {}) as Partial<OperationJournalDoc>;
      const setOnInsert = docs.has(filter._id) ? {} : ((update.$setOnInsert ?? {}) as Partial<OperationJournalDoc>);
      const inc = (update.$inc ?? {}) as { attempts?: number };
      const merged = { ...existing, ...setOnInsert, ...set, attempts: (existing.attempts ?? 0) + (inc.attempts ?? 0) } as OperationJournalDoc;
      docs.set(filter._id, merged);
      return { modifiedCount: 1 };
    },
    find: (filter: { status?: string; updatedAt?: { $lte?: Date } }) => ({
      sort: () => ({ limit: () => ({ lean: async () => Array.from(docs.values()).filter(d =>
        (!filter.status || d.status === filter.status)
        && (!filter.updatedAt?.$lte || d.updatedAt <= filter.updatedAt.$lte)) }) })
    })
  };
  return model;
}

test("runJournaled inregistreaza intentia (pending), executa executorul si marcheaza done", async () => {
  const model = fakeJournalModel();
  const ran: unknown[] = [];
  const journal = createOperationJournal({ JournalModel: model, logger: () => undefined, executors: { "test-op": async p => { ran.push(p); } } });
  await journal.runJournaled("k1", "test-op", { x: 1 });
  assert.deepEqual(ran, [{ x: 1 }], "executorul a rulat cu payload-ul");
  assert.equal(model.docs.get("k1")?.status, "done", "intrarea e marcata done dupa succes");
});

test("runJournaled sare peste o operatie deja 'done' (idempotent, nu re-executa)", async () => {
  const model = fakeJournalModel([{ _id: "k1", kind: "test-op", payload: {}, status: "done", attempts: 1, createdAt: new Date(), updatedAt: new Date() }]);
  let runs = 0;
  const journal = createOperationJournal({ JournalModel: model, logger: () => undefined, executors: { "test-op": async () => { runs++; } } });
  await journal.runJournaled("k1", "test-op", {});
  assert.equal(runs, 0, "o operatie deja finalizata nu se re-executa");
});

test("runJournaled lasa intrarea 'pending' si arunca daca executorul esueaza (recuperabila)", async () => {
  const model = fakeJournalModel();
  const journal = createOperationJournal({ JournalModel: model, logger: () => undefined, executors: { "test-op": async () => { throw new Error("boom"); } } });
  await assert.rejects(() => journal.runJournaled("k1", "test-op", {}), /boom/);
  assert.equal(model.docs.get("k1")?.status, "pending", "ramane pending pentru recovery");
});

test("recoverPending reia executorul pe intrarile 'pending' vechi si le marcheaza done", async () => {
  const old = new Date(Date.now() - 10 * 60 * 1000);
  const model = fakeJournalModel([{ _id: "k1", kind: "reset", payload: { g: "1" }, status: "pending", attempts: 1, createdAt: old, updatedAt: old }]);
  const replayed: unknown[] = [];
  const journal = createOperationJournal({ JournalModel: model, logger: () => undefined, executors: { reset: async p => { replayed.push(p); } } });
  const result = await journal.recoverPending({ olderThanMs: 5 * 60 * 1000, limit: 10 });
  assert.deepEqual(replayed, [{ g: "1" }], "operatia crashuita e reluata");
  assert.equal(result.recovered, 1);
  assert.equal(model.docs.get("k1")?.status, "done");
});

test("recoverPending nu atinge intrari 'pending' recente (posibil in-flight pe alta instanta)", async () => {
  const recent = new Date(Date.now() - 30 * 1000);
  const model = fakeJournalModel([{ _id: "k1", kind: "reset", payload: {}, status: "pending", attempts: 1, createdAt: recent, updatedAt: recent }]);
  let replays = 0;
  const journal = createOperationJournal({ JournalModel: model, logger: () => undefined, executors: { reset: async () => { replays++; } } });
  const result = await journal.recoverPending({ olderThanMs: 5 * 60 * 1000, limit: 10 });
  assert.equal(replays, 0, "intrarile recente nu se reiau (evita furtul unei operatii in-flight)");
  assert.equal(result.scanned, 0);
});

test("un 'kind' fara executor inregistrat arunca la run si e raportat la recovery", async () => {
  const model = fakeJournalModel();
  const journal = createOperationJournal({ JournalModel: model, logger: () => undefined, executors: {} });
  await assert.rejects(() => journal.runJournaled("k1", "necunoscut", {}), /nicio functie de executie/);

  const old = new Date(Date.now() - 10 * 60 * 1000);
  const model2 = fakeJournalModel([{ _id: "k2", kind: "necunoscut", payload: {}, status: "pending", attempts: 1, createdAt: old, updatedAt: old }]);
  const journal2 = createOperationJournal({ JournalModel: model2, logger: () => undefined, executors: {} });
  const result = await journal2.recoverPending({ olderThanMs: 5 * 60 * 1000, limit: 10 });
  assert.equal(result.failed, 1, "un kind necunoscut la recovery e raportat ca failed, nu recuperat");
  assert.equal(model2.docs.get("k2")?.status, "pending", "ramane pending pentru inspectie manuala");
});
