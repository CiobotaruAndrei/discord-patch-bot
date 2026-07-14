import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";

const srcRoot = process.cwd();
const repoRoot = path.resolve(srcRoot, "..");
const alertsPath = path.join(repoRoot, "monitoring", "prometheus-alerts.yml");
const dashboardPath = path.join(repoRoot, "monitoring", "grafana-dashboard.json");
const metricsRegistryPath = path.join(srcRoot, "app", "health", "metricsRegistry.ts");

function emittedMetricNames(): Set<string> {
  const text = fs.readFileSync(metricsRegistryPath, "utf8");
  const names = new Set<string>();
  const re = /pushMetric\(lines, seenMetricNames, "([a-z_0-9]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) names.add(m[1]);
  return names;
}

function referencedBotMetrics(text: string): string[] {
  return Array.from(new Set(text.match(/bot_[a-z_0-9]+/g) || []));
}

test("monitoring: fisierele de alerte si dashboard exista", () => {
  assert.ok(fs.existsSync(alertsPath), "prometheus-alerts.yml exista");
  assert.ok(fs.existsSync(dashboardPath), "grafana-dashboard.json exista");
});

test("monitoring: dashboard-ul Grafana e JSON valid cu panouri", () => {
  const dash = JSON.parse(fs.readFileSync(dashboardPath, "utf8")) as { panels?: unknown[]; title?: string };
  assert.equal(typeof dash.title, "string");
  assert.ok(Array.isArray(dash.panels) && dash.panels.length > 0, "are panouri");
});

test("monitoring: alertele Prometheus refera doar metrici emise de httpServer", () => {
  const valid = emittedMetricNames();
  assert.ok(valid.has("bot_outbox_queue_depth"), "sanity: setul de metrici emise e populat");
  const text = fs.readFileSync(alertsPath, "utf8");
  for (const metric of referencedBotMetrics(text)) {
    assert.ok(valid.has(metric), `alerta refera o metrica inexistenta la /metrics: ${metric}`);
  }
});

test("monitoring: dashboard-ul refera doar metrici emise de httpServer", () => {
  const valid = emittedMetricNames();
  const text = fs.readFileSync(dashboardPath, "utf8");
  for (const metric of referencedBotMetrics(text)) {
    assert.ok(valid.has(metric), `dashboard-ul refera o metrica inexistenta la /metrics: ${metric}`);
  }
});

test("monitoring: exista alertele cheie cerute (queue depth, mark-sent, recovery-verify, lock)", () => {
  const text = fs.readFileSync(alertsPath, "utf8");
  for (const alertName of ["OutboxQueueDepthHigh", "OutboxMarkSentFailures", "OutboxRecoveryVerifyFailures", "OutboxLockAcquireFailures"]) {
    assert.ok(text.includes(`alert: ${alertName}`), `lipseste alerta ${alertName}`);
  }
});
