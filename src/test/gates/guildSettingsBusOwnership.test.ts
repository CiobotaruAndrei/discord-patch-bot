import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import path from "node:path";

import { createGuildSettingsEventBus } from "../../infra/mongo/guildSettingsEventBus.js";
import { guildChangePublisher } from "../../infra/mongo/models.js";

const srcRoot = process.cwd();

function read(relative: string): string {
  return fs.readFileSync(path.join(srcRoot, relative), "utf8");
}

test("contextul Mongo isi creeaza propria magistrala si o expune, nu se bazeaza pe una de modul", () => {
  const context = read("infra/mongo/mongoContext.ts");
  assert.match(context, /const guildSettingsBus = createGuildSettingsEventBus\(\);/);
  assert.match(context, /guildSettingsBus: context\.guildSettingsBus,/, "magistrala e exportata pe context, ca sa poata fi injectata mai departe");
  assert.match(context, /guildSettingsBus\.setErrorReporter\(/, "reporterul de erori se leaga de instanta detinuta, nu global");
  assert.ok(
    !/setGuildSettingsEventErrorReporter/.test(context),
    "contextul nu mai trece prin functia globala de configurare"
  );
});

test("consumatorii primesc magistrala prin injectie, cu instanta implicita doar ca punte", () => {
  for (const [file, hook] of [
    ["infra/mongo/models.ts", "context.guildSettingsBus"],
    ["infra/mongo/guildSettings.ts", "context.guildSettingsBus"],
    ["infra/redis/guildSettingsInvalidationChannel.ts", "deps.bus"]
  ] as const) {
    const source = read(file);
    assert.ok(source.includes(hook), `${file} citeste magistrala injectata (${hook})`);
  }
});

test("compunerea aplicatiei trece magistrala detinuta de context catre canalul Redis si catre metrici", () => {
  const runtime = read("app/appRuntime.ts");
  assert.match(runtime, /bus: mongo\.guildSettingsBus/, "canalul Redis primeste magistrala contextului");
  const services = read("app/runtime/runtimeServices.ts");
  assert.match(services, /mongo\.guildSettingsBus\.attachMetrics\(metrics\)/, "metricile se leaga de aceeasi instanta");
});

test("doua magistrale nu isi vad abonatii, iar publicarea prin hook-ul de schema ajunge doar la a ei", () => {
  const primaraEvenimente: string[] = [];
  const secundaraEvenimente: string[] = [];
  const primara = createGuildSettingsEventBus();
  const secundara = createGuildSettingsEventBus();
  primara.subscribe(guildId => primaraEvenimente.push(guildId));
  secundara.subscribe(guildId => secundaraEvenimente.push(guildId));

  const publish = guildChangePublisher(primara);
  publish.call({ getFilter: () => ({ _id: "g1" }) });

  assert.deepEqual(primaraEvenimente, ["g1"]);
  assert.deepEqual(secundaraEvenimente, [], "un test care lasa un abonat in urma nu mai polueaza alta magistrala");

  primara.dispose();
  publish.call({ getFilter: () => ({ _id: "g2" }) });
  assert.deepEqual(primaraEvenimente, ["g1"], "dupa dispose, magistrala nu mai livreaza");
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
