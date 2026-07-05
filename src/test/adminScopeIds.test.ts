import test from "node:test";
import assert from "node:assert/strict";

import {
  ADMIN_SCOPE_IDS,
  GLOBAL_ADMIN_SCOPE_ID,
  isAdminScopeId,
  parseAdminScopeId
} from "../features/command-security/adminScopeIds";
import { canonicalAdminCommandAccessScope } from "../features/command-security/adminCommandAccessScope";

test("ADMIN_SCOPE_IDS: generat din catalogul de comenzi, doar forme canonice, fara duplicate (R7 #2)", () => {
  assert.ok(ADMIN_SCOPE_IDS.includes(GLOBAL_ADMIN_SCOPE_ID), "scope-ul global exista");
  assert.ok(ADMIN_SCOPE_IDS.length > 1, "catalogul contribuie scope-uri de comenzi admin reale");
  assert.equal(new Set(ADMIN_SCOPE_IDS).size, ADMIN_SCOPE_IDS.length, "fara duplicate");
  for (const id of ADMIN_SCOPE_IDS) {
    assert.equal(id, canonicalAdminCommandAccessScope(id), `${id} este forma canonica (idempotent la canonicalizare)`);
    assert.ok(!id.startsWith("start:") && !id.startsWith("stop:"), `${id} nu este cheie legacy start:/stop: (canonicul e start-stop:)`);
  }
});

test("ADMIN_SCOPE_IDS: contine scope-urile comenzilor admin configurabile si le exclude pe cele owner-only/publice", () => {
  const ids = new Set<string>(ADMIN_SCOPE_IDS);
  assert.ok(ids.has("start-stop:updates"), "/start updates e configurabil, sub cheia canonica start-stop");
  assert.ok(ids.has("backup:load"), "/backup load e configurabil");
  assert.ok(!ids.has("ping"), "/ping e publica, nu e scope admin");
  assert.ok(!ids.has("set:admin-command-access"), "/set admin-command-access e owner-only, o regula de rol nu s-ar aplica");
});

test("parseAdminScopeId: canonicalizeaza input-ul si intoarce null pentru scope inexistent", () => {
  assert.equal(parseAdminScopeId(""), GLOBAL_ADMIN_SCOPE_ID, "gol => global");
  assert.equal(parseAdminScopeId(null), GLOBAL_ADMIN_SCOPE_ID, "null => global (nu stringul 'null')");
  assert.equal(parseAdminScopeId(undefined), GLOBAL_ADMIN_SCOPE_ID, "undefined => global");
  assert.equal(parseAdminScopeId("/start updates"), "start-stop:updates", "calea de comanda se canonicalizeaza");
  assert.equal(parseAdminScopeId("stop:updates"), "start-stop:updates", "cheia legacy cu doua puncte se canonicalizeaza, nu se respinge");
  assert.equal(parseAdminScopeId("/ping"), null, "comanda publica nu e scope admin");
  assert.equal(parseAdminScopeId("/set admin-command-access"), null, "owner-only nu e settable");
  assert.equal(parseAdminScopeId("nu-exista-asa-ceva"), null, "scope inventat e respins");
});

test("isAdminScopeId: type guard strict pe forma canonica, fara normalizare implicita", () => {
  assert.equal(isAdminScopeId("global"), true);
  assert.equal(isAdminScopeId("start-stop:updates"), true);
  assert.equal(isAdminScopeId("start:updates"), false, "cheia legacy nu e ID canonic; parseAdminScopeId o canonicalizeaza explicit");
  assert.equal(isAdminScopeId("ping"), false);
});
