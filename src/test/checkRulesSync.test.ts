import test from "node:test";
import assert from "node:assert/strict";

const fs = require("fs") as typeof import("fs");
const path = require("path") as typeof import("path");
const mod = require("../scripts/check-rules-sync") as typeof import("../scripts/check-rules-sync");
const { parseAlertRules, analyzeRulesSync, extractEmittedMetrics, extractMetricNames } = mod;

const VALID_RULE = `groups:
  - name: g1
    rules:
      - alert: AlphaHigh
        expr: bot_alpha > 1
        labels:
          severity: warning
        annotations:
          summary: "Alpha high"
      - alert: BetaHigh
        expr: bot_beta > 2
        labels:
          severity: critical
        annotations:
          summary: "Beta high"
`;

test("parseAlertRules extrage nume, expr, severity, summary si metrici", () => {
  const { rules, malformed, duplicateAlerts } = parseAlertRules(VALID_RULE);
  assert.equal(rules.length, 2);
  assert.equal(malformed.length, 0);
  assert.equal(duplicateAlerts.length, 0);
  const alpha = rules.find(r => r.name === "AlphaHigh");
  assert.ok(alpha);
  assert.equal(alpha?.severity, "warning");
  assert.equal(alpha?.summary, "Alpha high");
  assert.deepEqual(alpha?.metrics, ["bot_alpha"]);
});

test("parseAlertRules semnaleaza regula incompleta (lipsa summary)", () => {
  const yaml = `groups:
  - name: g
    rules:
      - alert: NoSummary
        expr: bot_x > 1
        labels:
          severity: warning
`;
  const { malformed } = parseAlertRules(yaml);
  assert.equal(malformed.length, 1);
  assert.match(malformed[0], /NoSummary/);
  assert.match(malformed[0], /summary/);
});

test("parseAlertRules semnaleaza nume de alerta duplicat", () => {
  const yaml = `groups:
  - name: g
    rules:
      - alert: Dup
        expr: bot_a > 1
        labels:
          severity: warning
        annotations:
          summary: "x"
      - alert: Dup
        expr: bot_b > 1
        labels:
          severity: warning
        annotations:
          summary: "y"
`;
  const { duplicateAlerts } = parseAlertRules(yaml);
  assert.deepEqual(duplicateAlerts, ["Dup"]);
});

test("analyzeRulesSync esueaza cand o alerta refera o metrica neemisa", () => {
  const emitted = new Set<string>(["bot_alpha"]);
  const report = analyzeRulesSync({ alertsText: VALID_RULE, dashboardText: "{}", emitted });
  assert.ok(report.missing.includes("bot_beta"), "bot_beta nu e emisa => missing");
  assert.equal(report.pass, false);
});

test("analyzeRulesSync trece cand toate metricile referite sunt emise", () => {
  const emitted = new Set<string>(["bot_alpha", "bot_beta"]);
  const report = analyzeRulesSync({ alertsText: VALID_RULE, dashboardText: "{}", emitted });
  assert.equal(report.missing.length, 0);
  assert.equal(report.malformed.length, 0);
  assert.equal(report.duplicateAlerts.length, 0);
  assert.equal(report.pass, true);
});

test("analyzeRulesSync raporteaza metrici orfane fara sa esueze (info, nu fail)", () => {
  const emitted = new Set<string>(["bot_alpha", "bot_beta", "bot_orfan"]);
  const report = analyzeRulesSync({ alertsText: VALID_RULE, dashboardText: "{}", emitted });
  assert.ok(report.orphans.includes("bot_orfan"));
  assert.equal(report.pass, true, "orfanii sunt informativi, nu blocheaza");
});

test("extractEmittedMetrics parseaza apelurile pushMetric", () => {
  const src = `pushMetric(lines, seenMetricNames, "bot_uptime_seconds", "gauge", "x", 1);
pushMetric(lines, seenMetricNames, "bot_fetch_success", "counter", "y", 2);`;
  const emitted = extractEmittedMetrics(src);
  assert.ok(emitted.has("bot_uptime_seconds"));
  assert.ok(emitted.has("bot_fetch_success"));
  assert.equal(emitted.size, 2);
});

test("extractMetricNames deduplica numele de metrici", () => {
  assert.deepEqual(extractMetricNames("bot_a > 1 and bot_a < 2 or bot_b > 0").sort(), ["bot_a", "bot_b"]);
});

test("gate real: regulile reale din repo sunt sincronizate cu metricile emise", () => {
  const srcRoot = process.cwd();
  const repoRoot = path.resolve(srcRoot, "..");
  const alertsText = fs.readFileSync(path.join(repoRoot, "monitoring", "prometheus-alerts.yml"), "utf8");
  const dashboardText = fs.readFileSync(path.join(repoRoot, "monitoring", "grafana-dashboard.json"), "utf8");
  const httpServerSource = fs.readFileSync(path.join(srcRoot, "app", "health", "httpServer.ts"), "utf8");
  const emitted = extractEmittedMetrics(httpServerSource);
  const report = analyzeRulesSync({ alertsText, dashboardText, emitted });
  assert.equal(report.missing.length, 0, `metrici referite dar neemise: ${report.missing.join(", ")}`);
  assert.equal(report.malformed.length, 0, `reguli incomplete: ${report.malformed.join("; ")}`);
  assert.equal(report.duplicateAlerts.length, 0, `alerte duplicate: ${report.duplicateAlerts.join(", ")}`);
  assert.equal(report.pass, true);
});
