import test from "node:test";
import assert from "node:assert/strict";

import { loadModule, calls, callsWithin, importedModules, membersOf, allMembers } from "./sourceStructureQueries.js";

const composition = loadModule("app", "runtimeComposition.ts");
const bootstrap = loadModule("app", "bootstrap.ts");
const schedulers = loadModule("app", "runtime", "runtimeSchedulers.ts");
const contracts = loadModule("app", "appRuntimeContracts.ts");

test("composition root-ul construieste porturile, nu doar contextele brute", () => {
  const built = calls(composition).map(call => call.callee);
  assert.ok(built.includes("createMongoPorts"), "porturile Mongo se creeaza in radacina de compunere");
  assert.ok(built.includes("createSourcePorts"), "porturile de surse se creeaza in radacina de compunere");
  assert.ok(
    importedModules(composition).some(module => module.includes("mongoPortAdapters")),
    "radacina foloseste adaptorul concret, nu isi scrie propriul obiect"
  );
  assert.ok(
    importedModules(composition).some(module => module.includes("sourcePortAdapters")),
    "acelasi lucru pentru surse"
  );
});

test("porturile ajung in contractul de runtime, deci pot fi propagate", () => {
  const ports = membersOf(contracts, "RuntimePorts").map(member => member.name);
  assert.deepEqual(ports.sort(), ["mongo", "sources"], "contractul de porturi are exact cele doua familii");
  const runtimeDeps = membersOf(contracts, "AppRuntimeDeps").filter(member => member.name === "ports");
  assert.equal(runtimeDeps.length, 1, "AppRuntimeDeps cere porturile; un runtime nu mai poate fi compus fara ele");
  assert.equal(runtimeDeps[0]?.optional, false, "porturile nu sunt optionale: altfel wiring-ul poate sa le omita tacut");
});

test("boot-ul injecteaza exact porturile din composition root", () => {
  const injected = importedModules(bootstrap).some(module => module.includes("runtimeComposition"));
  assert.ok(injected, "boot-ul ia instantele din radacina de compunere");
  const compositionImport = loadModule("app", "bootstrap.ts");
  const names = calls(compositionImport).map(call => call.callee);
  assert.ok(!names.includes("createMongoPorts"), "boot-ul nu isi construieste propriile porturi; le primeste");
  assert.ok(!names.includes("createSourcePorts"), "acelasi lucru pentru surse");
});

test("consumatorii cer portul, nu isi fabrica un obiect cu forma lui", () => {
  const housekeepingCall = callsWithin(schedulers, "createSchedulers").find(call => call.callee === "createHousekeeping");
  assert.ok(housekeepingCall, "schedulerele construiesc housekeeping");
  const argument = housekeepingCall?.args[0] ?? "";
  assert.ok(
    argument.includes("deps.ports.mongo.guildConfig"),
    "curatarea periodica primeste portul de configurare din radacina, nu o functie libera impachetata pe loc"
  );
  assert.ok(
    argument.includes("deps.ports.sources.deals"),
    "si portul de surse; un obiect literal cu aceeasi forma ar trece de tipuri fara sa foloseasca adaptorul"
  );
  assert.ok(
    !/sweepExpired:\s*cleanGuildCache/.test(argument),
    "vechea forma — un literal care imita portul — nu se mai foloseste"
  );
});

test("housekeeping declara portul, nu functii libere", () => {
  const housekeeping = loadModule("app", "scheduler", "housekeeping.ts");
  const members = allMembers(housekeeping);
  const guildConfig = members.find(member => member.name === "guildConfig");
  assert.ok(guildConfig?.type.includes("GuildConfigStore"), "dependinta e exprimata prin portul de configurare");
  const deals = members.find(member => member.name === "deals");
  assert.ok(deals?.type.includes("DealsSourcePort"), "dependinta de surse e exprimata prin portul de deals");
});
