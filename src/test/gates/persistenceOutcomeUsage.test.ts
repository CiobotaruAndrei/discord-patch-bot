import test from "node:test";
import assert from "node:assert/strict";

import { loadModulesIn, comparisons, importedModules } from "./sourceStructureQueries.js";
import type { ModuleQuery } from "./sourceStructureQueries.js";

const LAYERS: ReadonlyArray<readonly string[]> = [
  ["app"], ["app", "health"], ["app", "runtime"], ["app", "scheduler"], ["app", "lifecycle"],
  ["features", "notifications"], ["features", "command-handlers"], ["features", "command-security"],
  ["features", "guild-config"], ["features", "admin-records"], ["features", "moderation"], ["features", "youtube"],
  ["domain", "deals"], ["infra", "mongo"], ["infra", "redis"], ["infra", "http"],
  ["sources"], ["sources", "updates"], ["sources", "deals"], ["shared"]
];

const OWN_MODULE = "shared/persistenceOutcome.ts";
const WRITE_COUNTERS = /(^|\.)((matched|modified|upserted)Count)$/;

function layerModules(): ModuleQuery[] {
  return LAYERS
    .flatMap(directory => loadModulesIn(directory, name => name.endsWith(".ts")))
    .filter(query => query.relativePath !== OWN_MODULE);
}

function readsWriteCounter(expression: string): boolean {
  const normalized = expression.replace(/[()\s]/g, "").split(/\?\?|\|\|/)[0];
  return WRITE_COUNTERS.test(normalized.replace(/\?\./g, "."));
}

test("niciun modul nu mai interpreteaza singur contoarele de scriere Mongo", () => {
  const offenders: string[] = [];
  for (const query of layerModules()) {
    for (const comparison of comparisons(query)) {
      if (!readsWriteCounter(comparison.left) && !readsWriteCounter(comparison.right)) continue;
      offenders.push(`${query.relativePath}:${comparison.line} (${comparison.left} ${comparison.operator} ${comparison.right})`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "zero-inseamna-esec e o conventie nescrisa: `modifiedCount === 0` inseamna alt lucru decat `matchedCount === 0`, " +
      "iar `!== 0` citeste un contor absent drept succes. Vocabularul e in shared/persistenceOutcome.ts " +
      `(classifyWrite / createdDocument / updatedDocument / changedDocument / matchedDocument / modifiedDocuments): ${offenders.join(" | ")}`
  );
});

test("vocabularul de rezultat e folosit acolo unde se decid scrierile, nu doar declarat", () => {
  const users = layerModules().filter(query =>
    importedModules(query).some(module => module.endsWith("shared/persistenceOutcome.js"))
  );
  assert.ok(
    users.length >= 15,
    `doar ${users.length} module folosesc vocabularul de rezultat; daca scade, inseamna ca cineva s-a intors la contoare brute`
  );
});
