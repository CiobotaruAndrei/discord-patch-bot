import test from "node:test";
import assert from "node:assert/strict";

import { REQUEST_SCHEMAS, validatePermissionRequest } from "../../features/command-security/permissionRequestValidation.js";
import { MODERATION_GUARD_TYPES } from "../../features/command-security/moderationGuardDecision.js";

import type { PermissionRequestInput } from "../../features/command-security/permissionRequestValidation.js";

function input(overrides: Partial<PermissionRequestInput> = {}): PermissionRequestInput {
  return {
    type: "webhook",
    target: "111111111111111111",
    action: "create",
    reason: "integrare",
    amount: null,
    permissions: [],
    botId: null,
    duration: "",
    ...overrides
  };
}

test("fiecare subprotectie moderation-guard are o schema de validare (F-05)", () => {
  for (const type of MODERATION_GUARD_TYPES) {
    const schema = REQUEST_SCHEMAS[type];
    assert.ok(schema, `${type} nu are schema de validare`);
    assert.ok(schema.actions.length > 0, `${type} accepta orice actiune`);
  }
});

test("tinta trebuie sa fie un identificator Discord, nu un sir liber (F-05)", () => {
  const result = validatePermissionRequest(input({ target: "canalul de anunturi" }));

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.problem, /17-20 cifre/);
});

test("actiunea trebuie sa fie una din vocabularul tipului, nu text liber (F-05)", () => {
  const result = validatePermissionRequest(input({ action: "orice vreau eu" }));

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.problem, /create, delete, update/);
});

test("o durata invalida e refuzata explicit, nu inlocuita in tacere cu implicitul (F-05)", () => {
  const result = validatePermissionRequest(input({ duration: "cateva ore" }));

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.problem, /30m, 2h sau 1d/);
});

test("o durata valida ajunge in cerere ca milisecunde (F-05)", () => {
  const result = validatePermissionRequest(input({ duration: "2h" }));

  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.value.ttlMs : null, 7_200_000);
});

test("fara durata, cererea foloseste valabilitatea implicita a repository-ului (F-05)", () => {
  const result = validatePermissionRequest(input());

  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.value.ttlMs : "definit", undefined);
});

test("permission-grant cere permisiuni, iar acelea trebuie sa fie permisiuni ridicate reale (F-05)", () => {
  const missing = validatePermissionRequest(input({ type: "permission-grant", action: "grant" }));
  assert.equal(missing.ok, false);
  assert.match(missing.ok ? "" : missing.problem, /lista de permisiuni este obligatorie/);

  const invented = validatePermissionRequest(input({
    type: "permission-grant",
    action: "grant",
    permissions: ["ManageEverything"]
  }));
  assert.equal(invented.ok, false);
  assert.match(invented.ok ? "" : invented.problem, /necunoscute sau neprotejate/);

  const good = validatePermissionRequest(input({
    type: "permission-grant",
    action: "grant",
    permissions: ["Ban Members"]
  }));
  assert.equal(good.ok, true);
});

test("moderation-mass cere o cantitate pozitiva (F-05)", () => {
  const missing = validatePermissionRequest(input({ type: "moderation-mass", action: "ban" }));
  assert.equal(missing.ok, false);
  assert.match(missing.ok ? "" : missing.problem, /mai mare ca zero/);

  const good = validatePermissionRequest(input({ type: "moderation-mass", action: "ban", amount: 5 }));
  assert.equal(good.ok, true);
});

test("bot-add deduce botul executor din tinta, iar un bot explicit invalid e refuzat (F-05)", () => {
  const derived = validatePermissionRequest(input({ type: "bot-add", action: "add", target: "222222222222222222" }));
  assert.equal(derived.ok, true);
  assert.equal(derived.ok ? derived.value.botId : null, "222222222222222222");

  const bad = validatePermissionRequest(input({ type: "webhook", action: "create", botId: "botul-meu" }));
  assert.equal(bad.ok, false);
  assert.match(bad.ok ? "" : bad.problem, /17-20 de cifre/);
});

test("actiunea e normalizata, ca o aprobare scrisa cu majuscule sa se potriveasca la consum (F-05)", () => {
  const result = validatePermissionRequest(input({ action: "  CREATE " }));

  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.value.action : null, "create");
});
