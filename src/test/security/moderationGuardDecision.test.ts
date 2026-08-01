import test from "node:test";
import assert from "node:assert/strict";

import {
  MODERATION_GUARD_TYPES,
  evaluateGuardedAction,
  requiresCorrection,
  requiresOwnerIntervention,
  shouldEvaluate
} from "../../features/command-security/moderationGuardDecision.js";
import { PERMISSION_REQUEST_TYPES, normalizePermissionName, scopeMatchesApproval } from "../../features/command-security/permissionRequestTypes.js";

const ATTEMPT = { target: "rol-1", action: "grant", permissions: ["BanMembers"] };

function approvals(result: { _id: string } | null) {
  const calls: unknown[] = [];
  return {
    calls,
    consume: async (...args: unknown[]) => { calls.push(args); return result; }
  };
}

test("moderation-guard acopera exact cele sase tipuri din specificatie", () => {
  assert.deepEqual([...MODERATION_GUARD_TYPES].sort(), [...PERMISSION_REQUEST_TYPES].sort());
});

test("cu guard-ul oprit nu se evalueaza nimic si nu se cere nicio aprobare", async () => {
  const lookup = approvals(null);
  const verdict = await evaluateGuardedAction(
    { guardEnabled: false, raidConfirmed: false, ownerId: "owner", actorId: "u1" },
    "permission-grant", ATTEMPT, lookup
  );
  assert.equal(verdict.kind, "guard-off");
  assert.equal(requiresCorrection(verdict), false, "fara guard nu exista sanctiune: comportamentul permanent de dinainte a fost inlocuit de poarta");
  assert.equal(lookup.calls.length, 0, "nu se atinge magazinul de aprobari degeaba");
});

test("in timpul unui raid confirmat, moderation-guard isi suspenda sanctiunile", async () => {
  const lookup = approvals(null);
  const verdict = await evaluateGuardedAction(
    { guardEnabled: true, raidConfirmed: true, ownerId: "owner", actorId: "u1" },
    "permission-grant", ATTEMPT, lookup
  );
  assert.equal(verdict.kind, "raid-active");
  assert.equal(requiresCorrection(verdict), false, "anti-raid are prioritate absoluta; fara actiune duplicata");
  assert.equal(lookup.calls.length, 0);
});

test("ownerul executa direct, fara sa consume vreo aprobare", async () => {
  const lookup = approvals({ _id: "r1" });
  const verdict = await evaluateGuardedAction(
    { guardEnabled: true, raidConfirmed: false, ownerId: "owner", actorId: "owner" },
    "webhook", { target: "c", action: "create" }, lookup
  );
  assert.equal(verdict.kind, "allowed-owner");
  assert.equal(lookup.calls.length, 0, "actiunea ownerului nu are voie sa consume aprobarea altcuiva");
});

test("o aprobare exacta permite operatiunea si e consumata", async () => {
  const lookup = approvals({ _id: "r7" });
  const verdict = await evaluateGuardedAction(
    { guardEnabled: true, raidConfirmed: false, ownerId: "owner", actorId: "u1" },
    "permission-grant", ATTEMPT, lookup
  );
  assert.deepEqual(verdict, { kind: "allowed-approval", requestId: "r7" });
  assert.equal(lookup.calls.length, 1);
});

test("fara aprobare, actiunea e neautorizata si cere corectie", async () => {
  const verdict = await evaluateGuardedAction(
    { guardEnabled: true, raidConfirmed: false, ownerId: "owner", actorId: "u1" },
    "permission-grant", ATTEMPT, approvals(null)
  );
  assert.equal(verdict.kind, "unauthorized");
  assert.equal(requiresCorrection(verdict), true);
});

test("autorul neconfirmat NU produce sanctiune, ci cere interventia ownerului", async () => {
  const lookup = approvals({ _id: "r1" });
  const verdict = await evaluateGuardedAction(
    { guardEnabled: true, raidConfirmed: false, ownerId: "owner", actorId: null },
    "server-structure", { target: "canal", action: "delete" }, lookup
  );
  assert.equal(verdict.kind, "actor-unknown");
  assert.equal(requiresCorrection(verdict), false, "specificatia interzice sanctionarea unei persoane alese la intamplare");
  assert.equal(requiresOwnerIntervention(verdict), true);
  assert.equal(lookup.calls.length, 0);
});

test("shouldEvaluate separa exact cele doua conditii de pornire", () => {
  assert.equal(shouldEvaluate({ guardEnabled: true, raidConfirmed: false, ownerId: "o", actorId: "u" }), true);
  assert.equal(shouldEvaluate({ guardEnabled: false, raidConfirmed: false, ownerId: "o", actorId: "u" }), false);
  assert.equal(shouldEvaluate({ guardEnabled: true, raidConfirmed: true, ownerId: "o", actorId: "u" }), false);
});

test("aprobarea acopera permisiunea indiferent de forma in care e scrisa", () => {
  const record = {
    _id: "r", guildId: "g1", type: "permission-grant" as const, requesterId: "u1", reason: "",
    status: "approved" as const, requestedAt: new Date(), target: "role-1", action: "grant",
    approvedPermissions: ["BanMembers"]
  };

  assert.equal(scopeMatchesApproval(record, { target: "role-1", action: "grant", permissions: ["Ban Members"] }), true,
    "eticheta interna 'Ban Members' si numele Discord 'BanMembers' sunt aceeasi permisiune");
  assert.equal(scopeMatchesApproval(record, { target: "role-1", action: "grant", permissions: ["ban_members"] }), true);
  assert.equal(scopeMatchesApproval(record, { target: "role-1", action: "grant", permissions: ["Administrator"] }), false,
    "normalizarea nu are voie sa faca doua permisiuni diferite sa se confunde");
  assert.equal(normalizePermissionName("Manage Webhooks"), normalizePermissionName("ManageWebhooks"));
});
