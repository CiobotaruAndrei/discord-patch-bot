import test from "node:test";
import assert from "node:assert/strict";

import { MODERATION_GUARD_TYPES } from "../../features/command-security/moderationGuardDecision.js";
import { MODERATION_GUARD_ENFORCERS, enforcerFor, typesWithoutEnforcer } from "../../features/command-security/moderationGuardEnforcers.js";
import { createDelegationAuthorizer } from "../../features/command-security/delegationAuthorization.js";
import { moduleContext } from "../moduleContextStub.js";
import type { PermissionDelegationRuntimeDeps } from "../../features/command-security/permissionDelegationContext.js";

test("fiecare tip din MODERATION_GUARD_TYPES are un enforcer real, nu doar o valoare in enum", () => {
  assert.deepEqual(
    typesWithoutEnforcer(),
    [],
    "un tip fara runtime e exact problema pe care auditul o numeste F-10: /start moderation-guard raporteaza ca a pornit protectii inexistente"
  );
  for (const type of MODERATION_GUARD_TYPES) {
    const enforcer = enforcerFor(type);
    assert.equal(typeof enforcer?.factory, "function", `enforcer-ul pentru ${type} nu e o fabrica apelabila`);
  }
});

test("registrul de enforceri nu contine tipuri inventate si nu se dubleaza", () => {
  const declared = MODERATION_GUARD_ENFORCERS.map(enforcer => enforcer.type);
  assert.deepEqual([...new Set(declared)], declared, "acelasi tip nu poate avea doi enforceri");
  for (const type of declared) {
    assert.ok(MODERATION_GUARD_TYPES.includes(type), `${type} nu e o subprotectie declarata a moderation-guard`);
  }
});

test("autorizarea comuna lasa sa treaca doar cand poarta e oprita, e raid sau exista aprobare", async () => {
  const calls: string[] = [];
  const gate = {
    readSituation: async () => ({ guardEnabled: true, raidConfirmed: false }),
    consumeApproval: async () => { calls.push("consume"); return null; }
  };
  const authorize = createDelegationAuthorizer(moduleContext<PermissionDelegationRuntimeDeps>({ guard: gate }));

  assert.equal(await authorize("g1", "mod-1", ["Ban Members"], "role-1"), false, "fara aprobare, actiunea nu e autorizata");
  assert.deepEqual(calls, ["consume"], "aprobarea se incearca o singura data");
});

test("autorizarea comuna cedeaza cand poarta e oprita sau raidul e confirmat", async () => {
  const offGate = {
    readSituation: async () => ({ guardEnabled: false, raidConfirmed: false }),
    consumeApproval: async () => null
  };
  const raidGate = {
    readSituation: async () => ({ guardEnabled: true, raidConfirmed: true }),
    consumeApproval: async () => null
  };

  const withoutGuard = createDelegationAuthorizer(moduleContext<PermissionDelegationRuntimeDeps>({ guard: offGate }));
  const duringRaid = createDelegationAuthorizer(moduleContext<PermissionDelegationRuntimeDeps>({ guard: raidGate }));

  assert.equal(await withoutGuard("g1", "mod-1", ["Ban Members"], "role-1"), true, "cu poarta oprita nu se mai corecteaza nimic");
  assert.equal(await duringRaid("g1", "mod-1", ["Ban Members"], "role-1"), true, "in raid decide anti-raid");
});

test("fara poarta configurata, autorizarea nu poate spune da", async () => {
  const authorize = createDelegationAuthorizer(moduleContext<PermissionDelegationRuntimeDeps>({}));

  assert.equal(await authorize("g1", "mod-1", ["Ban Members"], "role-1"), false);
});

test("un actor neidentificat nu poate consuma o aprobare", async () => {
  const calls: string[] = [];
  const gate = {
    readSituation: async () => ({ guardEnabled: true, raidConfirmed: false }),
    consumeApproval: async () => { calls.push("consume"); return { _id: "req-1" }; }
  };
  const authorize = createDelegationAuthorizer(moduleContext<PermissionDelegationRuntimeDeps>({ guard: gate }));

  assert.equal(await authorize("g1", null, ["Ban Members"], "role-1"), false);
  assert.deepEqual(calls, [], "fara actor nu se atinge nicio aprobare");
});

test("subprotectiile care sanctioneaza autorul sunt cele patru declarate de specificatie", () => {
  const sanctioning = MODERATION_GUARD_ENFORCERS.filter(enforcer => enforcer.sanctionsAuthor).map(enforcer => enforcer.type);

  assert.deepEqual(
    [...sanctioning].sort(),
    ["moderation-mass", "protected-resource-change", "server-structure", "webhook"],
    "daca o subprotectie pierde sanctiunea autorului, autorul compromis isi pastreaza capacitatea de a repeta actiunea"
  );
});
