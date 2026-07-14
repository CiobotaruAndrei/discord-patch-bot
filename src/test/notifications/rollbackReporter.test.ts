import test from "node:test";
import assert from "node:assert/strict";

import { rollbackOrReport } from "../../features/notifications/rollbackReporter.js";

function makeLogger() {
  const logs: Array<{ level: string; context: string; message: string; meta?: unknown }> = [];
  const logger = (level: "WARN", context: string, message: string, meta?: unknown) => {
    logs.push({ level, context, message, meta });
  };
  return { logger, logs };
}

test("rollbackOrReport: cand rollback-ul reuseste, nu logheaza si nu raporteaza", async () => {
  const { logger, logs } = makeLogger();
  const reports: unknown[] = [];
  await rollbackOrReport(async () => undefined, logger, { guildId: "g1", kind: "youtube", itemId: "vid1" }, (ctx, err) => { reports.push({ ctx, err }); });
  assert.equal(logs.length, 0, "succesul nu produce zgomot");
  assert.equal(reports.length, 0, "succesul nu declanseaza alerta");
});

test("rollbackOrReport: cand rollback-ul arunca, logheaza WARN si raporteaza contextul + eroarea (R21 #3)", async () => {
  const { logger, logs } = makeLogger();
  const reports: Array<{ ctx: { guildId: string; kind: string; itemId: string }; err: unknown }> = [];
  const boom = new Error("mongo write failed");
  await rollbackOrReport(async () => { throw boom; }, logger, { guildId: "g1", kind: "youtube", itemId: "vid1" }, (ctx, err) => { reports.push({ ctx, err }); });

  assert.equal(logs.length, 1, "esecul de rollback nu mai e inghitit silentios");
  assert.equal(logs[0].level, "WARN");
  assert.equal(logs[0].context, "ROLLBACK");
  assert.match(logs[0].message, /vid1/);
  assert.equal(logs[0].meta, "mongo write failed");
  assert.equal(reports.length, 1, "se emite un semnal operational (admin alert)");
  assert.deepEqual(reports[0].ctx, { guildId: "g1", kind: "youtube", itemId: "vid1" });
  assert.equal(reports[0].err, boom);
});

test("rollbackOrReport: fara callback de raportare, esecul tot se logheaza (nu crapa)", async () => {
  const { logger, logs } = makeLogger();
  await rollbackOrReport(async () => { throw new Error("x"); }, logger, { guildId: "g1", kind: "price-alert", itemId: "elden-ring:EUR" });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].context, "ROLLBACK");
});
