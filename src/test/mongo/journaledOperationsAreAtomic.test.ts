import test from "node:test";
import assert from "node:assert/strict";

import { resetGuildConfigurationWithAudit } from "../../features/guild-config/guildConfigRepository.js";
import { loadConfigBackupWithAudit } from "../../features/admin-records/configBackupRepository.js";
import { saveAdminAccessRule, deleteAdminAccessRule } from "../../features/command-security/adminAccessRepository.js";
import type { TransactionRunner, TransactionSession } from "../../shared/transactionPort.js";
import { GLOBAL_ADMIN_SCOPE_ID } from "../../features/command-security/adminScopeIds.js";

type Step = { step: string; session: string | null };

const SESSION_LABEL = "session-1";

function recordingRunner(steps: Step[]) {
  const session: TransactionSession = { endSession: async () => undefined };
  const runner: TransactionRunner = {
    support: () => "replica-set",
    async atomic(label, work) {
      steps.push({ step: `begin:${label}`, session: SESSION_LABEL });
      try {
        const result = await work(session);
        steps.push({ step: `commit:${label}`, session: SESSION_LABEL });
        return result;
      } catch (error) {
        steps.push({ step: `abort:${label}`, session: SESSION_LABEL });
        throw error;
      }
    }
  };
  return { runner, session };
}

function sessionOf(options: unknown): string | null {
  if (!options || typeof options !== "object") return null;
  return "session" in options && (options as { session?: unknown }).session ? SESSION_LABEL : null;
}

type EmptyQuery = {
  sort(spec: Record<string, 1 | -1>): EmptyQuery;
  skip(count: number): EmptyQuery;
  limit(count: number): EmptyQuery;
  lean(): Promise<never[]>;
};

const emptyQuery: EmptyQuery = {
  sort: () => emptyQuery,
  skip: () => emptyQuery,
  limit: () => emptyQuery,
  lean: async () => []
};

function collector(steps: Step[], name: string, failing = false) {
  return {
    async updateOne(_filter: Record<string, unknown>, _update: unknown, options?: Record<string, unknown>) {
      if (failing) throw new Error(`${name} a esuat`);
      steps.push({ step: `${name}.updateOne`, session: sessionOf(options) });
      return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
    },
    async deleteMany(_filter: Record<string, unknown>, options?: Record<string, unknown>) {
      steps.push({ step: `${name}.deleteMany`, session: sessionOf(options) });
      return { deletedCount: 0 };
    },
    async create(_doc: unknown, options?: Record<string, unknown>) {
      steps.push({ step: `${name}.create`, session: sessionOf(options) });
      return {};
    },
    async insertMany(_docs: unknown[], options?: Record<string, unknown>) {
      steps.push({ step: `${name}.insertMany`, session: sessionOf(options) });
      return {};
    },
    async countDocuments() { return 0; },
    find() { return emptyQuery; }
  };
}

const audit = { userId: "u1", actorId: "u1", action: "test", details: "detalii", result: "ok" };

test("reset-config: toate cele patru scrieri, inclusiv payload-urile de replay, sunt in aceeasi sesiune", async () => {
  const steps: Step[] = [];
  const { runner } = recordingRunner(steps);
  await resetGuildConfigurationWithAudit(
    collector(steps, "guild"),
    collector(steps, "audit"),
    collector(steps, "youtubeErrors"),
    collector(steps, "deadLetters"),
    "g1",
    "USD",
    audit,
    "op-1",
    runner,
    collector(steps, "replayPayloads")
  );

  const sessions = new Set(steps.filter(entry => entry.step.includes(".")).map(entry => entry.session));
  assert.deepEqual([...sessions], [SESSION_LABEL], "nicio scriere nu ramane in afara tranzactiei");
  assert.ok(
    steps.some(entry => entry.step === "replayPayloads.deleteMany"),
    "stergerea payload-urilor de replay chiar se executa"
  );
  const replayIndex = steps.findIndex(entry => entry.step === "replayPayloads.deleteMany");
  const commitIndex = steps.findIndex(entry => entry.step === "commit:reset-config");
  assert.ok(
    replayIndex < commitIndex,
    "inainte, stergerea payload-urilor rula DUPA commit: o cadere intre commit si stergere lasa payload-uri orfane"
  );
});

test("reset-config: o scriere esuata anuleaza tot, nu lasa o parte aplicata", async () => {
  const steps: Step[] = [];
  const { runner } = recordingRunner(steps);
  await assert.rejects(
    () => resetGuildConfigurationWithAudit(
      collector(steps, "guild"),
      collector(steps, "audit", true),
      collector(steps, "youtubeErrors"),
      collector(steps, "deadLetters"),
      "g1",
      "USD",
      audit,
      "op-1",
      runner,
      collector(steps, "replayPayloads")
    ),
    /audit a esuat/
  );
  assert.ok(steps.some(entry => entry.step === "abort:reset-config"), "tranzactia e anulata");
  assert.ok(!steps.some(entry => entry.step === "commit:reset-config"), "nu se raporteaza commit");
  assert.ok(!steps.some(entry => entry.step === "replayPayloads.deleteMany"), "pasii de dupa esec nu se mai executa");
});

test("backup-load: restaurarea si auditul impart aceeasi sesiune", async () => {
  const steps: Step[] = [];
  const { runner } = recordingRunner(steps);
  await loadConfigBackupWithAudit(
    collector(steps, "guild"),
    collector(steps, "audit"),
    "g1",
    { name: "prod", createdBy: "u1", createdAt: new Date(), snapshot: {} },
    audit,
    "op-2",
    runner
  );
  const writes = steps.filter(entry => entry.step.includes("."));
  assert.equal(writes.length, 2, "restaurarea scrie configuratia si auditul");
  assert.deepEqual([...new Set(writes.map(entry => entry.session))], [SESSION_LABEL], "ambele in aceeasi tranzactie");
  assert.ok(steps.some(entry => entry.step === "commit:backup-load"));
});

test("admin-access: salvarea si stergerea regulii sunt atomice cu auditul lor", async () => {
  for (const [label, run] of [
    ["admin-access-save", async (runner: TransactionRunner, steps: Step[]) => saveAdminAccessRule(
      collector(steps, "guild"),
      collector(steps, "audit"),
      "g1",
      { scope: GLOBAL_ADMIN_SCOPE_ID, access: { updatedBy: "u1", updatedAt: new Date() }, legacyKeys: [], audit, operationId: "op-3" },
      runner
    )],
    ["admin-access-delete", async (runner: TransactionRunner, steps: Step[]) => deleteAdminAccessRule(
      collector(steps, "guild"),
      collector(steps, "audit"),
      "g1",
      { scope: "global", lookupKeys: [], audit, operationId: "op-4" },
      runner
    )]
  ] as const) {
    const steps: Step[] = [];
    const { runner } = recordingRunner(steps);
    await run(runner, steps);
    const writes = steps.filter(entry => entry.step.includes("."));
    assert.equal(writes.length, 2, `${label}: regula si auditul`);
    assert.deepEqual([...new Set(writes.map(entry => entry.session))], [SESSION_LABEL], `${label}: aceeasi sesiune`);
    assert.ok(steps.some(entry => entry.step === `commit:${label}`), `${label}: tranzactie confirmata`);
  }
});

test("fara runner injectat, operatiile raman secventiale si functionale", async () => {
  const steps: Step[] = [];
  await loadConfigBackupWithAudit(
    collector(steps, "guild"),
    collector(steps, "audit"),
    "g1",
    { name: "prod", createdBy: "u1", createdAt: new Date(), snapshot: {} },
    audit,
    "op-5"
  );
  const writes = steps.filter(entry => entry.step.includes("."));
  assert.equal(writes.length, 2, "pe un Mongo fara replica set operatiile ruleaza in continuare");
  assert.deepEqual([...new Set(writes.map(entry => entry.session))], [null], "fara sesiune, dar fara sa se opreasca");
});
