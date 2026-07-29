import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";

const testRoot = path.join(process.cwd(), "test");

function fisiereTest(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return fisiereTest(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

test("niciun test nou nu mai introduce createRequire", () => {
  const cuRequire = fisiereTest(testRoot)
    .filter(file => path.basename(file) !== "testModuleLoading.test.ts")
    .filter(file => fs.readFileSync(file, "utf8").includes("createRequire"));
  assert.ok(
    cuRequire.length <= 48,
    "repo-ul a migrat la ESM, dar testele mai incarca module prin `createRequire`. Numarul are voie sa scada, " +
      `nu sa creasca: gasite ${cuRequire.length}, plafon 48. Un test nou trebuie sa foloseasca import sau ` +
      "`await import`, ca tipurile reale ale modulului sa fie verificate"
  );
});

test("modulele migrate chiar folosesc import, nu require deghizat", () => {
  for (const relativ of [path.join("mongo", "acquireDbLock.functional.test.ts"), path.join("native", "rustFuzzy.test.ts")]) {
    const text = fs.readFileSync(path.join(testRoot, relativ), "utf8");
    assert.ok(!text.includes("createRequire"), `${relativ} a fost migrat si nu are voie sa revina la createRequire`);
    assert.ok(
      text.includes("await import("),
      `${relativ} incarca modulele prin import dinamic, deci tipurile reale ale modulului sunt verificate`
    );
  }
});
