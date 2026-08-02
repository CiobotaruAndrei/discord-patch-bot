import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";

import { ELEVATED_PERMISSIONS, elevatedOn } from "../../features/command-security/elevatedPermissions.js";
import { CHANNEL_PROTECTED_PERMISSIONS, PROTECTED_PERMISSIONS } from "../../features/command-security/permissionDelegationContext.js";
import { describeSanctionOutcome, executeElevatedRoleSanction } from "../../features/command-security/elevatedRoleSanction.js";
import { MODERATION_GUARD_ENFORCERS } from "../../features/command-security/moderationGuardEnforcers.js";
import { resolveSanctionActor } from "../../app/runtime/sanctionActorAdapter.js";

import type { SanctionActorLike, SanctionRole } from "../../features/command-security/elevatedRoleSanction.js";

function role(id: string, name: string, position: number, elevated: boolean, managed = false): SanctionRole {
  return { id, name, position, managed, elevated };
}

function actor(roles: readonly SanctionRole[], onRemove: (ids: readonly string[]) => void): SanctionActorLike {
  return { roles, removeRoles: async ids => { onRemove(ids); } };
}

test("Manage Guild, Manage Roles si Manage Channels sunt permisiuni ridicate protejate (F-17)", () => {
  const labels = PROTECTED_PERMISSIONS.map(entry => entry.label);

  for (const required of ["Manage Guild", "Manage Roles", "Manage Channels", "Administrator", "Ban Members", "Kick Members", "Moderate Members", "Manage Webhooks"]) {
    assert.ok(labels.includes(required), `${required} trebuie sa treaca prin permission-grant`);
  }
});

test("suprafata de overwrite acopera doar permisiunile pe care Discord le poate acorda acolo (F-17)", () => {
  const options = CHANNEL_PROTECTED_PERMISSIONS.map(entry => entry.option).sort();

  assert.deepEqual(options, ["ManageChannels", "ManageRoles", "ManageWebhooks"]);
  assert.ok(!options.includes("Administrator"), "Administrator nu exista ca overwrite de canal");
});

test("sursa unica de permisiuni ridicate nu se dubleaza si pastreaza flag-ul real (F-17)", () => {
  const names = ELEVATED_PERMISSIONS.map(entry => entry.name);

  assert.equal(new Set(names).size, names.length);
  assert.equal(ELEVATED_PERMISSIONS.find(entry => entry.name === "ManageGuild")?.flag, PermissionFlagsBits.ManageGuild);
  assert.ok(elevatedOn("overwrite").length < elevatedOn("role").length, "overwrite-ul e un subset al suprafetei de rol");
});

test("sanctiunea raporteaza rolurile ramase dupa re-citire, nu ce a planificat (F-22)", async () => {
  const roles = [role("r1", "Moderator", 10, true), role("r2", "Ajutor", 5, true)];
  let call = 0;

  const outcome = await executeElevatedRoleSanction({
    resolveActor: async () => {
      call += 1;
      return call === 1 ? actor(roles, () => undefined) : actor([roles[1]], () => undefined);
    },
    botHighestRolePosition: 50,
    everyoneRoleId: "everyone",
    reason: "test"
  });

  assert.deepEqual(outcome.removed.map(entry => entry.id), ["r1"]);
  assert.deepEqual(outcome.failed.map(entry => entry.id), ["r2"], "rolul pe care autorul il are inca NU poate fi raportat ca eliminat");
  assert.equal(outcome.ownerInterventionRequired, true);
  assert.match(describeSanctionOutcome(outcome), /are inca dupa incercarea de eliminare/);
});

test("cand eliminarea reuseste complet, raportul nu cere interventia ownerului (F-22)", async () => {
  const roles = [role("r1", "Moderator", 10, true)];
  const removed: string[] = [];
  let call = 0;

  const outcome = await executeElevatedRoleSanction({
    resolveActor: async () => {
      call += 1;
      return call === 1 ? actor(roles, ids => removed.push(...ids)) : actor([], () => undefined);
    },
    botHighestRolePosition: 50,
    everyoneRoleId: "everyone",
    reason: "test"
  });

  assert.deepEqual(removed, ["r1"]);
  assert.equal(outcome.ownerInterventionRequired, false);
  assert.match(describeSanctionOutcome(outcome), /eliminate si verificate/);
});

test("daca re-citirea esueaza, rezultatul e neverificat si cere interventia ownerului (F-22)", async () => {
  let call = 0;

  const outcome = await executeElevatedRoleSanction({
    resolveActor: async () => {
      call += 1;
      if (call === 1) return actor([role("r1", "Moderator", 10, true)], () => undefined);
      throw new Error("Discord indisponibil");
    },
    botHighestRolePosition: 50,
    everyoneRoleId: "everyone",
    reason: "test"
  });

  assert.equal(outcome.verified, false);
  assert.equal(outcome.ownerInterventionRequired, true);
  assert.match(describeSanctionOutcome(outcome), /nu a putut fi verificata/);
});

test("autorul neconfirmat nu produce un raport care sugereaza ca s-a actionat (F-22)", async () => {
  const outcome = await executeElevatedRoleSanction({
    resolveActor: async () => null,
    botHighestRolePosition: 50,
    everyoneRoleId: "everyone",
    reason: "test"
  });

  assert.equal(outcome.actorKnown, false);
  assert.equal(outcome.ownerInterventionRequired, true);
  assert.match(describeSanctionOutcome(outcome), /nu a putut fi confirmat/);
});

test("permission-grant sanctioneaza autorul, ca celelalte subprotectii (F-16)", () => {
  const grant = MODERATION_GUARD_ENFORCERS.find(enforcer => enforcer.type === "permission-grant");

  assert.equal(grant?.sanctionsAuthor, true, "autorul compromis isi pastra capacitatea de a repeta acordarea");
});

test("verificarea sanctiunii citeste membrul proaspat, nu din cache (review PR #948)", async () => {
  const fetches: Array<{ user: string; force: boolean }> = [];

  await resolveSanctionActor({
    members: {
      fetch: async options => {
        fetches.push(options);
        return { roles: { cache: { values: () => [] }, remove: async () => undefined } };
      }
    }
  }, "actor-1");

  assert.deepEqual(fetches, [{ user: "actor-1", force: true }],
    "fara force, a doua citire poate intoarce acelasi membru din cache si o sanctiune reusita ar aparea ca esuata");
});

test("calea de overwrite de canal sanctioneaza autorul, ca si cea de rol (review PR #948)", () => {
  const grant = MODERATION_GUARD_ENFORCERS.find(enforcer => enforcer.type === "permission-grant");

  assert.deepEqual(
    [...(grant?.modules ?? [])].sort(),
    ["channelDelegationRuntime", "roleDelegationRuntime"],
    "un atacator care acorda permisiuni prin overwrite nu are voie sa scape de sanctiune"
  );
});
