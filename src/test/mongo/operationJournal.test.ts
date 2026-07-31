import test from "node:test";
import assert from "node:assert/strict";
import {
  createOperationJournal,
  OperationAlreadyRunningError,
  type OperationJournalDoc
} from "../../shared/operationJournalEngine.js";
import type { OperationKindMap, ResetConfigPayload, BackupDeletePayload } from "../../features/admin-records/operationJournalRuntime.js";
import { fakeJournalModel, journalDoc } from "./operationJournalTestKit.js";
import type { JournalFilter, JournalUpdate } from "./operationJournalTestKit.js";

const resetKindIsTyped: [OperationKindMap["reset-config"]] extends [ResetConfigPayload]
  ? ([ResetConfigPayload] extends [OperationKindMap["reset-config"]] ? true : never)
  : never = true;
const backupDeleteKindIsTyped: [OperationKindMap["backup-delete"]] extends [BackupDeletePayload] ? true : never = true;
type RegisteredKinds = keyof OperationKindMap;
const kindsAreClosed: [RegisteredKinds] extends ["reset-config" | "backup-load" | "backup-save" | "backup-delete" | "admin-access-save" | "admin-access-delete" | "guild-slice-copy"]
  ? (["reset-config" | "backup-load" | "backup-save" | "backup-delete" | "admin-access-save" | "admin-access-delete" | "guild-slice-copy"] extends [RegisteredKinds] ? true : never)
  : never = true;

test("contract compile-time: registrul de operatii e tipat pe kind - fiecare kind isi cunoaste payload-ul la compilare (review nou, Major #6)", () => {
  assert.equal(resetKindIsTyped, true, "runJournaled(_, \"reset-config\", payload) accepta DOAR ResetConfigPayload");
  assert.equal(backupDeleteKindIsTyped, true, "kind-ul backup-delete e legat de BackupDeletePayload");
  assert.equal(kindsAreClosed, true, "multimea kind-urilor e inchisa: un kind nou fara payload declarat nu compileaza");
});

test("runJournaled revendica atomic operatia, executa si finalizeaza cu acelasi lease", async () => {
  const model = fakeJournalModel();
  const ran: unknown[] = [];
  const journal = createOperationJournal({
    JournalModel: model,
    logger: () => undefined,
    ownerId: "worker-1",
    executors: { "test-op": async payload => { ran.push(payload); } }
  });
  await journal.runJournaled("k1", "test-op", { x: 1 });
  assert.deepEqual(ran, [{ x: 1 }]);
  assert.equal(model.docs.get("k1")?.status, "done");
  assert.equal(model.docs.get("k1")?.leaseVersion, 1);
  assert.equal(model.docs.get("k1")?.lockedBy, null);
});

test("runJournaled nu executa din nou o operatie finalizata", async () => {
  const model = fakeJournalModel([journalDoc({ _id: "k1", kind: "test-op", status: "done", attempts: 1 })]);
  let runs = 0;
  const journal = createOperationJournal({
    JournalModel: model,
    logger: () => undefined,
    executors: { "test-op": async () => { runs++; } }
  });
  await journal.runJournaled("k1", "test-op", {});
  assert.equal(runs, 0);
});

test("doua instante nu pot executa simultan aceeasi operatie", async () => {
  const model = fakeJournalModel();
  let releaseFirst: () => void = () => undefined;
  const firstStarted = new Promise<void>(resolve => { releaseFirst = resolve; });
  let entered = 0;
  const first = createOperationJournal({
    JournalModel: model,
    logger: () => undefined,
    ownerId: "worker-1",
    executors: { "test-op": async () => { entered++; await firstStarted; } }
  });
  const second = createOperationJournal({
    JournalModel: model,
    logger: () => undefined,
    ownerId: "worker-2",
    executors: { "test-op": async () => { entered++; } }
  });
  const firstRun = first.runJournaled("k1", "test-op", {});
  await new Promise<void>(resolve => setImmediate(resolve));
  await assert.rejects(() => second.runJournaled("k1", "test-op", {}), OperationAlreadyRunningError);
  assert.equal(entered, 1);
  releaseFirst();
  await firstRun;
});

test("esecul executorului elibereaza lease-ul pentru retry", async () => {
  const model = fakeJournalModel();
  const journal = createOperationJournal({
    JournalModel: model,
    logger: () => undefined,
    ownerId: "worker-1",
    executors: { "test-op": async () => { throw new Error("boom"); } }
  });
  await assert.rejects(() => journal.runJournaled("k1", "test-op", {}), /boom/);
  assert.equal(model.docs.get("k1")?.status, "pending");
  assert.equal(model.docs.get("k1")?.lockedBy, null);
});

test("heartbeat-ul de lease e serializat: nu porneste o reinnoire noua cat timp precedenta e in zbor (review nou, Major #6)", async () => {
  const model = fakeJournalModel();
  let renewalsInFlight = 0;
  let maxRenewalsInFlight = 0;
  let renewals = 0;
  const baseUpdateOne = model.updateOne;
  model.updateOne = async (filter: JournalFilter, update: JournalUpdate, options?: JournalFilter) => {
    const set = (update.$set ?? {}) as Record<string, unknown>;
    const isRenewal = "lockedUntil" in set && !("status" in set);
    if (!isRenewal) return baseUpdateOne(filter, update, options);
    renewals++;
    renewalsInFlight++;
    maxRenewalsInFlight = Math.max(maxRenewalsInFlight, renewalsInFlight);
    await new Promise(resolve => setTimeout(resolve, 120));
    renewalsInFlight--;
    return baseUpdateOne(filter, update, options);
  };
  const journal = createOperationJournal({
    JournalModel: model,
    logger: () => undefined,
    ownerId: "worker-1",
    leaseMs: 300,
    executors: { "test-op": async () => { await new Promise(resolve => setTimeout(resolve, 350)); } }
  });
  await journal.runJournaled("k1", "test-op", {});
  assert.ok(renewals >= 2, `heartbeat-ul a rulat de mai multe ori in timpul executiei (${renewals})`);
  assert.equal(maxRenewalsInFlight, 1, "reinnoirile de lease nu se suprapun: cel mult una in zbor la orice moment");
});

test("releaseAfterFailure respecta lease guard-ul: esecul unei instante care a pierdut lease-ul nu atinge lease-ul noului proprietar (review nou #6)", async () => {
  const model = fakeJournalModel();
  const journal = createOperationJournal({
    JournalModel: model,
    logger: () => undefined,
    ownerId: "worker-1",
    executors: {
      "test-op": async () => {
        const current = model.docs.get("k1");
        assert.ok(current, "operatia exista si e leased de worker-1");
        model.docs.set("k1", { ...current, lockedBy: "worker-2", leaseVersion: current.leaseVersion + 1, status: "leased" });
        throw new Error("worker-1 a esuat dupa ce worker-2 a preluat lease-ul");
      }
    }
  });
  await assert.rejects(() => journal.runJournaled("k1", "test-op", {}), /worker-1 a esuat/);
  const doc = model.docs.get("k1");
  assert.equal(doc?.lockedBy, "worker-2", "lease-ul noului proprietar ramane intact (guard-ul {_id, lockedBy, leaseVersion} a blocat scrierea instantei vechi)");
  assert.equal(doc?.status, "leased", "statusul nu e resetat la pending de instanta care a pierdut lease-ul");
});

test("recoverPending revendica operatiile vechi si le finalizeaza", async () => {
  const old = new Date(Date.now() - 10 * 60 * 1000);
  const model = fakeJournalModel([journalDoc({
    _id: "k1",
    kind: "reset",
    payload: { g: "1" },
    status: "pending",
    attempts: 1,
    updatedAt: old,
    createdAt: old
  })]);
  const replayed: unknown[] = [];
  const journal = createOperationJournal({
    JournalModel: model,
    logger: () => undefined,
    ownerId: "recovery-1",
    executors: { reset: async payload => { replayed.push(payload); } }
  });
  const result = await journal.recoverPending({ olderThanMs: 5 * 60 * 1000, limit: 10 });
  assert.deepEqual(replayed, [{ g: "1" }]);
  assert.equal(result.recovered, 1);
  assert.equal(model.docs.get("k1")?.status, "done");
});

test("recoverPending poate prelua un lease expirat, dar nu unul activ", async () => {
  const at = new Date();
  const expired = new Date(at.getTime() - 1000);
  const active = new Date(at.getTime() + 60_000);
  const old = new Date(at.getTime() - 10 * 60 * 1000);
  const model = fakeJournalModel([
    journalDoc({ _id: "expired", kind: "reset", status: "leased", lockedBy: "dead", lockedUntil: expired, updatedAt: old }),
    journalDoc({ _id: "active", kind: "reset", status: "leased", lockedBy: "live", lockedUntil: active, updatedAt: old })
  ]);
  const replayed: unknown[] = [];
  const journal = createOperationJournal({
    JournalModel: model,
    logger: () => undefined,
    ownerId: "recovery-1",
    executors: { reset: async payload => { replayed.push(payload); } }
  });
  const result = await journal.recoverPending({ olderThanMs: 5 * 60 * 1000, limit: 10, now: at });
  assert.equal(result.recovered, 1);
  assert.equal(model.docs.get("expired")?.status, "done");
  assert.equal(model.docs.get("active")?.status, "leased");
});

test("kind necunoscut este refuzat la run si marcat failed la recovery", async () => {
  const model = fakeJournalModel();
  const journal = createOperationJournal({ JournalModel: model, logger: () => undefined, executors: {} });
  await assert.rejects(() => journal.runJournaled("k1", "necunoscut", {}), /nicio functie de executie/);

  const old = new Date(Date.now() - 10 * 60 * 1000);
  const model2 = fakeJournalModel([journalDoc({ _id: "k2", kind: "necunoscut", updatedAt: old, createdAt: old })]);
  const journal2 = createOperationJournal({ JournalModel: model2, logger: () => undefined, executors: {} });
  const result = await journal2.recoverPending({ olderThanMs: 5 * 60 * 1000, limit: 10 });
  assert.equal(result.failed, 1);
  assert.equal(model2.docs.get("k2")?.status, "failed");
});

test("recovery nu reaplica o operatie depasita peste aceeasi resursa", async () => {
  const old = new Date(Date.now() - 10 * 60 * 1000);
  const model = fakeJournalModel([
    journalDoc({ _id: "old", kind: "reset", resourceKey: "guild:g1", resourceVersion: "0001", status: "pending", updatedAt: old }),
    journalDoc({ _id: "new", kind: "reset", resourceKey: "guild:g1", resourceVersion: "0002", status: "done", updatedAt: new Date() })
  ]);
  let runs = 0;
  const journal = createOperationJournal({ JournalModel: model, logger: () => undefined, executors: { reset: async () => { runs++; } } });
  const result = await journal.recoverPending({ olderThanMs: 1000, limit: 10 });
  assert.equal(runs, 0);
  assert.equal(result.superseded, 1);
  assert.equal(model.docs.get("old")?.status, "superseded");
});

test("recovery nu executa intrari legacy fara versiune de resursa", async () => {
  const old = new Date(Date.now() - 10 * 60 * 1000);
  const legacy = journalDoc({ _id: "legacy-resource", kind: "reset", status: "pending", updatedAt: old });
  Reflect.deleteProperty(legacy, "resourceKey");
  Reflect.deleteProperty(legacy, "resourceVersion");
  const model = fakeJournalModel([legacy]);
  let runs = 0;
  const journal = createOperationJournal({
    JournalModel: model,
    logger: () => undefined,
    executors: { reset: async () => { runs++; } }
  });
  const result = await journal.recoverPending({ olderThanMs: 1000, limit: 10 });
  assert.equal(runs, 0);
  assert.equal(result.failed, 1);
  assert.equal(model.docs.get("legacy-resource")?.status, "failed");
});

test("recovery opreste retry-ul la numarul maxim de incercari", async () => {
  const old = new Date(Date.now() - 10 * 60 * 1000);
  const model = fakeJournalModel([journalDoc({ _id: "max", kind: "reset", attempts: 5, updatedAt: old })]);
  const journal = createOperationJournal({ JournalModel: model, logger: () => undefined, maxAttempts: 5, executors: { reset: async () => undefined } });
  const result = await journal.recoverPending({ olderThanMs: 1000, limit: 10 });
  assert.equal(result.failed, 1);
  assert.equal(model.docs.get("max")?.status, "failed");
});

test("recovery marcheaza payload-ul cu schema incompatibila ca failed", async () => {
  const old = new Date(Date.now() - 10 * 60 * 1000);
  const model = fakeJournalModel([journalDoc({ _id: "legacy", kind: "reset", schemaVersion: 1, updatedAt: old })]);
  const journal = createOperationJournal({ JournalModel: model, logger: () => undefined, schemaVersions: { reset: 2 }, executors: { reset: async () => undefined } });
  const result = await journal.recoverPending({ olderThanMs: 1000, limit: 10 });
  assert.equal(result.failed, 1);
  assert.equal(model.docs.get("legacy")?.status, "failed");
});
