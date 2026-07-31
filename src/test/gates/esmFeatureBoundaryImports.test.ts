import test from "node:test";
import assert from "node:assert/strict";

import { loadModule, loadModulesIn, calls, importedModules, requireSpecifiers } from "./sourceStructureQueries.js";
import type { ModuleQuery } from "./sourceStructureQueries.js";

const FEATURE_DIRS: ReadonlyArray<readonly string[]> = [
  ["features"],
  ["features", "notifications"],
  ["features", "command-handlers"],
  ["features", "command-security"],
  ["features", "command-registry"],
  ["features", "command-runtime"],
  ["features", "command-presentation"],
  ["features", "command-cache"],
  ["features", "command-catalog"],
  ["features", "command-definitions"],
  ["features", "command-help"],
  ["features", "guild-config"],
  ["features", "admin-records"],
  ["features", "moderation"],
  ["features", "youtube"],
  ["features", "game-info"],
  ["features", "player-count"]
];

function featureModules(): ModuleQuery[] {
  return FEATURE_DIRS.flatMap(directory => loadModulesIn(directory, name => name.endsWith(".ts")));
}

function buildsRequire(query: ModuleQuery): boolean {
  const loadsModuleBuiltin = importedModules(query).some(module => module === "node:module" || module === "module");
  return loadsModuleBuiltin && calls(query).some(call => call.callee.includes("createRequire"));
}

test("granita ESM: niciun modul din src/features nu mai foloseste require sau createRequire (review 16-iteme #14)", () => {
  const offenders: string[] = [];
  for (const query of featureModules()) {
    if (requireSpecifiers(query).length > 0) offenders.push(`${query.relativePath}: require(...)`);
    if (buildsRequire(query)) offenders.push(`${query.relativePath}: createRequire`);
  }
  assert.deepEqual(
    offenders,
    [],
    "modulele de feature folosesc doar import ESM static: un `require` intr-un modul ESM il scoate din graful pe care " +
      `compilatorul il poate verifica, si aduce inapoi rezolvarea implicita de director pe care ESM nu o are (${offenders.join(", ")})`
  );
});

test("granita ESM: modulele de feature convertite nu mai poarta shim-ul createRequire in capul fisierului", () => {
  const converted: ReadonlyArray<readonly string[]> = [
    ["features", "notifications", "index.ts"],
    ["features", "notifications", "outboxRuntimeFactory.ts"],
    ["features", "command-handlers", "snoozeInteractionHandler.ts"],
    ["features", "command-security", "commandSnoozeGuard.ts"],
    ["features", "command-handlers", "helpInteractionHandler.ts"],
    ["features", "command-handlers", "reportViews.ts"],
    ["features", "command-handlers", "reportInteractionHandler.ts"],
    ["features", "command-security", "globalAccessCodeModal.ts"],
    ["features", "command-security", "adminScopeIds.ts"],
    ["features", "command-handlers", "adminCommandAccessHandler.ts"]
  ];
  for (const segments of converted) {
    const query = loadModule(...segments);
    assert.deepEqual(requireSpecifiers(query), [], `${query.relativePath} inca incarca module prin require`);
    assert.ok(!buildsRequire(query), `${query.relativePath} inca construieste un require`);
  }
});
