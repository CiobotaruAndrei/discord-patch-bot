import test from "node:test";
import assert from "node:assert/strict";

import {
  adaptPreventionPort,
  applyChannelPrevention,
  describePrevention,
  memberOverwriteTargets,
  planChannelPrevention,
  preventionGaps,
  preventionHolds,
  restoreChannelPrevention
} from "../../features/command-security/protectedResourcePrevention.js";

import type { PreventableChannel, PreventionTarget } from "../../features/command-security/protectedResourcePrevention.js";

function target(id: string, name: string, administrator = false, kind: "role" | "member" = "role"): PreventionTarget {
  return { id, name, kind, administrator };
}

interface Overwrite {
  id: string;
  type: number;
  denied: Set<string>;
  allowed?: Set<string>;
}

function channel(overwrites: Overwrite[], options: { editable?: boolean; editFails?: string[] } = {}): PreventableChannel {
  const edit = options.editable === false
    ? undefined
    : async (targetId: string, permissions: Record<string, boolean | null>) => {
      if (options.editFails?.includes(targetId)) throw new Error("Discord a refuzat");
      const existing = overwrites.find(entry => entry.id === targetId)
        ?? (overwrites.push({ id: targetId, type: 0, denied: new Set() }), overwrites[overwrites.length - 1]);
      for (const [name, value] of Object.entries(permissions)) {
        existing.allowed ??= new Set();
        if (value === false) { existing.denied.add(name); existing.allowed.delete(name); }
        else if (value === true) { existing.allowed.add(name); existing.denied.delete(name); }
        else { existing.denied.delete(name); existing.allowed.delete(name); }
      }
      return undefined;
    };

  return {
    permissionOverwrites: {
      cache: {
        values: () => overwrites.map(entry => ({
          id: entry.id,
          type: entry.type,
          allow: { has: (flag: string) => entry.allowed?.has(flag) === true },
          deny: { has: (flag: string) => entry.denied.has(flag) }
        }))
      },
      edit
    }
  };
}

test("prevenirea chiar scrie overwrite-ul, nu doar declara ca e posibila (F-19)", async () => {
  const overwrites: Overwrite[] = [];
  const outcome = await applyChannelPrevention(
    planChannelPrevention([target("r-mod", "Moderatori")]),
    adaptPreventionPort(channel(overwrites))!
  );

  assert.deepEqual(outcome.applied.map(entry => entry.id), ["r-mod"]);
  assert.equal(preventionHolds(outcome), true);
  assert.deepEqual([...(overwrites[0]?.denied ?? [])], ["ManageChannels"]);
});

test("rolurile cu Administrator sunt raportate ca imposibil de prevenit, nu ignorate (F-19)", async () => {
  const plan = planChannelPrevention([target("r-admin", "Admin", true), target("r-mod", "Moderatori")]);

  assert.deepEqual(plan.blocked.map(entry => entry.id), ["r-admin"]);
  assert.deepEqual(plan.deny.map(entry => entry.id), ["r-mod"]);

  const outcome = await applyChannelPrevention(plan, adaptPreventionPort(channel([]))!);

  assert.equal(preventionHolds(outcome), false, "cat timp un Administrator poate administra canalul, prevenirea nu e completa");
  assert.match(describePrevention(outcome), /au Administrator si ignora overwrite-urile/);
});

test("daca scrierea esueaza, verificarea de dupa o prinde si nu raporteaza prevenire (F-19)", async () => {
  const overwrites: Overwrite[] = [];
  const outcome = await applyChannelPrevention(
    planChannelPrevention([target("r-mod", "Moderatori"), target("r-helper", "Ajutoare")]),
    adaptPreventionPort(channel(overwrites, { editFails: ["r-mod"] }))!
  );

  assert.deepEqual(outcome.applied.map(entry => entry.id), ["r-helper"]);
  assert.deepEqual(outcome.failed.map(entry => entry.id), ["r-mod"]);
  assert.equal(preventionHolds(outcome), false);
  assert.match(describePrevention(outcome), /nu s-a aplicat pentru Moderatori/);
});

test("cand recitirea de verificare esueaza, rezultatul nu se declara aplicat (F-19)", async () => {
  const outcome = await applyChannelPrevention(planChannelPrevention([target("r-mod", "Moderatori")]), {
    readAccess: async () => "inherit",
    setManageChannels: async () => undefined,
    readDeniedTargets: async () => null
  });

  assert.equal(outcome.verified, false);
  assert.deepEqual(outcome.applied, []);
  assert.match(describePrevention(outcome), /nu a putut fi verificata/);
});

test("un canal fara editarea overwrite-urilor nu produce un port de prevenire (F-19)", () => {
  assert.equal(adaptPreventionPort(channel([], { editable: false })), null);
});

test("membrii cu overwrite pe canal sunt vazuti, nu tratati ca lista goala (F-19)", () => {
  const targets = memberOverwriteTargets(channel([
    { id: "r-1", type: 0, denied: new Set(), allowed: new Set(["ManageChannels"]) },
    { id: "u-1", type: 1, denied: new Set(), allowed: new Set(["ManageChannels"]) },
    { id: "u-2", type: 1, denied: new Set(), allowed: new Set(["SendMessages"]) }
  ]));

  assert.deepEqual(targets, ["u-1"],
    "managerMembers era mereu []; acum se iau doar membrii carora overwrite-ul le acorda chiar Manage Channels");
});

test("scoaterea protectiei restaureaza exact starea anterioara a fiecarei tinte (review PR #952)", async () => {
  const overwrites: Overwrite[] = [
    { id: "r-allow", type: 0, denied: new Set(), allowed: new Set(["ManageChannels"]) },
    { id: "r-inherit", type: 0, denied: new Set(), allowed: new Set() }
  ];
  const port = adaptPreventionPort(channel(overwrites))!;

  const outcome = await applyChannelPrevention(
    planChannelPrevention([target("r-allow", "Cu acces"), target("r-inherit", "Mostenit")]),
    port
  );
  assert.deepEqual(
    outcome.restorePoints.map(point => `${point.id}:${point.previous}`).sort(),
    ["r-allow:allow", "r-inherit:inherit"]
  );

  const restored = await restoreChannelPrevention(port, outcome.restorePoints);

  assert.equal(restored, 2);
  assert.equal(overwrites.find(entry => entry.id === "r-allow")?.allowed?.has("ManageChannels"), true,
    "un rol care avea acces explicit il primeste inapoi");
  assert.equal(overwrites.find(entry => entry.id === "r-inherit")?.denied.has("ManageChannels"), false,
    "un rol care mostenea revine la mostenire, nu ramane blocat");
});

test("o prevenire care nu s-a aplicat produce motive de degradare, nu tacere (review PR #952)", async () => {
  const outcome = await applyChannelPrevention(
    planChannelPrevention([target("r-admin", "Admin", true), target("r-mod", "Moderatori")]),
    adaptPreventionPort(channel([], { editFails: ["r-mod"] }))!
  );

  const gaps = preventionGaps(outcome);

  assert.equal(gaps.length, 2, "si esecul, si Administratorul trebuie sa apara ca motive");
  assert.ok(gaps.some(reason => reason.includes("Moderatori")));
  assert.ok(gaps.some(reason => reason.includes("Administrator")));
});
