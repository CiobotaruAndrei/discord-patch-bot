import test from "node:test";
import assert from "node:assert/strict";

import { loadModule, functionNames, importedModules, lineCount, returnedObjectProperties } from "./sourceStructureQueries.js";

const engine = loadModule("shared", "operationJournalEngine.ts");
const store = loadModule("shared", "operationJournalStore.ts");
const execution = loadModule("shared", "operationJournalExecution.ts");
const recovery = loadModule("shared", "operationJournalRecovery.ts");
const contracts = loadModule("shared", "operationJournalContracts.ts");

test("fiecare rol al jurnalului are modulul lui", () => {
  assert.ok(functionNames(store).includes("createOperationJournalStore"), "scrierile cu lease traiesc in store");
  assert.ok(functionNames(execution).includes("createOperationExecution"), "executia sub lease traieste separat");
  assert.ok(functionNames(recovery).includes("createOperationRecovery"), "recovery-ul traieste separat");
  assert.ok(functionNames(engine).includes("createOperationJournal"), "motorul ramane fabrica publica");
});

test("motorul compune, nu mai scrie el in Mongo", () => {
  const own = functionNames(engine);
  for (const moved of ["ensurePending", "claim", "markTerminal", "releaseAfterFailure", "supersededByNewerOperation", "executeClaimed", "failUnclaimed", "recoverPending"]) {
    assert.ok(
      !own.includes(moved),
      `${moved} a fost mutat in modulul lui; daca reapare in motor, cele trei roluri se lipesc la loc intr-un singur fisier`
    );
  }
  for (const module of ["operationJournalStore.js", "operationJournalExecution.js", "operationJournalRecovery.js"]) {
    assert.ok(
      importedModules(engine).some(imported => imported.endsWith(module)),
      `motorul cere ${module} in loc sa reimplementeze rolul`
    );
  }
});

test("garda de lease ramane un singur loc, in store", () => {
  assert.ok(functionNames(store).includes("leaseGuard"), "filtrul care leaga o scriere de lease-ul detinut e definit o data");
  for (const query of [engine, execution, recovery]) {
    assert.ok(
      !functionNames(query).includes("leaseGuard"),
      `${query.relativePath} nu isi construieste propriul filtru de lease; doua garzi paralele pot devia si o scriere ar trece fara lease`
    );
  }
});

test("executia nu atinge modelul Mongo direct, ci trece prin store", () => {
  assert.ok(
    !importedModules(execution).some(module => module.includes("mongo")),
    "executia ramane testabila fara Mongo"
  );
  const renewsThroughStore = returnedObjectProperties(store, "createOperationJournalStore").includes("renewLease");
  assert.ok(renewsThroughStore, "heartbeat-ul de lease trece prin store (`renewLease`), nu prin `updateOne` scris in executie");
});

test("niciun modul de jurnal nu creste inapoi cat fisierul din care a fost taiat", () => {
  const oversized = [engine, store, execution, recovery, contracts]
    .map(query => [query.relativePath, lineCount(query)] as const)
    .filter(([, lines]) => lines > 200)
    .map(([file, lines]) => `${file}: ${lines}`);
  assert.deepEqual(
    oversized,
    [],
    "fisierul de dinainte avea 336 de linii cu toate rolurile; un modul care trece de 200 inseamna ca a inceput sa adune iar mai multe: " +
      oversized.join(", ")
  );
});
