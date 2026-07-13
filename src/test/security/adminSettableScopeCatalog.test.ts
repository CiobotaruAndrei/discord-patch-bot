import test from "node:test";
import assert from "node:assert/strict";

import { listSettableAdminScopePaths, buildSettableAdminScopeChoices, isSettableAdminScope } from "../../features/command-security/adminSettableScopeCatalog.js";

const ROUTER_ENFORCED = ["/start updates", "/backup load", "/add price-alert", "/config"];
const NON_ROUTER_RUNTIME = ["/suggest-command list", "/suggest-command delete", "/report list", "/report resolve", "/watchlist-game delete"];
const OWNER_ONLY = ["/set admin-command-access", "/admin-command-access list", "/delete admin-command-access"];
const PUBLIC_COMMANDS = ["/ping", "/games", "/help", "/player-count game", "/top active games", "/add suggestion"];

test("settable admin scope catalog: include comenzile enforce-uite de router-ul configurabil", () => {
  const paths = listSettableAdminScopePaths();
  for (const command of ROUTER_ENFORCED) {
    assert.ok(paths.includes(command), `${command} trece prin router-ul admin configurabil, deci trebuie sa fie settable`);
  }
});

test("settable admin scope catalog: exclude comenzile 'Admin runtime' care NU trec prin router-ul configurabil (R[P1] #1)", () => {
  const paths = listSettableAdminScopePaths();
  for (const command of NON_ROUTER_RUNTIME) {
    assert.equal(paths.includes(command), false, `${command} foloseste guard-ul clasic, nu regula configurabila; a-l face settable e inselator`);
    assert.equal(isSettableAdminScope(command), false, `${command} nu e un scope settable`);
  }
});

test("settable admin scope catalog: exclude comenzile owner-only (rolurile nu le pot autoriza) (R[P2] #2)", () => {
  const paths = listSettableAdminScopePaths();
  for (const command of OWNER_ONLY) {
    assert.equal(paths.includes(command), false, `${command} e owner-only; o regula de rol nu s-ar aplica`);
    assert.equal(isSettableAdminScope(command), false, `${command} nu e un scope settable (owner-only)`);
  }
});

test("settable admin scope catalog: exclude comenzile publice", () => {
  const paths = listSettableAdminScopePaths();
  for (const command of PUBLIC_COMMANDS) {
    assert.equal(paths.includes(command), false, `${command} e publica, nu un scope admin`);
  }
});

test("isSettableAdminScope: accepta global si o comanda admin reala, respinge publicele/owner-only/non-router", () => {
  assert.equal(isSettableAdminScope("global"), true);
  assert.equal(isSettableAdminScope(""), true, "gol => fallback global");
  assert.equal(isSettableAdminScope("/start updates"), true);
  assert.equal(isSettableAdminScope("/backup load"), true);
  assert.equal(isSettableAdminScope("/ping"), false);
  assert.equal(isSettableAdminScope("/suggest-command list"), false);
  assert.equal(isSettableAdminScope("/set admin-command-access"), false);
});

test("buildSettableAdminScopeChoices: global primul, exclude non-settable, filtreaza pe input", () => {
  const all = buildSettableAdminScopeChoices("");
  assert.equal(all[0]?.value, "global", "prima optiune e regula globala");
  const values = all.map(choice => choice.value);
  for (const command of [...NON_ROUTER_RUNTIME, ...OWNER_ONLY, ...PUBLIC_COMMANDS]) {
    assert.equal(values.includes(command), false, `autocomplete-ul nu sugereaza ${command}`);
  }
  const startChoices = buildSettableAdminScopeChoices("start updates").map(choice => choice.value);
  assert.ok(startChoices.includes("/start updates"), "autocomplete-ul sugereaza comanda admin reala cautata");
  const filtered = buildSettableAdminScopeChoices("backup");
  assert.ok(filtered.length > 0, "filtrarea dupa input intoarce potriviri");
  assert.ok(filtered.every(choice => choice.value === "global" || choice.value.toLowerCase().includes("backup")), "toate potrivirile pentru `backup` sunt scope-uri de backup (sau global)");
});
