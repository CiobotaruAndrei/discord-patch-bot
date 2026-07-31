import test from "node:test";
import assert from "node:assert/strict";

import { loadModule, functionNames, importedModules } from "./sourceStructureQueries.js";

const security = loadModule("features", "command-security", "securityRuntime.ts");
const delegation = loadModule("features", "command-security", "permissionDelegationRuntime.ts");

const SECURITY_EVENTS: ReadonlyArray<readonly [string, string]> = [
  ["botAddSecurityRuntime.ts", "createBotAddSecurityRuntime"],
  ["messageThreatRuntime.ts", "createMessageThreatRuntime"],
  ["channelLockCleanupRuntime.ts", "createChannelLockCleanupRuntime"]
];

const DELEGATION_EVENTS: ReadonlyArray<readonly [string, string]> = [
  ["roleDelegationRuntime.ts", "createRoleDelegationRuntime"],
  ["channelDelegationRuntime.ts", "createChannelDelegationRuntime"],
  ["sensitiveActionObserver.ts", "createSensitiveActionObserver"]
];

test("fiecare eveniment de securitate are runtime-ul lui", () => {
  for (const [file, factory] of [...SECURITY_EVENTS, ...DELEGATION_EVENTS]) {
    const query = loadModule("features", "command-security", file);
    assert.ok(functionNames(query).includes(factory), `${file} expune ${factory}`);
  }
});

test("fisierele de compunere doar cableaza, nu mai contin handlere", () => {
  const composed: ReadonlyArray<readonly [typeof security, readonly string[]]> = [
    [security, ["handleGuildMemberAdd", "handleMessageCreate", "handleChannelDelete", "handleBotAdd", "handleBotMessageCreate"]],
    [delegation, ["handleRoleUpdate", "handleGuildMemberUpdate", "handleRoleCreate", "handleChannelUpdate", "handleWebhookUpdate"]]
  ];
  for (const [query, handlers] of composed) {
    const own = functionNames(query);
    const relapsed = handlers.filter(name => own.includes(name));
    assert.deepEqual(
      relapsed,
      [],
      "un handler intors in fisierul de compunere inseamna ca evenimentele se amesteca din nou intr-un singur fisier de ~400 de linii: " +
        relapsed.join(", ")
    );
  }
});

test("dedublarea actiunilor sensibile ramane un singur observator, partajat", () => {
  const observer = "sensitiveActionObserver.js";
  for (const file of ["roleDelegationRuntime.ts", "channelDelegationRuntime.ts"]) {
    const query = loadModule("features", "command-security", file);
    assert.ok(
      importedModules(query).some(module => module.endsWith(observer)),
      `${file} primeste observatorul comun; doua seturi paralele de intrari de audit deja procesate ar sparge dedublarea ` +
        "intre familii de evenimente, adica ar trimite alerte duble pentru aceeasi intrare"
    );
  }
  assert.ok(
    importedModules(delegation).some(module => module.endsWith(observer)),
    "compunerea creeaza un singur observator si il da ambelor familii de evenimente"
  );
});
