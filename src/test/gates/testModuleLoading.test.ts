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
    cuRequire.length <= 45,
    "repo-ul a migrat la ESM, dar testele mai incarca module prin `createRequire`. Numarul are voie sa scada, " +
      `nu sa creasca: gasite ${cuRequire.length}, plafon 45. Un test nou trebuie sa foloseasca import sau ` +
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

test("modulele native ale Node se incarca prin import static, nu prin require in corpul testului", () => {
  const offenders: string[] = [];
  for (const file of fisiereTest(testRoot)) {
    const source = fs.readFileSync(file, "utf8");
    for (const [index, line] of source.split("\n").entries()) {
      if (!/require\("(?:node:)?(?:fs|path|os|crypto|url|util|zlib|child_process|events)"\)/.test(line)) continue;
      offenders.push(`${path.relative(process.cwd(), file)}:${index + 1}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "un modul built-in al Node nu are nevoie de createRequire; importul static il aduce cu tipul real: " +
      offenders.join(" | ")
  );
});

test("un require cu tip declarat explicit e deja echivalent cu un import, deci nu mai are motiv sa existe", () => {
  const offenders: string[] = [];
  for (const file of fisiereTest(testRoot)) {
    const source = fs.readFileSync(file, "utf8");
    for (const [index, line] of source.split("\n").entries()) {
      if (!/^\s*(?:export )?const .*require\("[^"]+"\) as typeof import\(/.test(line)) continue;
      offenders.push(`${path.relative(process.cwd(), file)}:${index + 1}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "forma `require(x) as typeof import(x)` aplica deja tipul real, deci migrarea la import nu poate schimba tipuri: " +
      offenders.join(" | ")
  );
});
