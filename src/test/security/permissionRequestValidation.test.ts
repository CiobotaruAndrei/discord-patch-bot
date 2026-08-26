import test from "node:test";
import assert from "node:assert/strict";

import { REQUEST_SCHEMAS, validatePermissionRequest } from "../../features/command-security/permissionRequestValidation.js";
import { MODERATION_GUARD_TYPES } from "../../features/command-security/moderationGuardDecision.js";
import { scopeFingerprint, scopeMatchesApproval } from "../../features/command-security/permissionRequestTypes.js";
import { restrictionFromModal } from "../../features/command-security/permissionRequestApproval.js";
import { DEFAULT_APPROVED_TTL_MS, validateRestrictionIsSubset } from "../../features/command-security/approvalSubsetPolicy.js";
import type { PermissionRequestRecord } from "../../features/command-security/permissionRequestTypes.js";

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

test("o cerere webhook cu cantitate e refuzata, nu curatata tacut (F-05)", () => {
  const result = validatePermissionRequest(input({ type: "webhook", amount: 5 }));

  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.problem : "", /nu se aplica: cantitate/);
});

test("o cerere de structura cu permisiuni e refuzata (F-05)", () => {
  const result = validatePermissionRequest(input({ type: "server-structure", action: "create", permissions: ["Administrator"] }));

  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.problem : "", /nu se aplica: permisiuni/);
});

test("botul executor ramane aplicabil pe orice tip, fiindca orice suprafata poate fi atinsa de un bot (F-05, F-08)", () => {
  const result = validatePermissionRequest(input({ type: "webhook", botId: "222222222222222222" }));

  assert.equal(result.ok, true, "restrangerea botului executor e o ingustare reala, nu un camp strain");
  assert.equal(result.ok === true ? result.value.botId : null, "222222222222222222");
});

test("mai multe campuri straine sunt enumerate toate, nu doar primul (F-05)", () => {
  const result = validatePermissionRequest(input({ type: "webhook", amount: 3, permissions: ["Administrator"] }));

  assert.equal(result.ok, false);
  const problem = result.ok === false ? result.problem : "";
  assert.match(problem, /cantitate/);
  assert.match(problem, /permisiuni/);
});

test("campurile care apartin tipului trec neatinse (F-05)", () => {
  const mass = validatePermissionRequest(input({ type: "moderation-mass", action: "ban", amount: 4 }));
  const grant = validatePermissionRequest(input({ type: "permission-grant", action: "grant", permissions: ["Manage Roles"] }));

  assert.equal(mass.ok, true);
  assert.equal(mass.ok === true ? mass.value.amount : null, 4);
  assert.equal(grant.ok, true);
});

test("bot-add isi deriva botul executor din tinta, fara sa fie considerat camp strain (F-05)", () => {
  const result = validatePermissionRequest(input({ type: "bot-add", action: "add", target: "333333333333333333" }));

  assert.equal(result.ok, true);
  assert.equal(result.ok === true ? result.value.botId : null, "333333333333333333");
});

test("scope-ul rezultat e canonic: permisiuni normalizate, sortate si fara duplicate (F-05)", () => {
  const result = validatePermissionRequest(input({
    type: "permission-grant",
    action: "grant",
    permissions: ["Manage Roles", "manage_roles", "Administrator"]
  }));

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok === true ? result.value.permissions : [], ["administrator", "manageroles"],
    "doua scrieri ale aceleiasi permisiuni trebuie sa produca acelasi scope, altfel matchingul depinde de cum a scris-o ownerul");
});

test("doua cereri echivalente au aceeasi amprenta de scope (F-05)", () => {
  const left = scopeFingerprint("permission-grant", {
    target: "111111111111111111", action: "grant", permissions: ["Manage Roles", "Administrator"]
  });
  const right = scopeFingerprint("permission-grant", {
    target: "111111111111111111", action: "GRANT", permissions: ["administrator", "manage_roles", "Manage Roles"]
  });

  assert.equal(left, right, "amprenta canonica e ce face doua cereri identice sa fie recunoscute ca identice");
});

test("amprenta ignora campurile care nu apartin tipului (F-05)", () => {
  const fara = scopeFingerprint("webhook", { target: "111111111111111111", action: "create" });
  const cu = scopeFingerprint("webhook", { target: "111111111111111111", action: "create", amount: 9 });

  assert.equal(fara, cu, "cantitatea nu guverneaza matchingul de webhook, deci nu are voie sa produca un scope diferit");
});

function approvalRecord(overrides: Partial<PermissionRequestRecord> = {}): PermissionRequestRecord {
  return {
    _id: "req-1", guildId: "g1", type: "webhook", requesterId: "u1",
    target: "111111111111111111", action: "create", reason: "integrare",
    status: "approved", requestedAt: new Date(), ...overrides
  };
}

test("o actiune aprobata scrisa cu majuscule se potriveste cu incercarea runtime-ului (review PR #990)", () => {
  const record = approvalRecord({ approvedAction: "CREATE" });

  assert.equal(
    scopeMatchesApproval(record, { target: "111111111111111111", action: "create" }),
    true,
    "runtime-ul trimite mereu actiunea minusculizata; fara canonicalizare in matcher, aprobarea ownerului devine inutilizabila"
  );
});

test("o tinta aprobata cu spatii in plus se potriveste (review PR #990)", () => {
  const record = approvalRecord({ approvedTarget: " 111111111111111111 " });

  assert.equal(scopeMatchesApproval(record, { target: "111111111111111111", action: "create" }), true);
});

test("permisiunile aprobate scrise altfel decat cele incercate se potrivesc (review PR #990)", () => {
  const record = approvalRecord({
    type: "permission-grant", action: "grant",
    approvedPermissions: ["Manage_Roles", "ADMINISTRATOR"]
  });

  assert.equal(
    scopeMatchesApproval(record, { target: "111111111111111111", action: "grant", permissions: ["manage roles"] }),
    true
  );
});

test("canonicalizarea nu largeste scope-ul: o alta actiune tot nu se potriveste (review PR #990)", () => {
  const record = approvalRecord({ approvedAction: "CREATE" });

  assert.equal(scopeMatchesApproval(record, { target: "111111111111111111", action: "delete" }), false);
  assert.equal(scopeMatchesApproval(record, { target: "222222222222222222", action: "create" }), false);
});

test("restrictia din modal e salvata canonic, nu cum a scris-o ownerul (review PR #990)", () => {
  const record = approvalRecord({ action: "create" });

  const restriction = restrictionFromModal(record, { target: " 111111111111111111 ", action: "DELETE" });

  assert.equal(restriction.action, "delete", "ambele capete canonicalizeaza, ca potrivirea sa nu depinda de scriere");
  assert.equal(restriction.target ?? null, null, "o tinta identica dupa canonicalizare nu e o restrangere");
});

function pendingRecord(overrides: Partial<PermissionRequestRecord> = {}): PermissionRequestRecord {
  return {
    _id: "req-1", guildId: "g1", type: "moderation-mass", requesterId: "u1",
    target: "111111111111111111", action: "ban", amount: 5, reason: "curatare",
    status: "pending", requestedAt: new Date(), ...overrides
  };
}

test("ownerul nu poate schimba tinta la aprobare, doar sa o pastreze (F-08)", () => {
  const verdict = validateRestrictionIsSubset(pendingRecord(), { target: "222222222222222222" });

  assert.equal(verdict.ok, false);
  assert.match(verdict.ok === false ? verdict.problem : "", /Tinta nu poate fi schimbata/,
    "o tinta diferita e alta operatiune, nu o restrangere a celei cerute");
});

test("ownerul nu poate schimba actiunea la aprobare (F-08)", () => {
  const verdict = validateRestrictionIsSubset(pendingRecord(), { action: "kick" });

  assert.equal(verdict.ok, false);
  assert.match(verdict.ok === false ? verdict.problem : "", /Actiunea nu poate fi schimbata/);
});

test("aprobarea nu poate depasi cantitatea ceruta (F-08)", () => {
  const verdict = validateRestrictionIsSubset(pendingRecord({ amount: 3 }), { amount: 10 });

  assert.equal(verdict.ok, false);
  assert.match(verdict.ok === false ? verdict.problem : "", /nu poate depasi cantitatea ceruta/);
});

test("o cantitate mai mica ramane o restrangere valida (F-08)", () => {
  const verdict = validateRestrictionIsSubset(pendingRecord({ amount: 5 }), { amount: 2 });

  assert.equal(verdict.ok, true);
});

test("botul executor poate fi fixat cand cererea nu il specifica, dar nu inlocuit (F-08)", () => {
  const fixat = validateRestrictionIsSubset(
    pendingRecord({ type: "webhook", action: "create", botId: null }),
    { botId: "222222222222222222" }
  );
  const inlocuit = validateRestrictionIsSubset(
    pendingRecord({ type: "webhook", action: "create", botId: "222222222222222222" }),
    { botId: "333333333333333333" }
  );

  assert.equal(fixat.ok, true, "fixarea unui bot anume ingusteaza o cerere care accepta orice bot");
  assert.equal(inlocuit.ok, false);
  assert.match(inlocuit.ok === false ? inlocuit.problem : "", /nu poate fi schimbat/);
});

test("aprobarea nu poate adauga permisiuni necerute (F-08)", () => {
  const verdict = validateRestrictionIsSubset(
    pendingRecord({ type: "permission-grant", action: "grant", permissions: ["Manage Roles"] }),
    { permissions: ["Manage Roles", "Administrator"] }
  );

  assert.equal(verdict.ok, false);
  assert.match(verdict.ok === false ? verdict.problem : "", /Administrator/);
});

test("valabilitatea aprobata nu poate depasi durata ceruta (F-08)", () => {
  const verdict = validateRestrictionIsSubset(
    pendingRecord({ requestedTtlMs: 30 * 60 * 1000 }),
    { ttlMs: 2 * 60 * 60 * 1000 }
  );

  assert.equal(verdict.ok, false);
  assert.match(verdict.ok === false ? verdict.problem : "", /nu poate depasi durata ceruta/);
});

test("fara durata ceruta, plafonul ramane valabilitatea implicita (F-08)", () => {
  const peste = validateRestrictionIsSubset(pendingRecord({ requestedTtlMs: null }), { ttlMs: DEFAULT_APPROVED_TTL_MS + 1 });
  const sub = validateRestrictionIsSubset(pendingRecord({ requestedTtlMs: null }), { ttlMs: 15 * 60 * 1000 });

  assert.equal(peste.ok, false);
  assert.equal(sub.ok, true);
});

test("o restrictie care pastreaza scope-ul cerut trece (F-08)", () => {
  const verdict = validateRestrictionIsSubset(pendingRecord(), {
    target: "111111111111111111",
    action: "ban",
    amount: 5
  });

  assert.equal(verdict.ok, true, "aprobarea neschimbata nu trebuie respinsa de verificarea de subset");
});
