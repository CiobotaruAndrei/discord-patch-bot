import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import path from "node:path";

const srcRoot = process.cwd();
const RECORDERS = "app/health/metricRecorders.ts";
const PORTS = "shared/metricRecorderPorts.ts";
const OWNS_THE_STORE: readonly string[] = [
  "app/health/metrics.ts",
  "app/health/metricsTypes.ts",
  "app/health/metricsRegistry.ts",
  "app/health/metricRecorders.ts",
  "app/health/httpServer.ts"
];

function sourceFiles(...layers: string[]): string[] {
  const found: string[] = [];
  for (const layer of layers) {
    const stack = [path.join(srcRoot, layer)];
    while (stack.length) {
      const current = stack.pop();
      if (!current || !fs.existsSync(current)) continue;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.name.endsWith(".ts")) found.push(full);
      }
    }
  }
  return found;
}

test("registrul de recorderi acopera fiecare domeniu care contorizeaza ceva", () => {
  const recorders = fs.readFileSync(path.join(srcRoot, RECORDERS), "utf8");
  for (const domain of ["security", "inspector", "threatEngine", "permissionDelegation", "http", "redis", "cron"]) {
    assert.match(recorders, new RegExp(`^\\s+${domain}: \\{`, "m"), `registrul expune recorderul ${domain}`);
  }
  assert.match(recorders, /export function createMetricRecorders/);
});

test("recorderele au verbe, nu campuri: niciun nume de metrica nu apare in porturi", () => {
  const ports = fs.readFileSync(path.join(srcRoot, PORTS), "utf8");
  for (const field of ["securityThreatsDeleted", "nativeInspectorKills", "threatEngineScans", "fetchSuccess", "redisCacheHit", "cronRuns"]) {
    assert.ok(
      !ports.includes(field),
      `${field} e numele campului din magazin; portul recorderului trebuie sa vorbeasca in verbe, nu in campuri`
    );
  }
  assert.ok(!ports.includes("BotMetrics"), "portul nu cunoaste forma magazinului de contoare");
});

test("porturile de recorder traiesc in shared, ca features sa nu depinda de composition root", () => {
  const ports = fs.readFileSync(path.join(srcRoot, PORTS), "utf8");
  for (const port of ["SecurityMetricRecorder", "InspectorMetricRecorder", "ThreatEngineMetricRecorder", "PermissionDelegationMetricRecorder", "MetricRecorders"]) {
    assert.match(ports, new RegExp(`^export interface ${port}\\b`, "m"), `portul ${port} e declarat in shared`);
  }
  const offenders: string[] = [];
  for (const file of sourceFiles("features", "sources", "domain", "infra")) {
    const relative = path.relative(srcRoot, file).split(path.sep).join("/");
    if (fs.readFileSync(file, "utf8").includes("app/health/metricRecorders.js")) offenders.push(relative);
  }
  assert.deepEqual(offenders, [], `${offenders.join(", ")} importa implementarea din app; portul e in shared`);
});

test("features si sources nu mai scriu direct in contoarele partajate", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles("features", "sources", "domain")) {
    const relative = path.relative(srcRoot, file).split(path.sep).join("/");
    const source = fs.readFileSync(file, "utf8");
    for (const [index, line] of source.split("\n").entries()) {
      if (!/\bmetrics(\?)?\.[a-zA-Z]+\s*(=|\+=|-=)/.test(line)) continue;
      offenders.push(`${relative}:${index + 1}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "scrierea directa intr-un camp de metrica leaga un feature de forma intregului obiect de contoare; " +
      `foloseste recorderul domeniului din app/health/metricRecorders.ts: ${offenders.join(" | ")}`
  );
});

test("fiecare contor scris de un recorder chiar ajunge in expunerea Prometheus", () => {
  const recorders = fs.readFileSync(path.join(srcRoot, RECORDERS), "utf8");
  const registry = fs.readFileSync(path.join(srcRoot, "app/health/metricsRegistry.ts"), "utf8");
  const written = new Set<string>();
  for (const match of recorders.matchAll(/(?:bump|assign)\(metrics, "([A-Za-z]+)"/g)) written.add(match[1]);
  for (const match of recorders.matchAll(/metrics\.([A-Za-z]+) = /g)) written.add(match[1]);

  const missing = [...written].filter(field => !registry.includes(`metrics.${field}`));
  assert.deepEqual(
    missing,
    [],
    "un contor scris de un recorder dar neexpus de metricsRegistry e invizibil in productie " +
      `(exact cazul lui securityThreatDeleteFailures): ${missing.join(", ")}`
  );
});

test("doar modulele de sanatate cunosc forma completa a magazinului de contoare", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles("features", "sources", "domain", "infra")) {
    const relative = path.relative(srcRoot, file).split(path.sep).join("/");
    if (OWNS_THE_STORE.includes(relative)) continue;
    const source = fs.readFileSync(file, "utf8");
    if (/\bmetrics:\s*BotMetrics\b/.test(source)) offenders.push(relative);
  }
  assert.deepEqual(
    offenders,
    [],
    `${offenders.join(", ")} cer intreg BotMetrics; un feature primeste recorderul lui, nu tot magazinul`
  );
});
