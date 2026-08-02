import test from "node:test";
import assert from "node:assert/strict";

import { REQUEST_SCHEMAS } from "../../features/command-security/permissionRequestValidation.js";
import { calls, loadModule } from "./sourceStructureQueries.js";

const CONSUME_SITES: ReadonlyArray<{ type: keyof typeof REQUEST_SCHEMAS; literals: readonly string[] }> = [
  { type: "bot-add", literals: ["add"] },
  { type: "permission-grant", literals: ["grant"] }
];

test("actiunile literale folosite la consum exista in vocabularul acceptat la creare", () => {
  for (const site of CONSUME_SITES) {
    for (const literal of site.literals) {
      assert.ok(
        REQUEST_SCHEMAS[site.type].actions.includes(literal),
        `runtime-ul consuma aprobari cu action="${literal}" pentru ${site.type}, dar comanda nu accepta acea valoare`
      );
    }
  }
});

test("gateway-ul nu inventeaza actiuni literale in afara vocabularului declarat", () => {
  const gateway = loadModule("app", "runtime", "gatewayFeatureRuntimes.ts");
  const consumed = calls(gateway).filter(call => call.callee.endsWith(".consume") || call.callee.endsWith(".consumeAll"));

  assert.ok(consumed.length > 0, "gate-ul nu mai vede niciun consum de aprobare; verifica daca s-a redenumit apelul");

  const declared = new Set(Object.values(REQUEST_SCHEMAS).flatMap(schema => [...schema.actions]));
  for (const call of consumed) {
    for (const argument of call.args) {
      const literal = /action:\s*"([^"]+)"/.exec(argument)?.[1];
      if (!literal) continue;
      assert.ok(declared.has(literal), `actiunea "${literal}" e consumata dar nu e declarata in nicio schema de cerere`);
    }
  }
});
