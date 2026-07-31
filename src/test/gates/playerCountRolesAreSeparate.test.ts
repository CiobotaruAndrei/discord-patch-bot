import test from "node:test";
import assert from "node:assert/strict";

import { loadModule, functionNames, importedModules, membersOf } from "./sourceStructureQueries.js";

const collector = loadModule("features", "player-count", "playerCountSnapshotService.ts");
const notifier = loadModule("features", "player-count", "playerCountNotifier.ts");
const queries = loadModule("features", "player-count", "playerCountQueryService.ts");
const repository = loadModule("features", "player-count", "playerCountWatchRepository.ts");

test("fiecare rol player-count are modulul lui", () => {
  assert.ok(functionNames(notifier).includes("createPlayerCountNotifier"), "notificatorul e o fabrica proprie");
  assert.ok(functionNames(queries).includes("createPlayerCountQueryService"), "interogarile sunt o fabrica proprie");
  assert.ok(functionNames(repository).includes("createPlayerCountWatchRepository"), "starea de urmarire are repository propriu");
  assert.ok(
    functionNames(collector).includes("createPlayerCountSnapshotService"),
    "colectorul ramane fabrica principala, dar doar cu colectarea si detectia schimbarii"
  );
});

test("colectorul nu mai construieste mesaje Discord si nu mai citeste istoricul direct", () => {
  const own = functionNames(collector);
  for (const moved of ["notifyPlayerCountChanges", "notifyMilestone", "readPlayerCountSnapshots", "readPlayerCountHistory", "readPlayerCountRecords"]) {
    assert.ok(
      !own.includes(moved),
      `${moved} a fost mutat in modulul lui; daca reapare aici, cele patru roluri se lipesc la loc intr-un singur fisier`
    );
  }
  assert.ok(
    importedModules(collector).some(module => module.endsWith("playerCountNotifier.js")),
    "colectorul cere notificatorul, nu il reimplementeaza"
  );
  assert.ok(
    importedModules(collector).some(module => module.endsWith("playerCountQueryService.js")),
    "colectorul cere serviciul de interogare"
  );
});

test("detectia schimbarii trece prin repository, nu prin scrieri directe pe guild", () => {
  assert.ok(
    importedModules(collector).some(module => module.endsWith("playerCountWatchRepository.js")),
    "detectia foloseste repository-ul cu index unic (guildId, gameKey)"
  );
  assert.ok(
    membersOf(repository, "PlayerCountWatchRecord").length > 0,
    "inregistrarea de urmarire are o forma declarata, nu un obiect liber"
  );
});
