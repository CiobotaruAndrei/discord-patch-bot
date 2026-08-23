import test from "node:test";
import assert from "node:assert/strict";

import { SECURITY_MODULES } from "../../features/command-security/securityIncidentContract.js";
import { calls, loadModule } from "./sourceStructureQueries.js";

function usedInCalls(query: Parameters<typeof calls>[0]): Set<string> {
  const used = new Set<string>();
  for (const call of calls(query)) {
    used.add(call.callee);
    for (const argument of call.args) used.add(argument);
  }
  return used;
}

const PROJECTORS = [
  "projectAuditEntry",
  "projectRaidIncident",
  "projectPermissionRequest",
  "projectAdRequest",
  "projectAdAttempts"
] as const;

test("fiecare proiectie trece prin constructorul contractului, nu isi inventeaza forma", () => {
  const projection = loadModule("features", "command-security", "securityIncidentProjection.ts");
  const constructed = calls(projection).filter(call => call.callee === "securityIncident");

  assert.ok(
    constructed.length >= PROJECTORS.length,
    `fiecare depozit trebuie sa produca un SecurityIncident prin constructorul comun; gasite ${constructed.length} apeluri pentru ${PROJECTORS.length} proiectii`
  );
});

test("cronologia unificata foloseste toate proiectiile declarate, nu doar cateva", () => {
  const handler = loadModule("features", "command-handlers", "securityOverviewHandler.ts");
  const used = usedInCalls(handler);

  for (const projector of PROJECTORS) {
    assert.ok(
      used.has(projector),
      `${projector} exista dar nu ajunge in /security-log: un depozit ramas pe dinafara e exact fragmentarea pe care contractul o repara`
    );
  }
});

test("cronologia ordoneaza si deduplica prin contract, nu ad-hoc in handler", () => {
  const handler = loadModule("features", "command-handlers", "securityOverviewHandler.ts");
  const used = usedInCalls(handler);

  assert.ok(used.has("orderIncidents"), "ordonarea si dedup-ul global traiesc in contract");
  assert.ok(used.has("toLogEntry"), "afisarea deriva din incident, nu din campuri compuse in handler");
});

test("modulele declarate acopera protectiile reale, fara nume inventate", () => {
  assert.deepEqual(
    [...SECURITY_MODULES].sort(),
    ["ad-protection", "anti-raid", "audit", "moderation-guard", "protected-resource"]
  );
});
