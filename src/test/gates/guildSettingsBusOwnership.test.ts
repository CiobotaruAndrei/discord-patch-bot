import test from "node:test";
import assert from "node:assert/strict";

import { createGuildSettingsEventBus } from "../../infra/mongo/guildSettingsEventBus.js";
import { guildChangePublisher } from "../../infra/mongo/models.js";

import { loadModule, calls, allMembers, importedModules, functionNames } from "./sourceStructureQueries.js";
import type { ModuleQuery } from "./sourceStructureQueries.js";

const mongoContext = loadModule("infra", "mongo", "mongoContext.ts");
const models = loadModule("infra", "mongo", "models.ts");
const guildSettings = loadModule("infra", "mongo", "guildSettings.ts");
const invalidationChannel = loadModule("infra", "redis", "guildSettingsInvalidationChannel.ts");
const appRuntime = loadModule("app", "appRuntime.ts");
const runtimeServices = loadModule("app", "runtime", "runtimeServices.ts");

const CONSUMERS: ReadonlyArray<readonly [ModuleQuery, string]> = [
  [models, "guildSettingsBus"],
  [guildSettings, "guildSettingsBus"],
  [invalidationChannel, "bus"]
];

test("contextul Mongo isi creeaza propria magistrala si o expune", () => {
  const built = calls(mongoContext).map(call => call.callee);
  assert.ok(built.includes("createGuildSettingsEventBus"), "contextul isi creeaza instanta");
  assert.ok(
    built.includes("guildSettingsBus.setErrorReporter"),
    "reporterul de erori se leaga de instanta detinuta, nu global"
  );
});

test("niciun modul nu mai creeaza o magistrala la incarcare", () => {
  for (const query of [models, guildSettings, invalidationChannel]) {
    const created = calls(query).filter(call => call.callee === "createGuildSettingsEventBus");
    assert.deepEqual(
      created,
      [],
      `${query.relativePath}: o instanta creata la nivel de modul traieste cat procesul, se aboneaza singura ` +
        "la incarcare si nu poate fi inchisa; magistrala vine prin injectie"
    );
  }
});

test("modulul de singleton a disparut cu totul, nu doar consumatorii lui", () => {
  assert.throws(
    () => loadModule("infra", "mongo", "guildSettingsEvents.ts"),
    "guildSettingsEvents.ts expunea o instanta de modul plus opt functii care o configurau global; a fost sters, " +
      "nu doar ocolit — altfel ar fi ramas o cale prin care cineva reintroduce singletonul"
  );
});

test("magistrala e obligatorie in contractele consumatorilor, nu optionala", () => {
  for (const [query, field] of CONSUMERS) {
    const declared = allMembers(query).filter(member => member.name === field);
    assert.ok(declared.length > 0, `${query.relativePath}: contractul declara ${field}`);
    for (const member of declared) {
      assert.equal(
        member.optional,
        false,
        `${query.relativePath}: ${field} optional inseamna ca cineva poate omite magistrala si sa cada tacut pe alta`
      );
    }
  }
});

test("compunerea aplicatiei paseaza magistrala contextului mai departe", () => {
  const wired = calls(appRuntime).find(call => call.callee === "createGuildSettingsInvalidationChannel");
  assert.ok(wired?.args[0]?.includes("bus: mongo.guildSettingsBus"), "canalul Redis primeste magistrala contextului");
  assert.ok(
    calls(runtimeServices).some(call => call.callee === "mongo.guildSettingsBus.attachMetrics"),
    "metricile se leaga de aceeasi instanta"
  );
  for (const query of [appRuntime, runtimeServices, models, guildSettings, invalidationChannel]) {
    assert.ok(
      !importedModules(query).some(module => module.includes("guildSettingsEvents")),
      `${query.relativePath} nu mai atinge modulul de singleton`
    );
  }
});

test("publisher-ul de schimbari e o fabrica peste magistrala primita", () => {
  assert.ok(functionNames(models).includes("guildChangePublisher"), "publisher-ul e o fabrica, nu o valoare de modul");
  const primara = createGuildSettingsEventBus();
  const secundara = createGuildSettingsEventBus();
  const primareEvenimente: string[] = [];
  const secundareEvenimente: string[] = [];
  primara.subscribe(guildId => primareEvenimente.push(guildId));
  secundara.subscribe(guildId => secundareEvenimente.push(guildId));

  const publish = guildChangePublisher(primara);
  publish.call({ getFilter: () => ({ _id: "g1" }) });

  assert.deepEqual(primareEvenimente, ["g1"]);
  assert.deepEqual(secundareEvenimente, [], "un test care lasa un abonat in urma nu mai polueaza alta magistrala");

  primara.dispose();
  publish.call({ getFilter: () => ({ _id: "g2" }) });
  assert.deepEqual(primareEvenimente, ["g1"], "dupa dispose, magistrala nu mai livreaza");
  secundara.dispose();
});

test("hook-ul de schema ignora filtrele fara identificator de guild", () => {
  const evenimente: string[] = [];
  const bus = createGuildSettingsEventBus();
  bus.subscribe(guildId => evenimente.push(guildId));
  const publish = guildChangePublisher(bus);

  publish.call({ getFilter: () => ({}) });
  publish.call({ getFilter: () => ({ _id: 42 }) });
  assert.deepEqual(evenimente, [], "un `_id` care nu e string nu e un guild");

  publish.call({ getFilter: () => ({ _id: "g3" }) });
  assert.deepEqual(evenimente, ["g3"]);
  bus.dispose();
});
