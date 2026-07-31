import test from "node:test";
import assert from "node:assert/strict";

import { loadModule, declaresType, reExports, imports } from "./sourceStructureQueries.js";

const CONTRACTE = [
  "AppRuntimeDeps", "RuntimeServices", "Schedulers", "DiscordClientLike",
  "HttpServerLike", "AppRuntime", "CommandRuntime", "ScraperRuntime", "MongoContextLike"
];

const contracts = loadModule("app", "appRuntimeContracts.ts");
const runtime = loadModule("app", "appRuntime.ts");

test("contractele AppRuntime traiesc in appRuntimeContracts.ts, nu in composition root (review 22 #10)", () => {
  for (const name of CONTRACTE) {
    assert.ok(declaresType(contracts, name), `${name} e definit in appRuntimeContracts.ts`);
  }
  assert.ok(
    !declaresType(runtime, "AppRuntimeDeps"),
    "AppRuntimeDeps definit si in composition root ar insemna doua forme care pot devia tacut una de alta"
  );
  assert.ok(
    reExports(runtime).some(entry => entry.name === "AppRuntimeDeps" && entry.module.endsWith("appRuntimeContracts.js")),
    "appRuntime.ts re-exporta contractele din appRuntimeContracts pentru compatibilitate, fara sa le redefineasca"
  );
});

test("modulele runtime importa contractele direct, nu prin composition root (fara ciclu de tipuri)", () => {
  for (const file of ["bootSequence.ts", "runtimeSchedulers.ts", "runtimeServices.ts"]) {
    const query = loadModule("app", "runtime", file);
    const modules = imports(query).map(entry => entry.module);
    assert.ok(
      modules.some(module => module.endsWith("appRuntimeContracts.js")),
      `${file} importa din appRuntimeContracts`
    );
    assert.ok(
      !modules.some(module => module.endsWith("/appRuntime.js")),
      `${file} nu mai importa din appRuntime: un modul pe care composition root-ul il compune, dar care importa inapoi ` +
        "din el, inchide un ciclu; ciclul se vede intai la tipuri si abia apoi la runtime"
    );
  }
});
