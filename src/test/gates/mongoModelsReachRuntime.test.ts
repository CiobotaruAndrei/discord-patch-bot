import test from "node:test";
import assert from "node:assert/strict";

import { callBoundLocals, identifierNames, loadModule, topLevelMembersOf } from "./sourceStructureQueries.js";

const models = loadModule("infra", "mongo", "models.ts");
const context = loadModule("infra", "mongo", "mongoContext.ts");
const bundles = loadModule("infra", "mongo", "mongoContextBundles.ts");
const commandDeps = loadModule("features", "command-runtime", "commandRuntimeDependencies.ts");

function modelsCreatedInModelsModule(): string[] {
  return callBoundLocals(models, "buildMongoModelsFrom")
    .filter(local => local.callee === "mongoose.model")
    .map(local => local.name);
}

function contextMembers(): Set<string> {
  return new Set(topLevelMembersOf(context, "MongoRuntimeContext").map(member => member.name));
}

test("fiecare model creat in models.ts este expus pe contextul Mongo", () => {
  const exposed = contextMembers();
  const created = modelsCreatedInModelsModule();
  assert.ok(created.length >= 20, `nu am gasit modelele in models.ts (${created.length})`);

  const missing = created.filter(name => !exposed.has(name));

  assert.deepEqual(
    missing,
    [],
    "un model creat dar neexpus pe MongoRuntimeContext nu ajunge niciodata la runtime-uri: "
      + "colectia exista, indecsii se construiesc, si protectia care depinde de el nu ruleaza"
  );
});

test("fiecare model ajunge intr-un compunator care il trimite mai departe la runtime", () => {
  const declared = new Set([...identifierNames(bundles), ...identifierNames(commandDeps)]);
  const missing = modelsCreatedInModelsModule().filter(name => !declared.has(name));

  assert.deepEqual(
    missing,
    [],
    "un model expus pe context dar neselectat de niciun compunator (mongoContextBundles sau commandRuntimeDependencies) "
      + "nu ajunge in obiectul primit de runtime: colectia exista, indecsii se construiesc, si protectia care depinde de el nu ruleaza niciodata"
  );
});
