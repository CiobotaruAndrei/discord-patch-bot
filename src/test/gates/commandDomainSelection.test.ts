import test from "node:test";
import assert from "node:assert/strict";

import { deriveCommandDomainKeys } from "../../features/command-registry/commandDomainKeys.js";
import { selectHandlerDeps } from "../../features/command-registry/commandDomainSelection.js";
import { createCommandHandlerDescriptors } from "../../features/command-registry/commandHandlerDescriptors.js";
import type { CommandDomainDeps } from "../../features/command-registry/commandDomainDeps.js";

const domainKeys = deriveCommandDomainKeys();

import { loadModule, loadModulesIn, calls, exportedConstNames, importedModules } from "./sourceStructureQueries.js";

function asDomainDeps<D extends keyof CommandDomainDeps>(stub: Record<string, unknown>): Record<string, unknown> & CommandDomainDeps[D] {
  return stub as Record<string, unknown> & CommandDomainDeps[D];
}

function fields(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value));
}

test("cheile unui domeniu se deduc din handlerele lui, nu dintr-o lista scrisa de mana", () => {
  const descriptors = createCommandHandlerDescriptors();
  for (const [domain, keys] of Object.entries(domainKeys)) {
    const dinDescriptoare = new Set(
      descriptors.filter(descriptor => descriptor.domain === domain).flatMap(descriptor => descriptor.needs.map(String))
    );
    assert.deepEqual(
      [...keys].sort(),
      [...dinDescriptoare].sort(),
      `domeniul ${domain} nu mai poate avea chei pe care nu le cere niciun handler al lui`
    );
  }
  assert.ok(Object.keys(domainKeys).length >= 7, "toate domeniile de handlere apar in derivare");
});

test("lista de chei a fiecarui handler sta langa handler si e verificata acolo", () => {
  const declarate: string[] = [];
  const fara_verificare: string[] = [];
  const module_dirs = [["features", "command-handlers"], ["features", "command-handlers", "youtube"], ["features", "command-security"]];
  for (const query of module_dirs.flatMap(directory => loadModulesIn(directory, name => name.endsWith(".ts")))) {
    const nume = exportedConstNames(query).filter(name => name.endsWith("_HANDLER_KEYS"));
    if (nume.length === 0) continue;
    declarate.push(query.relativePath);
    if (!importedModules(query).some(module => module.endsWith("shared/dependencyKeyContract.js"))) {
      fara_verificare.push(query.relativePath);
    }
  }
  assert.ok(declarate.length >= 36, `doar ${declarate.length} handlere isi declara lista langa ele; nu se intoarce nimeni la un registru central`);
  assert.deepEqual(
    fara_verificare,
    [],
    "o lista fara `ExactDependencyKeys` langa ea e exact registrul manual de dinainte: text care nu verifica nimic. " +
      `Fisierele astea declara chei fara verificare: ${fara_verificare.join(", ")}`
  );
});

test("selectia da doar cheile domeniului, nu tot contextul", () => {
  const context = asDomainDeps<"routing">({
    ...Object.fromEntries(domainKeys.routing.map(key => [key, () => undefined])),
    GuildModel: "nu are ce cauta la routing",
    NotificationOutboxModel: "nici asta",
    adminAlert: "nici asta"
  });

  const selected = selectHandlerDeps<"routing", keyof CommandDomainDeps["routing"]>(
    context,
    domainKeys.routing as readonly (keyof CommandDomainDeps["routing"])[]
  );
  const keys = Object.keys(fields(selected)).sort();
  assert.deepEqual(keys, [...domainKeys.routing].sort());
  assert.ok(!("GuildModel" in fields(selected)), "un handler de routing nu mai poate ajunge la modelul de guild");
});

test("selectia per handler da strict mai putin decat domeniul", () => {
  const context = asDomainDeps<"admin">({
    ...Object.fromEntries(domainKeys.admin.map(key => [key, () => undefined]))
  });
  const descriptors = createCommandHandlerDescriptors();
  const descriptor = descriptors.find(descriptor => descriptor.id === "permission-request" && descriptor.domain === "admin");
  assert.ok(descriptor, "descriptorul permission-request exista");
  const needs: readonly (keyof CommandDomainDeps["admin"])[] = descriptor.domain === "admin" ? descriptor.needs : [];

  const selected = selectHandlerDeps<"admin", keyof CommandDomainDeps["admin"]>(context, needs);
  const selectedKeys = Object.keys(fields(selected));
  assert.deepEqual(
    selectedKeys.sort(),
    needs.map(String).sort(),
    "handler-ul primeste exact ce a declarat, nu domeniul intreg"
  );
  assert.ok(
    selectedKeys.length < domainKeys.admin.length,
    `permission-request cere ${selectedKeys.length} chei dintr-un domeniu de ${domainKeys.admin.length}; ` +
      "daca ar primi tot domeniul, selectorul nu ar spune nimic"
  );
});

test("selectia nu inventeaza chei care lipsesc din context", () => {
  const selected = selectHandlerDeps<"routing", keyof CommandDomainDeps["routing"]>(asDomainDeps<"routing">({}), domainKeys.routing as readonly (keyof CommandDomainDeps["routing"])[]);
  assert.deepEqual(Object.keys(fields(selected)), []);
});

test("fiecare descriptor isi declara propriile chei si construieste prin ele", () => {
  const registry = loadModule("features", "command-registry", "commandRegistry.ts");
  const invoked = calls(registry).map(call => call.callee);
  assert.ok(invoked.includes("descriptor.buildFrom"), "registrul apeleaza pasul de selectie al descriptorului");
  assert.ok(
    !invoked.includes("descriptor.build"),
    "trimiterea contextului complet direct catre build era exact service locator-ul mascat"
  );

  const descriptors = loadModule("features", "command-registry", "commandHandlerDescriptors.ts");
  const narrowing = calls(descriptors).find(call => call.callee === "input.build");
  assert.ok(narrowing, "descriptorul construieste handler-ul prin build");
  assert.deepEqual(
    narrowing?.args,
    ["selectHandlerDeps<D, K>(context, input.needs)"],
    "ingustarea se face cu lista handler-ului, nu cu cea a domeniului, iar `K` o leaga la compilare de tipul primit de `build`"
  );
});

test("toate descriptoarele declara o lista de chei nevida si coerenta cu domeniul", () => {
  const descriptors = createCommandHandlerDescriptors();
  assert.ok(descriptors.length > 0);
  for (const descriptor of descriptors) {
    assert.equal(typeof descriptor.buildFrom, "function", `${descriptor.id} nu are pas de selectie`);
    assert.ok(descriptor.domain in domainKeys, `${descriptor.id} declara un domeniu fara lista de chei`);
    assert.ok(descriptor.needs.length > 0, `${descriptor.id} nu declara nicio dependinta; un handler fara deps e suspect`);
    const cheileDomeniului = new Set(domainKeys[descriptor.domain]);
    const outside = descriptor.needs.map(String).filter(key => !cheileDomeniului.has(key));
    assert.deepEqual(outside, [], `${descriptor.id} cere chei din afara domeniului lui: ${outside.join(", ")}`);
  }
});

test("suma cheilor cerute de handlere e mult sub suma domeniilor repetate", () => {
  const descriptors = createCommandHandlerDescriptors();
  const perHandler = descriptors.reduce((total, descriptor) => total + descriptor.needs.length, 0);
  const perDomain = descriptors.reduce((total, descriptor) => total + domainKeys[descriptor.domain].length, 0);
  assert.ok(
    perHandler * 2 < perDomain,
    `handlerele cer in total ${perHandler} chei, fata de ${perDomain} daca fiecare ar primi domeniul lui; ` +
      "diferenta e exact suprafata pe care un handler nu o mai poate atinge"
  );
});

test("domeniile nu isi imprumuta cheile intre ele fara sa se vada", () => {
  const adminOnly = domainKeys.admin.map(String);
  const routingOnly = domainKeys.routing.map(String);
  assert.ok(routingOnly.length < adminOnly.length, "routing ramane strict mai ingust decat admin");
});
