import test from "node:test";
import assert from "node:assert/strict";

import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const srcRoot = process.cwd();

function readPackageScripts(): Record<string, string> {
  const raw = fs.readFileSync(path.join(srcRoot, "package.json"), "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || !("scripts" in parsed)) {
    throw new Error("package.json nu are sectiunea scripts");
  }
  const scripts = (parsed as { scripts: unknown }).scripts;
  if (typeof scripts !== "object" || scripts === null) throw new Error("scripts nu e un obiect");
  return scripts as Record<string, string>;
}

function collectTypeScriptSources(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "target") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectTypeScriptSources(full, found);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) found.push(full);
  }
  return found;
}

test("niciun modul TypeScript nu importa static artefactele generate de napi", () => {
  const offenders: string[] = [];
  for (const file of collectTypeScriptSources(srcRoot)) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/^\s*(?:import|export)[^;]*?from\s+"([^"]+)"/gm)) {
      const specifier = match[1];
      if (/(^|\/)native\/index\.(js|cjs|mjs)$/.test(specifier) || /(^|\/)\.\.?\/index\.js$/.test(specifier) && file.includes(`${path.sep}native${path.sep}`)) {
        offenders.push(`${path.relative(srcRoot, file)} -> ${specifier}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "build:ts si build:rust ruleaza in paralel tocmai fiindca tsc nu citeste native/index.d.ts, generat de napi; " +
      `un import static il face o cursa pe un fisier scris in acelasi timp: ${offenders.join(", ")}`
  );
});

test("build si check lanseaza cele doua build-uri prin run-parallel", () => {
  const scripts = readPackageScripts();
  for (const name of ["build", "check"]) {
    assert.match(
      scripts[name],
      /run-parallel\.ts build:(ts build:rust|rust build:ts)/,
      `${name} a revenit la build-uri secventiale; masurat, serial 4,7 s vs paralel 2,5 s`
    );
  }
});

test("run-parallel iese cu cod diferit de zero cand un script esueaza", () => {
  const result = spawnSync(process.execPath, ["scripts/run-parallel.ts", "script-care-nu-exista-xyz"], {
    cwd: srcRoot,
    encoding: "utf8"
  });
  assert.notEqual(
    result.status,
    0,
    "un orchestrator de build care inghite esecurile e mai rau decat unul lent: ar raporta verde peste o compilare picata"
  );
  assert.match(result.stderr + result.stdout, /script-care-nu-exista-xyz/);
});

test("run-parallel fara argumente esueaza in loc sa raporteze succes gol", () => {
  const result = spawnSync(process.execPath, ["scripts/run-parallel.ts"], { cwd: srcRoot, encoding: "utf8" });
  assert.equal(result.status, 1);
});
