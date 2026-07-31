import test from "node:test";
import assert from "node:assert/strict";

import ________shared_utilities from "../../shared/utilities.js";
import { loadModulesIn, declaresType, membersOf, assertions, calls } from "./sourceStructureQueries.js";
import type { ModuleQuery } from "./sourceStructureQueries.js";

const { runConcurrent } = ________shared_utilities;

const SCANNED: ReadonlyArray<readonly string[]> = [
  ["sources"], ["sources", "updates"], ["sources", "deals"],
  ["features", "notifications"], ["features", "command-handlers"],
  ["app"], ["app", "runtime"], ["app", "scheduler"],
  ["infra", "mongo"]
];

function modules(): ModuleQuery[] {
  return SCANNED.flatMap(directory => loadModulesIn(directory, name => name.endsWith(".ts")));
}

test("un singur modul declara contractul de rulare concurenta", () => {
  const declaring = modules()
    .filter(query => declaresType(query, "RunConcurrent") || declaresType(query, "RunConcurrentResult") || declaresType(query, "ConcurrentRunResult"))
    .map(query => query.relativePath);
  assert.deepEqual(
    declaring,
    [],
    "contractul traieste in `types.ts`; o redeclarare locala e mereu o copie mai slaba - asa au aparut patru variante care " +
      `pierdeau \`index\` si \`item\` din erori, iar apelantul ajungea sa verifice la runtime ce ii promitea deja tipul (${declaring.join(", ")})`
  );
});

test("contractul comun pastreaza indexul si elementul in fiecare eroare", () => {
  const [port] = loadModulesIn(["shared"], name => name === "concurrencyPort.ts");
  assert.ok(port, "contractul sta langa implementare, in shared, nu in barrel-ul de tipuri importat de tot repo-ul");
  const errorShape = membersOf(port, "ConcurrentRunResult").find(member => member.name === "errors");
  assert.ok(errorShape, "rezultatul declara erorile");
  for (const field of ["index", "item", "error"]) {
    assert.ok(
      errorShape.type.includes(field),
      `eroarea pastreaza ${field}: fara el, apelantul nu poate lega esecul de elementul care l-a produs`
    );
  }
});

test("orchestratorul de fetch nu mai afirma prin cast ca tabloul e complet", () => {
  const [orchestrator] = loadModulesIn(["sources", "updates"], name => name === "updatesFetchOrchestrator.ts");
  assert.ok(orchestrator, "orchestratorul exista");
  const casts = assertions(orchestrator).filter(entry => entry.type.includes("FetchResult"));
  assert.deepEqual(
    casts.map(entry => entry.expression),
    [],
    "tabloul de rezultate se completeaza element cu element, deci compilatorul verifica singur ca e plin; " +
      "un cast la final doar AFIRMA asta, si ramane o afirmatie falsa daca cineva schimba bucla de completare"
  );
  assert.ok(
    !calls(orchestrator).some(call => call.callee === "Array.isArray"),
    "rezultatul lui runConcurrent nu se mai reverifica la runtime: tipul il promitea deja"
  );
});

test("erorile poarta indexul si elementul care le-a produs", async () => {
  const items = ["a", "b", "c"];
  const result = await runConcurrent(items, 2, async item => {
    if (item === "b") throw new Error("b a picat");
  });
  assert.equal(result.processed, 2);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].index, 1);
  assert.equal(result.errors[0].item, "b", "apelantul poate lega esecul de elementul lui fara sa numere singur");
});

test("un errorLogger care arunca nu opreste restul rularii", async () => {
  const result = await runConcurrent([1, 2, 3], 1, async value => {
    if (value !== 2) throw new Error("esec");
  }, {
    errorLogger: () => { throw new Error("si logger-ul a picat"); }
  });
  assert.equal(result.processed, 1, "elementul valid trece chiar daca logarea celorlalte esueaza");
  assert.equal(result.errors.length, 2);
});

test("shouldAbort opreste consumul, iar elementele neatinse nu apar nici ca procesate, nici ca erori", async () => {
  const seen: number[] = [];
  let stop = false;
  const result = await runConcurrent([1, 2, 3, 4, 5], 1, async value => {
    seen.push(value);
    if (value === 2) stop = true;
  }, { shouldAbort: () => stop });

  assert.deepEqual(seen, [1, 2]);
  assert.equal(result.processed, 2);
  assert.deepEqual(result.errors, [], "abortul nu e un esec: elementele neconsumate raman pur si simplu neconsumate");
});

test("o lista goala nu porneste niciun worker", async () => {
  let calls = 0;
  const result = await runConcurrent([], 4, async () => { calls++; });
  assert.equal(calls, 0);
  assert.deepEqual(result, { processed: 0, errors: [] });
});

test("concurenta e plafonata de numarul de elemente si de minim unu", async () => {
  let active = 0;
  let peak = 0;
  await runConcurrent([1, 2, 3], 10, async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
  });
  assert.equal(peak, 3, "nu se pornesc mai multi workeri decat elemente");

  let sequentialPeak = 0;
  let running = 0;
  await runConcurrent([1, 2, 3], 0, async () => {
    running++;
    sequentialPeak = Math.max(sequentialPeak, running);
    await new Promise(resolve => setTimeout(resolve, 1));
    running--;
  });
  assert.equal(sequentialPeak, 1, "o concurenta invalida devine unu, nu zero workeri");
});
