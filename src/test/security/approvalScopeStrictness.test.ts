import test from "node:test";
import assert from "node:assert/strict";

import { scopeMatchesApproval } from "../../features/command-security/permissionRequestTypes.js";
import { moduleContext } from "../moduleContextStub.js";
import type { PermissionRequestRecord, PermissionRequestScope } from "../../features/command-security/permissionRequestTypes.js";

function approval(overrides: Partial<PermissionRequestRecord> = {}): PermissionRequestRecord {
  return moduleContext<PermissionRequestRecord>({
    _id: "req-1",
    guildId: "g1",
    type: "permission-grant",
    requesterId: "mod-1",
    target: "role-1",
    action: "grant",
    status: "approved",
    reason: "escaladare",
    ...overrides
  });
}

function attempt(overrides: Partial<PermissionRequestScope> = {}): PermissionRequestScope {
  return moduleContext<PermissionRequestScope>({ target: "role-1", action: "grant", ...overrides });
}

test("o aprobare fara permisiuni NU acopera o incercare cu permisiuni (F-06)", () => {
  const record = approval({ permissions: undefined, approvedPermissions: undefined });

  assert.equal(
    scopeMatchesApproval(record, attempt({ permissions: ["Administrator"] })),
    false,
    "lista goala inseamna nimic permis, nu fara limita"
  );
});

test("o aprobare cu lista goala explicita se comporta la fel (F-06)", () => {
  const record = approval({ approvedPermissions: [] });

  assert.equal(scopeMatchesApproval(record, attempt({ permissions: ["Ban Members"] })), false);
});

test("o aprobare cu permisiuni exacte acopera doar acele permisiuni (F-06)", () => {
  const record = approval({ approvedPermissions: ["Ban Members"] });

  assert.equal(scopeMatchesApproval(record, attempt({ permissions: ["Ban Members"] })), true);
  assert.equal(scopeMatchesApproval(record, attempt({ permissions: ["Administrator"] })), false);
  assert.equal(
    scopeMatchesApproval(record, attempt({ permissions: ["Ban Members", "Administrator"] })),
    false,
    "o permisiune in plus fata de aprobare invalideaza tot"
  );
});

test("o incercare fara permisiuni ramane acoperita de o aprobare cu permisiuni (F-06)", () => {
  const record = approval({ approvedPermissions: ["Ban Members"] });

  assert.equal(scopeMatchesApproval(record, attempt()), true, "restul tipurilor nu trimit permisiuni deloc");
});

test("o aprobare fara cantitate NU acopera o operatiune cantitativa (F-07)", () => {
  const record = approval({ type: "moderation-mass", action: "ban", amount: undefined, approvedAmount: undefined });

  assert.equal(
    scopeMatchesApproval(record, attempt({ action: "ban", amount: 7 })),
    false,
    "fara cantitate aprobata, o cerere putea acoperi un numar arbitrar de banuri"
  );
});

test("o aprobare cu cantitate acopera pana la limita, nu peste (F-07)", () => {
  const record = approval({ type: "moderation-mass", action: "ban", approvedAmount: 3 });

  assert.equal(scopeMatchesApproval(record, attempt({ action: "ban", amount: 3 })), true);
  assert.equal(scopeMatchesApproval(record, attempt({ action: "ban", amount: 4 })), false);
});

test("cantitatea aprobata de owner o restrange pe cea ceruta, nu invers (F-07)", () => {
  const record = approval({ type: "moderation-mass", action: "ban", amount: 10, approvedAmount: 2 });

  assert.equal(scopeMatchesApproval(record, attempt({ action: "ban", amount: 5 })), false);
  assert.equal(scopeMatchesApproval(record, attempt({ action: "ban", amount: 2 })), true);
});

test("tinta si actiunea raman conditii dure", () => {
  const record = approval({ approvedPermissions: ["Ban Members"] });

  assert.equal(scopeMatchesApproval(record, attempt({ target: "role-2", permissions: ["Ban Members"] })), false);
  assert.equal(scopeMatchesApproval(record, attempt({ action: "revoke", permissions: ["Ban Members"] })), false);
});
