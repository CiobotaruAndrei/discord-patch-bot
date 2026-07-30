import test from "node:test";
import assert from "node:assert/strict";

import {
  loadModule,
  calls,
  defaultExportName,
  functions,
  functionNames,
  namedObjectProperties,
  typeAliasTarget,
  typeReferenceTexts
} from "./sourceStructureQueries.js";
import type { ModuleQuery } from "./sourceStructureQueries.js";

const FACTORY_ONLY: ReadonlyArray<readonly [readonly string[], string]> = [
  [["features", "notifications", "index.ts"], "createNotificationRuntime"],
  [["features", "command-cache", "commandCache.ts"], "createCommandCache"],
  [["infra", "mongo", "models.ts"], "buildFrom"]
];

const commandCache = loadModule("features", "command-cache", "commandCache.ts");
const commandPresentation = loadModule("features", "command-presentation", "commandPresentation.ts");

function mutatesTarget(query: ModuleQuery): boolean {
  return calls(query).some(call => call.callee === "Object.assign" && call.args[0] === "target");
}

function functionsTakingTarget(query: ModuleQuery): string[] {
  return functions(query)
    .filter(signature => signature.params.some(parameter => parameter.name === "target"))
    .map(signature => signature.name);
}

test("command cache e factory-only: exportul e un obiect plat de fabrici, fara callable de atasare", () => {
  assert.ok(
    !typeReferenceTexts(commandCache).includes("CommandCacheDeps & Record<string, unknown>"),
    "contextul nu se mai lateste cu Record<string, unknown>"
  );
  assert.ok(!mutatesTarget(commandCache), "commandCache nu mai are installer care muta target-ul (factory-only)");
  assert.equal(defaultExportName(commandCache), "commandCacheModule", "exportul default e obiectul de fabrici, nu o functie de atasare");
  assert.deepEqual(
    namedObjectProperties(commandCache, "commandCacheModule").sort(),
    ["computeMissingChannelPerms", "createCommandCache", "formatMissingChannelPerms"],
    "exportul enumera exact fabricile modulului"
  );
});

test("presentation isi deriveaza target-ul installer-ului din runtime-ul fabricii, nu din Record", () => {
  assert.ok(
    !typeReferenceTexts(commandPresentation).includes("CommandUiDeps & Record<string, unknown>"),
    "contextul de presentation nu se mai lateste cu Record<string, unknown>"
  );
  assert.equal(
    typeAliasTarget(commandPresentation, "CommandUiRuntime"),
    "ReturnType<typeof createCommandPresentation>",
    "runtime-ul e derivat din fabrica, deci nu poate devia de ea"
  );
  assert.equal(
    typeAliasTarget(commandPresentation, "CommandUiContext"),
    "CommandUiDeps & Partial<CommandUiRuntime>",
    "contextul e dependentele plus partea deja construita din runtime, nimic mai larg"
  );
});

test("modulele numite de review sunt factory-only: fara mutare pe target si cu fabrica expusa", () => {
  for (const [segments, factoryKey] of FACTORY_ONLY) {
    const query = loadModule(...segments);
    assert.ok(!mutatesTarget(query), `${query.relativePath}: fara Object.assign(target, ...) (factory-only)`);
    assert.deepEqual(
      functionsTakingTarget(query),
      [],
      `${query.relativePath}: nicio fabrica nu primeste un target de mutat`
    );
    const exportName = defaultExportName(query);
    const exposesFactory =
      functionNames(query).includes(factoryKey) ||
      (exportName !== null && namedObjectProperties(query, exportName).includes(factoryKey));
    assert.ok(exposesFactory, `${query.relativePath}: expune fabrica ${factoryKey}`);
  }
});

test("nici modulele de prezentare si cache nu primesc un target de mutat", () => {
  for (const query of [commandCache, commandPresentation]) {
    assert.deepEqual(functionsTakingTarget(query), [], `${query.relativePath}: semnaturile nu cer un target`);
  }
});
