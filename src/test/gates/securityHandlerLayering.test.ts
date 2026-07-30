import test from "node:test";
import assert from "node:assert/strict";

import { loadModule, calls, eachNode, functionNames, importedModules, lineCount } from "./sourceStructureQueries.js";
import type { ModuleQuery } from "./sourceStructureQueries.js";

import ts from "typescript";

const handler = loadModule("features", "command-handlers", "securityInteractionHandler.ts");
const messages = loadModule("features", "command-presentation", "securityCommandMessages.ts");

const USE_CASES = ["channelLockUseCase.ts", "purgeMessagesUseCase.ts", "toggleProtectionUseCase.ts", "setSecurityChannelUseCase.ts"];

const LINE_CAPS: ReadonlyArray<readonly [readonly string[], number]> = [
  [["features", "command-handlers", "securityInteractionHandler.ts"], 280],
  [["features", "command-security", "securityInteractionAdapters.ts"], 140],
  [["features", "command-security", "securityInteractionContracts.ts"], 110],
  [["features", "command-presentation", "securityCommandMessages.ts"], 120]
];

function userFacingLiterals(query: ModuleQuery): string[] {
  const found: string[] = [];
  eachNode(query, node => {
    if (!ts.isStringLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node) && !ts.isTemplateExpression(node)) return;
    const text = node.getText();
    if (/^["'`](OK:|Eroare:|Atentie:)/.test(text)) found.push(text.slice(0, 60));
  });
  return found;
}

test("mesajele catre utilizator traiesc in prezentare, nu in router", () => {
  assert.deepEqual(
    userFacingLiterals(handler),
    [],
    "un router care isi scrie singur textele amesteca rutarea cu prezentarea; formularea sta in securityCommandMessages"
  );
  assert.ok(userFacingLiterals(messages).length > 10, "modulul de prezentare chiar detine formularile");
});

test("use-case-urile sunt decizie pura: nu cunosc Discord si nici persistenta", () => {
  for (const file of USE_CASES) {
    const query = loadModule("features", "command-security", file);
    for (const module of importedModules(query)) {
      assert.ok(!module.includes("discord.js"), `${file}: decizia nu depinde de biblioteca de Discord`);
      assert.ok(!module.includes("infra/"), `${file}: decizia nu atinge infrastructura`);
      assert.ok(!module.includes("mongoose"), `${file}: decizia nu cunoaste driverul`);
    }
    const invoked = calls(query).map(call => call.callee);
    for (const forbidden of invoked) {
      assert.ok(
        !forbidden.startsWith("applyGuildConfigUpdate") && !forbidden.startsWith("setLockedChannelPermissionState"),
        `${file}: efectele se fac prin dependinte injectate, nu prin apeluri directe de repository`
      );
    }
  }
});

test("routerul deleaga fiecare familie de comenzi catre use-case-ul ei", () => {
  const invoked = calls(handler).map(call => call.callee);
  for (const useCase of ["setSecurityChannel", "toggleProtection", "applyChannelLock", "purgeMessages"]) {
    assert.equal(
      invoked.filter(callee => callee === useCase).length,
      1,
      `${useCase} e apelat exact o data: o a doua cale ar insemna doua variante ale aceleiasi reguli`
    );
  }
  for (const renderer of ["renderSetChannelOutcome", "renderToggleProtectionOutcome", "renderChannelLockOutcome", "renderPurgeOutcome"]) {
    assert.ok(invoked.includes(renderer), `${renderer} e folosit de router pentru raspuns`);
  }
});

test("routerul nu mai contine bucla de compensare: rollback-ul e in use-case", () => {
  let tryBlocks = 0;
  eachNode(handler, node => {
    if (ts.isTryStatement(node)) tryBlocks += 1;
  });
  assert.equal(
    tryBlocks,
    0,
    "orice try/catch in router inseamna ca o decizie de compensare a ramas amestecata cu rutarea; " +
      "esecurile se intorc ca rezultat tipat din use-case"
  );
});

test("adaptoarele de interactiune sunt un modul separat, nu functii libere in router", () => {
  const adapters = loadModule("features", "command-security", "securityInteractionAdapters.ts");
  for (const helper of [
    "botChannelPermissions",
    "missingChannelPermissions",
    "permissionState",
    "permissionValue",
    "revertOverwriteWithRetry",
    "sendExistingAccountAlerts",
    "channelBulkDelete",
    "isSecurityInteraction"
  ]) {
    assert.ok(functionNames(adapters).includes(helper), `${helper} traieste in modulul de adaptoare`);
    assert.ok(!functionNames(handler).includes(helper), `${helper} nu mai e declarat in router`);
  }
});

test("plafoanele de dimensiune pot doar sa scada", () => {
  for (const [segments, cap] of LINE_CAPS) {
    const lines = lineCount(loadModule(...segments));
    assert.ok(lines <= cap, `${segments.join("/")}: ${lines} linii, plafonul e ${cap}`);
  }
});
