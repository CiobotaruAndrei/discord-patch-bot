import test from "node:test";
import assert from "node:assert/strict";

import { loadModulesUnder, calls, importedModules, requireSpecifiers, assertions } from "./sourceStructureQueries.js";
import type { ModuleQuery } from "./sourceStructureQueries.js";

const SELF = "test/gates/testModuleLoading.test.ts";

const NODE_BUILTINS = new Set([
  "fs", "path", "os", "crypto", "url", "util", "zlib", "child_process", "events",
  "node:fs", "node:path", "node:os", "node:crypto", "node:url", "node:util", "node:zlib",
  "node:child_process", "node:events"
]);

const modules = loadModulesUnder(["test"], relativePath => relativePath !== SELF);

function buildsRequire(query: ModuleQuery): boolean {
  const loadsModuleBuiltin = importedModules(query).some(module => module === "node:module" || module === "module");
  return loadsModuleBuiltin && calls(query).some(call => call.callee.includes("createRequire"));
}

test("niciun test nou nu mai introduce createRequire", () => {
  const cuRequire = modules.filter(buildsRequire).map(query => query.relativePath);
  assert.ok(
    cuRequire.length <= 28,
    "repo-ul a migrat la ESM, dar testele mai incarca module prin `createRequire`. Numarul are voie sa scada, " +
      `nu sa creasca: gasite ${cuRequire.length}, plafon 28. Un test nou trebuie sa foloseasca import sau ` +      "`await import`, ca tipurile reale ale modulului sa fie verificate"
  );
});

test("modulele migrate chiar folosesc import, nu require deghizat", () => {
  for (const relativePath of ["test/mongo/acquireDbLock.functional.test.ts", "test/native/rustFuzzy.test.ts"]) {
    const query = modules.find(entry => entry.relativePath === relativePath);
    assert.ok(query, `${relativePath} exista`);
    assert.ok(!buildsRequire(query), `${relativePath} a fost migrat si nu are voie sa revina la createRequire`);
    assert.ok(
      calls(query).some(call => call.callee === "import"),
      `${relativePath} incarca modulele prin import dinamic, deci tipurile reale ale modulului sunt verificate`
    );
  }
});

test("modulele native ale Node se incarca prin import static, nu prin require in corpul testului", () => {
  const offenders: string[] = [];
  for (const query of modules) {
    for (const specifier of requireSpecifiers(query)) {
      if (NODE_BUILTINS.has(specifier)) offenders.push(`${query.relativePath}: ${specifier}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "un modul built-in al Node nu are nevoie de createRequire; importul static il aduce cu tipul real: " +
      offenders.join(" | ")
  );
});

test("un require cu tip declarat explicit e deja echivalent cu un import, deci nu mai are motiv sa existe", () => {
  const offenders: string[] = [];
  for (const query of modules) {
    for (const assertion of assertions(query)) {
      if (!assertion.expression.includes("require(") || !assertion.type.startsWith("typeof import(")) continue;
      offenders.push(`${query.relativePath}: ${assertion.expression}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "forma `require(x) as typeof import(x)` aplica deja tipul real, deci migrarea la import nu poate schimba tipuri: " +
      offenders.join(" | ")
  );
});
