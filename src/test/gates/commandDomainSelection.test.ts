import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import path from "node:path";

import { COMMAND_DOMAIN_KEYS, DOMAIN_KEY_COVERAGE } from "../../features/command-registry/commandDomainKeys.js";
import { selectDomainDeps } from "../../features/command-registry/commandDomainSelection.js";
import { createCommandHandlerDescriptors } from "../../features/command-registry/commandHandlerDescriptors.js";
import type { CommandDomainDeps } from "../../features/command-registry/commandDomainDeps.js";

const srcRoot = process.cwd();

function asDomainDeps<D extends keyof CommandDomainDeps>(stub: Record<string, unknown>): Record<string, unknown> & CommandDomainDeps[D] {
  return stub as Record<string, unknown> & CommandDomainDeps[D];
}

function fields(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value));
}

test("listele de chei acopera complet fiecare domeniu, verificat de compilator", () => {
  assert.equal(DOMAIN_KEY_COVERAGE.length, Object.keys(COMMAND_DOMAIN_KEYS).length);
  assert.ok(DOMAIN_KEY_COVERAGE.every(entry => entry === true), "o cheie noua in deps fara intrare in lista rupe compilarea");
});

test("selectia da doar cheile domeniului, nu tot contextul", () => {
  const context = asDomainDeps<"routing">({
    ...Object.fromEntries(COMMAND_DOMAIN_KEYS.routing.map(key => [String(key), () => undefined])),
    GuildModel: "nu are ce cauta la routing",
    NotificationOutboxModel: "nici asta",
    adminAlert: "nici asta"
  });

  const selected = selectDomainDeps("routing", context);
  const keys = Object.keys(fields(selected)).sort();
  assert.deepEqual(keys, COMMAND_DOMAIN_KEYS.routing.map(String).sort());
  assert.ok(!("GuildModel" in fields(selected)), "un handler de routing nu mai poate ajunge la modelul de guild");
});

test("selectia nu inventeaza chei care lipsesc din context", () => {
  const selected = selectDomainDeps("routing", asDomainDeps<"routing">({}));
  assert.deepEqual(Object.keys(fields(selected)), []);
});

test("fiecare descriptor primeste contextul prin propria selectie, nu direct", () => {
  const registry = fs.readFileSync(path.join(srcRoot, "features", "command-registry", "commandRegistry.ts"), "utf8");
  assert.match(registry, /descriptor\.buildFrom\(ctx\)/, "registrul apeleaza pasul de selectie al descriptorului");
  assert.ok(
    !/descriptor\.build\(ctx\)/.test(registry),
    "trimiterea contextului complet direct catre build era exact service locator-ul mascat"
  );

  const descriptors = fs.readFileSync(path.join(srcRoot, "features", "command-registry", "commandHandlerDescriptors.ts"), "utf8");
  assert.match(descriptors, /buildFrom: \(context: CommandDomainDeps\[D\]\) => input\.build\(selectDomainDeps\(input\.domain, context\)\)/);
});

test("toate descriptoarele expun pasul de selectie", () => {
  const descriptors = createCommandHandlerDescriptors();
  assert.ok(descriptors.length > 0);
  for (const descriptor of descriptors) {
    assert.equal(typeof descriptor.buildFrom, "function", `${descriptor.id} nu are pas de selectie`);
    assert.ok(descriptor.domain in COMMAND_DOMAIN_KEYS, `${descriptor.id} declara un domeniu fara lista de chei`);
  }
});

test("domeniile nu isi imprumuta cheile intre ele fara sa se vada", () => {
  const adminOnly = COMMAND_DOMAIN_KEYS.admin.map(String);
  const routingOnly = COMMAND_DOMAIN_KEYS.routing.map(String);
  const shared = adminOnly.filter(key => routingOnly.includes(key));
  assert.ok(
    shared.length <= routingOnly.length,
    "routing e domeniul cel mai mic; daca ar creste peste admin, gruparea pe domenii nu mai spune nimic"
  );
  assert.ok(routingOnly.length < adminOnly.length, "routing ramane strict mai ingust decat admin");
});
