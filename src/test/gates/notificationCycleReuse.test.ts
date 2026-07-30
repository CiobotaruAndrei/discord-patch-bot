import test from "node:test";
import assert from "node:assert/strict";

import { loadModule, calls, callsWithin, propertyValues, importedModules, functionNames, stringLiteralsIn, identifierNames } from "./sourceStructureQueries.js";
import type { ModuleQuery } from "./sourceStructureQueries.js";

const SERVICES: ReadonlyArray<readonly [string, string]> = [
  ["updateNotificationService.ts", "update"],
  ["discountNotificationService.ts", "discount"],
  ["dlcNotificationService.ts", "dlc"]
];

const services = new Map<string, ModuleQuery>(
  SERVICES.map(([file]) => [file, loadModule("features", "notifications", file)])
);

const core = loadModule("features", "notifications", "notificationCycle.ts");

function serviceOf(file: string): ModuleQuery {
  const query = services.get(file);
  assert.ok(query, `serviciul ${file} exista`);
  return query;
}

test("fiecare serviciu ruleaza tot ciclul prin nucleu, nu doar revendicarea", () => {
  for (const [file] of SERVICES) {
    const invoked = calls(serviceOf(file)).map(call => call.callee);
    assert.ok(
      invoked.includes("runGuildNotificationCycle"),
      `${file} trebuie sa treaca prin runGuildNotificationCycle: revendicarea, trimiterea si eliberarea claim-ului ` +
        "sunt un singur pas cu efecte legate, nu trei apeluri pe care serviciul le poate desincroniza"
    );
  }
});

test("niciun serviciu nu mai sare peste nucleu ca sa revendice sau sa trimita separat", () => {
  const offenders: string[] = [];
  for (const [file] of SERVICES) {
    const query = serviceOf(file);
    for (const call of calls(query)) {
      if (call.callee === "claimIntoBatch" || call.callee === "sendEmbedBatch") offenders.push(`${file}: ${call.callee}`);
    }
    for (const module of importedModules(query)) {
      if (module.includes("notificationBatchExecutor")) offenders.push(`${file}: importa executorul de trimitere direct`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "cine cheama separat revendicarea si trimiterea isi scrie de doua ori aceeasi identitate de item si acelasi rollback; " +
      `exact asa ajung sa difere (${offenders.join(", ")})`
  );
});

test("niciun serviciu nu isi mai scrie propria bucla de revendicare", () => {
  const offenders: string[] = [];
  for (const [file] of SERVICES) {
    for (const call of calls(serviceOf(file))) {
      if (call.callee === "matchedDocument") offenders.push(file);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "citirea directa a rezultatului de revendicare inseamna ca serviciul si-a refacut bucla: " +
      `rollback-ul, dead-letter-ul si oprirea pe eroare permanenta trebuie sa vina din nucleu (${offenders.join(", ")})`
  );
});

test("fiecare serviciu isi declara tipul de notificare o singura data", () => {
  for (const [file, kind] of SERVICES) {
    const query = serviceOf(file);
    assert.deepEqual(
      stringLiteralsIn(query, "NOTIFICATION_KIND"),
      [kind],
      `${file} declara tipul "${kind}" intr-o singura constanta`
    );
    const literals = propertyValues(query, "kind").filter(value => value.startsWith('"'));
    assert.deepEqual(
      literals,
      [],
      `${file} nu mai repeta tipul ca sir: ciclul, dead-letter-ul si filtrul de abonament il iau din aceeasi constanta; ` +
        `repetat, istoricul si rollback-ul pot ajunge sa se refere la tipuri diferite (${literals.join(", ")})`
    );
  }
});

test("contextul de cron al fiecarui serviciu vine din registrul de tipuri, nu dintr-un sir scris de mana", () => {
  for (const [file] of SERVICES) {
    const query = serviceOf(file);
    assert.ok(
      calls(query).some(call => call.callee === "cronContextFor"),
      `${file} isi deriva contextul de log din tipul de notificare`
    );
    const handWritten = [...identifierNames(query)].filter(name => name.startsWith("CRON_") && name !== "CRON_CONTEXT");
    assert.deepEqual(handWritten, [], `${file} nu mai are constante CRON_* proprii`);
  }
});

test("nucleul deriva istoricul, contextul de cron si filtrul din tipul primit", () => {
  const invoked = calls(core).map(call => call.callee);
  assert.ok(invoked.includes("cronContextFor"), "contextul de log vine din registrul de tipuri, nu din siruri repetate");
  const history = callsWithin(core, "runGuildNotificationCycle")
    .filter(call => call.callee === "sendEmbedBatch")
    .flatMap(call => call.args);
  assert.ok(
    history.some(arg => arg.includes("kind: cycle.kind") && arg.includes("cycle.identify")),
    "intrarea de istoric isi ia tipul din ciclu si restul campurilor din singura descriere a itemului"
  );
});

test("identitatea unui item are o singura definitie per serviciu", () => {
  for (const [file] of SERVICES) {
    const query = serviceOf(file);
    assert.deepEqual(
      propertyValues(query, "rollbackFailureContext"),
      [],
      `${file} nu isi mai construieste contextul de rollback: nucleul il obtine din identify`
    );
    assert.deepEqual(
      propertyValues(query, "historyEntryFor"),
      [],
      `${file} nu isi mai construieste separat intrarea de istoric`
    );
  }
});

test("nucleul acopera claim, trimitere, eliberare si persistare", () => {
  const exported = functionNames(core);
  assert.ok(exported.includes("claimIntoBatch"), "nucleul pastreaza pasul de revendicare");
  assert.ok(exported.includes("runGuildNotificationCycle"), "si compune ciclul complet peste el");

  const inside = callsWithin(core, "runGuildNotificationCycle").map(call => call.callee);
  for (const step of ["claimIntoBatch", "sendEmbedBatch", "cycle.persist"]) {
    assert.ok(inside.includes(step), `ciclul complet include pasul ${step}`);
  }

  const claimLoop = callsWithin(core, "claimIntoBatch").map(call => call.callee);
  assert.ok(claimLoop.includes("options.rollback"), "revendicarea esuata dupa succes se da inapoi");
  assert.ok(claimLoop.includes("options.onPermanentError"), "eroarea permanenta opreste bucla");
});
