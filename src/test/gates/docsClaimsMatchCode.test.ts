import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import path from "node:path";

import { loadModule, stringLiteralsIn, comparisonUpperBounds } from "./sourceStructureQueries.js";

const repoRoot = path.resolve(process.cwd(), "..");
const CONTEXT_DOC = path.join(repoRoot, "docs", "architecture", "CONTEXT_REPO_CLEAN.md");
const ESM_DOC = path.join(repoRoot, "docs", "architecture", "ESM_MIGRATION_PLAN.md");
const SCALING_DOC = path.join(repoRoot, "docs", "architecture", "scaling-readiness.md");

const LEGACY_LOADER = "create" + "Require";

function readDoc(file: string): string {
  return fs.readFileSync(file, "utf8");
}

function declaredNumberAfter(text: string, marker: string): number | null {
  const at = text.indexOf(marker);
  if (at < 0) return null;
  const match = /(\d+)/.exec(text.slice(at, at + 200));
  return match ? Number(match[1]) : null;
}

test("lista de gate-uri migrate din documentatie e aceeasi cu cea din cod", () => {
  const meta = loadModule("test", "gates", "structuralGatesUseAst.test.ts");
  const declared = stringLiteralsIn(meta, "MIGRATED_GATES");
  assert.ok(declared.length > 0, "gate-ul isi declara lista de fisiere migrate");

  const doc = readDoc(CONTEXT_DOC);
  const missing = declared.filter(gate => !doc.includes(gate));
  assert.deepEqual(
    missing,
    [],
    "documentatia enumera gate-urile migrate; un gate migrat dar nementionat inseamna ca textul a ramas in urma de cod " +
      `(lipsesc: ${missing.join(", ")})`
  );
});

test("plafonul de gate-uri ramase pe text din documentatie e cel din cod", () => {
  const meta = loadModule("test", "gates", "structuralGatesUseAst.test.ts");
  const codeCap = comparisonUpperBounds(meta, "remaining.length")[0] ?? null;
  assert.ok(codeCap !== null, "gate-ul declara un plafon numeric");
  const docCap = declaredNumberAfter(readDoc(CONTEXT_DOC), "un plafon care poate doar sa scada (");
  assert.equal(docCap, codeCap, "cifra din documentatie trebuie sa fie exact plafonul din gate");
});

test("numarul de fisiere de test cu incarcare legacy de module din documentatie e cel real", () => {
  const testRoot = path.join(process.cwd(), "test");
  const stack = [testRoot];
  let withRequire = 0;
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.name.endsWith(".ts")) continue;
      if (entry.name === "testModuleLoading.test.ts") continue;
      if (fs.readFileSync(full, "utf8").includes(LEGACY_LOADER)) withRequire += 1;
    }
  }

  const esmDeclared = declaredNumberAfter(readDoc(ESM_DOC), "Au ramas ");
  assert.equal(esmDeclared, withRequire, `planul ESM declara cate fisiere de test mai folosesc ${LEGACY_LOADER}`);

  const contextDeclared = declaredNumberAfter(readDoc(CONTEXT_DOC), "de fisiere din `src/test` folosesc `" + LEGACY_LOADER + "`");
  if (contextDeclared !== null) {
    assert.equal(contextDeclared, withRequire, "si zonele ramase de curatat citeaza acelasi numar");
  }
});

test("documentatia nu mai neaga un rol care exista in cod", () => {
  const scaling = readDoc(SCALING_DOC);
  assert.ok(
    !scaling.includes("Nu pornim un proces worker separat"),
    "rolul worker exista (BOT_ROLE=worker, npm run start:worker); un document care il neaga contrazice README-ul"
  );
  const roles = loadModule("shared", "botRole.ts");
  const declaredRoles = stringLiteralsIn(roles, "BOT_ROLES");
  for (const role of declaredRoles) {
    assert.ok(scaling.includes(role) || role === "all", `rolul ${role} e mentionat acolo unde se discuta scalarea`);
  }
});

test("planul ESM nu mai declara migrarea incheiata fara sa spuna ce a ramas", () => {
  const esm = readDoc(ESM_DOC);
  const at = esm.indexOf("Codul de productie este integral ESM");
  assert.ok(at >= 0, "documentul spune explicit ce e terminat: codul de productie");
  const paragraph = esm.slice(at, at + 900);
  assert.ok(paragraph.includes(LEGACY_LOADER), "si spune, in acelasi loc, ce nu e terminat: incarcarea in teste");
  assert.ok(
    !/^Migrarea este completa;/m.test(esm),
    "afirmatia neconditionata a fost inlocuita cu una care distinge productia de teste"
  );
});
