import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import path from "node:path";

import { findLayerViolations, extractImports } from "../../scripts/check-layer-imports.js";

const srcRoot = process.cwd();
const GATE = path.join(srcRoot, "scripts", "check-layer-imports.ts");

test("gate-ul de straturi nu mai are niciun mecanism de exceptie", () => {
  const gate = fs.readFileSync(GATE, "utf8");
  for (const escape of ["allowlist", "ALLOWLIST", "waiver", "WAIVER", "exception", "EXCEPTION"]) {
    assert.ok(
      !gate.includes(escape),
      `"${escape}" ar reintroduce o cale de a lasa o incalcare sa treaca; o dependinta greu de rupt se rezolva ` +
        "prin injectie sau prin mutarea codului in stratul potrivit, nu printr-o exceptie permanenta"
    );
  }
});

test("regula se aplica uniform: o incalcare e raportata indiferent de fisierul care o produce", () => {
  const offending = extractImports(
    "features/oarecare/modulOarecare.ts",
    'import { ceva } from "../../infra/mongo/models.js";'
  );
  const violations = findLayerViolations(offending);
  assert.equal(violations.length, 1, "un import de valoare din infra/mongo intr-un feature e o incalcare");
  assert.match(violations[0].rule, /features acceseaza Mongo doar prin repositories/);
});

test("aceeasi cale, dar import de tip, nu e o incalcare", () => {
  const typeOnly = extractImports(
    "features/oarecare/modulOarecare.ts",
    'import type { Ceva } from "../../infra/mongo/models.js";'
  );
  assert.deepEqual(findLayerViolations(typeOnly), []);
});

test("motorul de jurnal traieste in shared, ca features sa il poata folosi fara exceptie", () => {
  assert.ok(
    fs.existsSync(path.join(srcRoot, "shared", "operationJournalEngine.ts")),
    "motorul de jurnal nu are nimic specific Mongo: primeste modelul injectat, deci locul lui e in shared"
  );
  assert.ok(
    !fs.existsSync(path.join(srcRoot, "infra", "mongo", "operationJournal.ts")),
    "vechea locatie ar readuce muchia features -> infra/mongo"
  );
  const engine = fs.readFileSync(path.join(srcRoot, "shared", "operationJournalEngine.ts"), "utf8");
  assert.ok(!engine.includes("mongoose"), "motorul nu cunoaste driverul");
  assert.ok(!engine.includes("infra/"), "motorul nu importa din infrastructura");
});

test("consumatorii jurnalului importa din shared, nu din infra", () => {
  const consumers = [
    "features/admin-records/operationJournalRuntime.ts",
    "features/command-handlers/adminCommandAccessHandler.ts",
    "features/command-handlers/backupInteractionHandler.ts",
    "features/command-handlers/guildConfigurationAdminHandler.ts"
  ];
  for (const relative of consumers) {
    const source = fs.readFileSync(path.join(srcRoot, relative), "utf8");
    assert.match(source, /shared\/operationJournalEngine\.js/, `${relative} importa motorul din shared`);
    assert.ok(!source.includes("infra/mongo/operationJournal"), `${relative} nu mai atinge vechea locatie`);
  }
});
