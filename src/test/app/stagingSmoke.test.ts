import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
import test from "node:test";
import assert from "node:assert/strict";

const smoke = require("../../scripts/stagingSmoke") as {
  evaluateHealthBody: (body: unknown) => { ok: boolean; problems: string[] };
  evaluateMetricsText: (text: string, requiredNames?: string[]) => { ok: boolean; missing: string[] };
  REQUIRED_METRICS: string[];
};

test("evaluateHealthBody: raspuns sanatos -> ok", () => {
  const result = smoke.evaluateHealthBody({ status: "ok", mongo: 1, discord: "ready", uptimeMs: 1234 });
  assert.equal(result.ok, true, "status ok + mongo 1 + discord ready -> ok");
  assert.deepEqual(result.problems, []);
});

test("evaluateHealthBody: degraded / campuri lipsa -> probleme", () => {
  const degraded = smoke.evaluateHealthBody({ status: "degraded", mongo: 0, discord: "not-ready", uptimeMs: 10 });
  assert.equal(degraded.ok, false);
  assert.ok(degraded.problems.some(p => p.includes("status != ok")));
  assert.ok(degraded.problems.some(p => p.includes("discord != ready")));
  assert.ok(degraded.problems.some(p => p.includes("mongo readyState != 1")));

  const nonObject = smoke.evaluateHealthBody("nu este json");
  assert.equal(nonObject.ok, false, "corp ne-obiect -> probleme");

  const missingUptime = smoke.evaluateHealthBody({ status: "ok", mongo: 1, discord: "ready" });
  assert.ok(missingUptime.problems.some(p => p.includes("uptimeMs")), "uptimeMs lipsa raportat");
});

test("evaluateMetricsText: toate metricile cheie prezente -> ok", () => {
  const text = [
    "# HELP bot_uptime_seconds Bot uptime",
    "# TYPE bot_uptime_seconds gauge",
    "bot_uptime_seconds 42",
    "bot_fetch_success 10",
    "bot_outbox_queue_depth 0",
    "bot_native_fallback_total 0"
  ].join("\n");
  const result = smoke.evaluateMetricsText(text);
  assert.equal(result.ok, true, "toate cele 4 metrici cheie prezente ca linii de valoare");
  assert.deepEqual(result.missing, []);
});

test("evaluateMetricsText: metrica lipsa este raportata, iar prezenta doar in HELP nu conteaza", () => {
  const text = [
    "# HELP bot_uptime_seconds Bot uptime",
    "bot_uptime_seconds 42",
    "bot_fetch_success 10",
    "bot_outbox_queue_depth 0"
  ].join("\n");
  const result = smoke.evaluateMetricsText(text);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ["bot_native_fallback_total"], "metrica absenta ca linie de valoare e raportata lipsa");

  const onlyHelp = smoke.evaluateMetricsText("# HELP bot_uptime_seconds Bot uptime", ["bot_uptime_seconds"]);
  assert.deepEqual(onlyHelp.missing, ["bot_uptime_seconds"], "aparitia doar in linia HELP nu satisface verificarea");
});
