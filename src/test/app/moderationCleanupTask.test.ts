import test from "node:test";
import assert from "node:assert/strict";

import { createModerationCleanupTask, MODERATION_CLEANUP_INTERVAL_MS } from "../../app/scheduler/moderationCleanupTask.js";

type Harness = {
  runs: number;
  failures: number;
  logs: Array<{ level: string; message: string }>;
  alerts: Array<{ kind: string; title: string }>;
};

function makeHarness(cleanupExpired: () => Promise<void>) {
  const harness: Harness = { runs: 0, failures: 0, logs: [], alerts: [] };
  const runner = createModerationCleanupTask({
    cleanupExpired,
    metrics: {
      ran: () => { harness.runs += 1; },
      failed: () => { harness.failures += 1; }
    },
    logger: (level, _context, message) => { harness.logs.push({ level, message }); },
    adminAlert: async (kind, title) => { harness.alerts.push({ kind, title }); },
    errorMessage: err => String(err),
    errorDetail: err => String(err)
  });
  return { runner, harness };
}

test("curatarea periodica ruleaza la interval rezonabil si numara rularile reusite", async () => {
  let cleanups = 0;
  const { runner, harness } = makeHarness(async () => { cleanups++; });

  assert.equal(MODERATION_CLEANUP_INTERVAL_MS, 5 * 60 * 1000, "intervalul implicit e de cateva minute");
  const first = await runner.runNow();
  const second = await runner.runNow();

  assert.equal(first.status, "completed");
  assert.equal(second.status, "completed");
  assert.equal(cleanups, 2, "curatarea e idempotenta si ruleaza la fiecare tick");
  assert.equal(harness.runs, 2, "rularile reusite sunt numarate in metrica");
  assert.equal(harness.failures, 0);
  assert.equal(harness.alerts.length, 0);
});

test("esecul e logat si numarat; alerta admin apare DOAR dupa esecuri repetate", async () => {
  let shouldFail = true;
  const { runner, harness } = makeHarness(async () => {
    if (shouldFail) throw new Error("mongo indisponibil");
  });

  await runner.runNow();
  await runner.runNow();
  assert.equal(harness.failures, 2);
  assert.equal(harness.logs.filter(log => log.level === "ERROR").length, 2, "fiecare esec e logat");
  assert.equal(harness.alerts.length, 0, "sub prag nu se trimite alerta");

  await runner.runNow();
  assert.equal(harness.alerts.length, 1, "al treilea esec consecutiv declanseaza alerta admin");
  assert.equal(harness.alerts[0].kind, "moderation:cleanup-periodic");

  await runner.runNow();
  await runner.runNow();
  assert.equal(harness.alerts.length, 1, "dupa alerta, contorul se reseteaza - nu se spameaza la fiecare esec");

  shouldFail = false;
  await runner.runNow();
  assert.equal(harness.runs, 1, "revenirea e numarata ca rulare reusita");
  shouldFail = true;
  await runner.runNow();
  await runner.runNow();
  assert.equal(harness.alerts.length, 1, "succesul reseteaza seria de esecuri consecutive");
});
