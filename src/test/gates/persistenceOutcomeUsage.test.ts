import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import path from "node:path";

const srcRoot = process.cwd();
const LAYERS: readonly string[] = ["app", "features", "domain", "infra", "sources", "shared"];
const OWN_MODULE = path.join("shared", "persistenceOutcome.ts");

const RAW_COMPARISONS: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  { pattern: /\(\s*\w+(?:\?)?\.(?:matched|modified|upserted)Count\s*(?:\?\?|\|\|)[^)]*\)\s*(?:>|===|!==|==|!=)/, why: "contorul citit cu fallback si comparat direct" },
  { pattern: /\w+(?:\?)?\.(?:matched|modified|upserted)Count\s*(?:>|<|===|!==|==|!=)\s*\d/, why: "contorul comparat direct cu un numar" }
];

function sourceFiles(): string[] {
  const found: string[] = [];
  for (const layer of LAYERS) {
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

test("niciun modul nu mai interpreteaza singur contoarele de scriere Mongo", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    const relative = path.relative(srcRoot, file);
    if (relative === OWN_MODULE) continue;
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      for (const { pattern, why } of RAW_COMPARISONS) {
        if (pattern.test(line)) offenders.push(`${relative}:${index + 1} (${why})`);
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    "zero-inseamna-esec e o conventie nescrisa: modifiedCount === 0 inseamna alt lucru decat matchedCount === 0, " +
      "iar !== 0 citeste un contor absent drept succes. Vocabularul e in shared/persistenceOutcome.ts " +
      `(classifyWrite / createdDocument / updatedDocument / changedDocument / matchedDocument / modifiedDocuments): ${offenders.join(" | ")}`
  );
});

test("vocabularul de rezultat e folosit acolo unde se decid scrierile, nu doar declarat", () => {
  const users = sourceFiles().filter(file => {
    const relative = path.relative(srcRoot, file);
    if (relative === OWN_MODULE) return false;
    return fs.readFileSync(file, "utf8").includes("shared/persistenceOutcome.js");
  });
  assert.ok(
    users.length >= 15,
    `doar ${users.length} module folosesc vocabularul de rezultat; daca scade, inseamna ca cineva s-a intors la contoare brute`
  );
});
