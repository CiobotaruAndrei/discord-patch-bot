import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import path from "node:path";

const srcRoot = process.cwd();
const gatesDir = path.join(srcRoot, "test", "gates");
const TOOLKIT = "sourceStructureQueries.ts";

const MIGRATED_GATES: readonly string[] = [
  "registryClosedContracts.test.ts",
  "metricRecorderBoundaries.test.ts",
  "commandInstallerTargetContracts.test.ts",
  "mongoPorts.test.ts",
  "roleCompositionRoots.test.ts"
];

function read(file: string): string {
  return fs.readFileSync(path.join(gatesDir, file), "utf8");
}

function gateFiles(): string[] {
  return fs
    .readdirSync(gatesDir)
    .filter(name => name.endsWith(".test.ts"))
    .sort();
}

test("unealta de interogare structurala e singurul loc care citeste sursa ca text", () => {
  const toolkit = read(TOOLKIT);
  assert.match(toolkit, /import ts from "typescript"/, "unealta parseaza cu compilatorul TypeScript, nu cu regexuri");
  assert.ok(!toolkit.includes("node:assert"), "unealta e o biblioteca de interogari, nu un gate: nu contine asertari");
  assert.equal(
    (toolkit.match(/readFileSync/g) ?? []).length,
    1,
    "un singur punct de citire a fisierului, chiar inainte de createSourceFile"
  );
});

test("gate-urile migrate nu mai citesc sursa TypeScript ca text", () => {
  for (const gate of MIGRATED_GATES) {
    const source = read(gate);
    assert.ok(
      source.includes('from "./sourceStructureQueries.js"'),
      `${gate}: interogheaza AST-ul prin unealta comuna`
    );
    assert.ok(
      !source.includes("readFileSync"),
      `${gate}: o regula structurala nu are motiv sa vada textul brut al unui modul; ` +
        "textul se schimba la reformatare, la mutarea unei linii sau la redenumirea unei variabile locale, " +
        "iar proprietatea verificata nu"
    );
    assert.ok(
      !source.includes("assert.match"),
      `${gate}: assert.match peste sursa e exact forma fragila eliminata; asertarea se face pe noduri`
    );
    assert.ok(!source.includes("new RegExp"), `${gate}: fara regexuri construite dinamic peste sursa`);
  }
});

test("proprietatea verificata supravietuieste reformatarii, nu doar formei actuale a codului", async () => {
  const { loadModule, functionNames, findFunction, compositionLayers } = await import("./sourceStructureQueries.js");
  const scratch = path.join(gatesDir, "sourceStructureReformatFixture.ts");
  const dense = "export function compune(){const base={...intrare};const strat={...base,...modul.buildFrom(base)};return strat;}\n";
  const spaced =
    "export function compune()\n{\n  const base = {\n    ...intrare\n  };\n\n  const strat = {\n    ...base,\n" +
    "    ...modul.buildFrom(base)\n  };\n\n  return strat;\n}\n";
  const shapes: string[] = [];
  for (const variant of [dense, spaced]) {
    fs.writeFileSync(scratch, variant, "utf8");
    try {
      const query = loadModule("test", "gates", "sourceStructureReformatFixture.ts");
      assert.deepEqual(functionNames(query), ["compune"], "aceeasi functie e gasita in ambele formatari");
      assert.equal(findFunction(query, "compune")?.params.length, 0, "aceeasi semnatura in ambele formatari");
      shapes.push(JSON.stringify(compositionLayers(query, "compune")));
    } finally {
      fs.rmSync(scratch, { force: true });
    }
  }
  assert.equal(shapes[0], shapes[1], "straturile de compunere sunt identice indiferent de formatare");
});

test("migrarea de la text la AST poate doar sa avanseze", () => {
  const users = gateFiles().filter(gate => read(gate).includes('from "./sourceStructureQueries.js"'));
  assert.ok(
    users.length >= MIGRATED_GATES.length,
    `${users.length} gate-uri interogheaza AST-ul; lista declarata are ${MIGRATED_GATES.length}. ` +
      "Cand mai migrezi unul, adauga-l in MIGRATED_GATES ca sa nu poata regresa la text"
  );
  for (const gate of MIGRATED_GATES) {
    assert.ok(users.includes(gate), `${gate} e declarat ca migrat, deci trebuie sa foloseasca unealta`);
  }
});

test("gate-urile care inca citesc text sunt numarate, ca restul migrarii sa nu se piarda", () => {
  const remaining = gateFiles().filter(gate => {
    const source = read(gate);
    return source.includes("readFileSync") && /\.ts"|\.ts'|"\.ts|endsWith\("\.ts"\)/.test(source);
  });
  assert.ok(
    remaining.length <= 25,
    `${remaining.length} gate-uri citesc inca sursa TypeScript ca text; plafonul e 25 si poate doar sa scada: ` +
      remaining.join(", ")
  );
});
