import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLayerReport,
  extractImports,
  findImportCycles,
  findLayerViolations,
  layerOf,
  resolveRelativeImport
} from "../../scripts/check-layer-imports.js";

test("extractImports vede importuri statice, type-only, dinamice si re-exporturi relative", () => {
  const source = [
    'import { a } from "../../app/runtimeComposition.js";',
    'import type { B } from "../../infra/mongo/modelTypes.js";',
    'export { c } from "./local.js";',
    'const lazy = await import("../../domain/deals/filtersCore.js");',
    'import axios from "axios";',
    'import * as fs from "node:fs";'
  ].join("\n");
  const imports = extractImports("features/x/y.ts", source);
  assert.deepEqual(imports, [
    { from: "features/x/y.ts", to: "app/runtimeComposition.ts", typeOnly: false },
    { from: "features/x/y.ts", to: "infra/mongo/modelTypes.ts", typeOnly: true },
    { from: "features/x/y.ts", to: "features/x/local.ts", typeOnly: false },
    { from: "features/x/y.ts", to: "domain/deals/filtersCore.ts", typeOnly: false }
  ], "pachetele npm si node: sunt ignorate; doar importurile relative .js -> .ts conteaza");
});

test("layerOf si resolveRelativeImport normalizeaza caile pe straturi", () => {
  assert.equal(layerOf("infra/redis/redisContext.ts"), "infra");
  assert.equal(layerOf("test/gates/x.ts"), null);
  assert.equal(resolveRelativeImport("sources/steam/steamSource.ts", "../../app/bootstrap.js"), "app/bootstrap.ts");
});

test("infra -> app si sources -> app sunt interzise, cu exceptia allowlist-ului de datorie cunoscuta (review nou #23)", () => {
  const violations = findLayerViolations([
    { from: "infra/redis/altNou.ts", to: "app/runtimeComposition.ts", typeOnly: false },
    { from: "infra/redis/redisCacheContext.ts", to: "app/runtimeComposition.ts", typeOnly: false },
    { from: "sources/sourceRegistry.ts", to: "app/runtimeComposition.ts", typeOnly: false },
    { from: "sources/steam/steamNou.ts", to: "app/bootstrap.ts", typeOnly: false }
  ]);
  assert.deepEqual(violations.map(violation => violation.from), ["infra/redis/altNou.ts", "infra/redis/redisCacheContext.ts", "sources/sourceRegistry.ts", "sources/steam/steamNou.ts"],
    "allowlist-urile infra->app si sources->app sunt GOALE dupa rezolvarea Major #1 (felia Redis) si Major #8: ORICE import infra->app sau sources->app pica, inclusiv fostii locatori");
});

test("domain si shared raman pure: orice dependinta spre straturile impure pica", () => {
  const violations = findLayerViolations([
    { from: "domain/deals/filtersCore.ts", to: "infra/mongo/models.ts", typeOnly: false },
    { from: "shared/errors.ts", to: "features/notifications/index.ts", typeOnly: true }
  ]);
  assert.equal(violations.length, 2, "regula se aplica si importurilor de tip: domain/shared nu cunosc straturile de sus");
});

test("features acceseaza Mongo doar prin repositories/DI: importul de VALORI din infra/mongo pica, cel de tip ramane permis", () => {
  const violations = findLayerViolations([
    { from: "features/notifications/notificationRuntimeContracts.ts", to: "infra/mongo/modelTypes.ts", typeOnly: true },
    { from: "features/command-handlers/vreunHandler.ts", to: "infra/mongo/models.ts", typeOnly: false },
    { from: "features/command-runtime/commandRuntimeDependencies.ts", to: "infra/mongo/mongoContext.ts", typeOnly: false }
  ]);
  assert.deepEqual(violations.map(violation => violation.from), ["features/command-handlers/vreunHandler.ts"],
    "tipurile sunt contracte (permise), valorile doar prin allowlist-ul de wiring cunoscut");
});

test("ciclurile de importuri runtime sunt detectate; muchiile type-only nu creeaza cicluri", () => {
  const cycles = findImportCycles([
    { from: "features/a.ts", to: "features/b.ts", typeOnly: false },
    { from: "features/b.ts", to: "features/c.ts", typeOnly: false },
    { from: "features/c.ts", to: "features/a.ts", typeOnly: false },
    { from: "app/x.ts", to: "app/y.ts", typeOnly: false },
    { from: "app/y.ts", to: "app/x.ts", typeOnly: true }
  ]);
  assert.equal(cycles.length, 1, "un singur ciclu real: a -> b -> c -> a; x <-> y e rupt de muchia type-only");
  assert.ok(cycles[0].includes("features/a.ts") && cycles[0].includes("features/c.ts"));
});

test("codul REAL respecta regulile de dependinte intre straturi (gard viu, review nou #23)", () => {
  const report = buildLayerReport(process.cwd());
  assert.deepEqual(report.violations, [], "fara incalcari noi de strat (datoria cunoscuta e in allowlist explicit)");
  assert.deepEqual(report.cycles, [], "fara cicluri de importuri runtime");
  assert.ok(report.moduleCount > 300, `scanner-ul chiar parcurge sursele (${report.moduleCount} module)`);
  assert.equal(report.pass, true);
});
