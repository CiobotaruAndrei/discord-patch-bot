import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import path from "node:path";

import {
  loadModule,
  allMembers,
  calls,
  declaresType,
  exportedTypeNames,
  functionNames,
  identifierNames,
  importedModules,
  mutatedPropertyPaths,
  returnedObjectProperties
} from "./sourceStructureQueries.js";
import type { ModuleQuery } from "./sourceStructureQueries.js";

const srcRoot = process.cwd();
const OWNS_THE_STORE: readonly string[] = [
  "app/health/metrics.ts",
  "app/health/metricsTypes.ts",
  "app/health/metricsRegistry.ts",
  "app/health/metricRecorders.ts",
  "app/health/httpServer.ts"
];

const recorders = loadModule("app", "health", "metricRecorders.ts");
const ports = loadModule("shared", "metricRecorderPorts.ts");
const registry = loadModule("app", "health", "metricsRegistry.ts");

function modulesUnder(...layers: readonly string[]): ModuleQuery[] {
  const found: ModuleQuery[] = [];
  for (const layer of layers) {
    const stack: string[][] = [[layer]];
    while (stack.length) {
      const current = stack.pop();
      if (!current) continue;
      const absolute = path.join(srcRoot, ...current);
      if (!fs.existsSync(absolute)) continue;
      for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          stack.push([...current, entry.name]);
          continue;
        }
        if (entry.name.endsWith(".ts")) found.push(loadModule(...current, entry.name));
      }
    }
  }
  return found;
}

test("registrul de recorderi acopera fiecare domeniu care contorizeaza ceva", () => {
  assert.ok(functionNames(recorders).includes("createMetricRecorders"), "registrul are o fabrica exportata");
  const domains = returnedObjectProperties(recorders, "createMetricRecorders");
  for (const domain of ["security", "inspector", "threatEngine", "permissionDelegation", "http", "redis", "cron"]) {
    assert.ok(domains.includes(domain), `registrul expune recorderul ${domain}`);
  }
});

test("recorderele au verbe, nu campuri: niciun nume de contor nu apare in porturi", () => {
  const names = identifierNames(ports);
  for (const field of ["securityThreatsDeleted", "nativeInspectorKills", "threatEngineScans", "fetchSuccess", "redisCacheHit", "cronRuns"]) {
    assert.ok(
      !names.has(field),
      `${field} e numele campului din magazin; portul recorderului vorbeste in verbe, nu in campuri`
    );
  }
  assert.ok(!names.has("BotMetrics"), "portul nu cunoaste forma magazinului de contoare");
});

test("porturile de recorder traiesc in shared, ca features sa nu depinda de composition root", () => {
  const exported = exportedTypeNames(ports);
  for (const port of [
    "SecurityMetricRecorder",
    "InspectorMetricRecorder",
    "ThreatEngineMetricRecorder",
    "PermissionDelegationMetricRecorder",
    "MetricRecorders"
  ]) {
    assert.ok(exported.includes(port), `portul ${port} e declarat si exportat din shared`);
    assert.ok(declaresType(ports, port), `${port} e un contract, nu doar un re-export`);
  }
  const offenders: string[] = [];
  for (const query of modulesUnder("features", "sources", "domain", "infra")) {
    if (importedModules(query).some(module => module.includes("app/health/metricRecorders"))) {
      offenders.push(query.relativePath);
    }
  }
  assert.deepEqual(offenders, [], `${offenders.join(", ")} importa implementarea din app; portul e in shared`);
});

test("features si sources nu mai scriu direct in contoarele partajate", () => {
  const offenders: string[] = [];
  for (const query of modulesUnder("features", "sources", "domain")) {
    for (const site of mutatedPropertyPaths(query)) {
      if (!/^metrics(\?)?\./.test(site.path)) continue;
      offenders.push(`${query.relativePath}:${site.line} (${site.path})`);
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
  const written = new Set<string>();
  for (const call of calls(recorders)) {
    if (call.callee !== "bump" && call.callee !== "assign") continue;
    if (call.args[0] !== "metrics") continue;
    const field = call.args[1];
    if (field && /^"[A-Za-z]+"$/.test(field)) written.add(field.slice(1, -1));
  }
  for (const site of mutatedPropertyPaths(recorders)) {
    const match = /^metrics\.([A-Za-z]+)$/.exec(site.path);
    if (match) written.add(match[1]);
  }
  assert.ok(written.size > 0, "recorderele scriu contoare (altfel testul nu verifica nimic)");
  const exposed = new Set(mutatedPropertyPaths(registry).map(site => site.path));
  for (const call of calls(registry)) {
    for (const argument of call.args) {
      const match = /^metrics\.([A-Za-z]+)$/.exec(argument);
      if (match) exposed.add(argument);
    }
  }
  const registryIdentifiers = identifierNames(registry);
  const missing = [...written].filter(field => !exposed.has(`metrics.${field}`) && !registryIdentifiers.has(field));
  assert.deepEqual(
    missing,
    [],
    "un contor scris de un recorder dar neexpus de metricsRegistry e invizibil in productie " +
      `(exact cazul lui securityThreatDeleteFailures): ${missing.join(", ")}`
  );
});

test("doar modulele de sanatate cunosc forma completa a magazinului de contoare", () => {
  const offenders: string[] = [];
  for (const query of modulesUnder("features", "sources", "domain", "infra")) {
    if (OWNS_THE_STORE.includes(query.relativePath)) continue;
    const asksForStore = allMembers(query).some(member => member.name === "metrics" && member.type === "BotMetrics");
    if (asksForStore) offenders.push(query.relativePath);
  }
  assert.deepEqual(
    offenders,
    [],
    `${offenders.join(", ")} cer intreg BotMetrics; un feature primeste recorderul lui, nu tot magazinul`
  );
});
