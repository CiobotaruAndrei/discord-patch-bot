import test from "node:test";
import assert from "node:assert/strict";

import { createMassModerationRuntime } from "../../features/command-security/massModerationRuntime.js";
import { breachesThreshold, distinctTargets, withinWindow } from "../../features/command-security/massModerationTypes.js";
import { createPermissionRequestRepository } from "../../features/command-security/permissionRequestRepository.js";
import { permissionRequestStore } from "./permissionRequestStore.js";
import { moduleContext } from "../moduleContextStub.js";
import type { MassModerationDeps, MassModerationGuild } from "../../features/command-security/massModerationRuntime.js";
import type { MassModerationEvent } from "../../features/command-security/massModerationTypes.js";
import type { MassModerationModelLike } from "../../features/command-security/massModerationRepository.js";

const NOW = Date.parse("2026-08-02T12:00:00.000Z");

function windowModel(): MassModerationModelLike & { docs: Map<string, Record<string, unknown>> } {
  const docs = new Map<string, Record<string, unknown>>();
  return {
    docs,
    findOne(filter: Record<string, unknown>) {
      const found = docs.get(String(filter._id)) ?? null;
      return { lean: async () => (found ? { ...found } : null) };
    },
    async updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>) {
      const id = String(filter._id);
      const existing = docs.get(id);
      if (!existing && !options?.upsert) return { matchedCount: 0, modifiedCount: 0 };
      if (!existing) {
        docs.set(id, { _id: id, ...(update.$set as Record<string, unknown>) });
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }
      if (filter.$or) {
        const clauses = filter.$or as Array<Record<string, unknown>>;
        const sanctionedAt = existing.sanctionedAt;
        const allowed = clauses.some(clause => {
          if ("sanctionedAt" in clause && clause.sanctionedAt === null) return sanctionedAt === null || sanctionedAt === undefined;
          const lte = (clause.sanctionedAt as { $lte?: Date } | undefined)?.$lte;
          return lte instanceof Date && sanctionedAt instanceof Date && sanctionedAt.getTime() <= lte.getTime();
        });
        if (!allowed) return { matchedCount: 1, modifiedCount: 0 };
      }
      Object.assign(existing, update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    }
  };
}

function harness(options: {
  guardEnabled?: boolean;
  raidConfirmed?: boolean;
  ownerId?: string | null;
  approvals?: ReturnType<typeof permissionRequestStore>;
  liftBan?: (targetId: string) => Promise<boolean>;
} = {}) {
  const removedRoles: string[] = [];
  const liftedBans: string[] = [];
  const published: string[] = [];
  const audits: Array<{ action: string; details: string }> = [];
  const model = windowModel();
  const approvals = options.approvals ?? permissionRequestStore();
  const requests = createPermissionRequestRepository(approvals);

  const deps: MassModerationDeps = {
    MassModerationModel: model,
    gate: {
      readSituation: async () => ({
        guardEnabled: options.guardEnabled ?? true,
        raidConfirmed: options.raidConfirmed ?? false
      }),
      consumeApproval: (guildId, actorId, action, amount) =>
        requests.consume(guildId, "moderation-mass", actorId, { target: actorId, action, amount }, new Date(NOW))
    },
    publish: async (_guildId, message) => { published.push(message); },
    recordAudit: async (_guildId, entry) => { audits.push({ action: entry.action, details: entry.details }); },
    now: () => NOW
  };

  const guild = moduleContext<MassModerationGuild>({
    id: "g1",
    ownerId: options.ownerId === undefined ? "owner-1" : options.ownerId,
    botHighestRolePosition: 10,
    everyoneRoleId: "everyone",
    resolveActor: async () => ({
      roles: [{ id: "role-mod", name: "Moderator", position: 5, managed: false, elevated: true }],
      removeRoles: async (ids: readonly string[]) => { removedRoles.push(...ids); }
    }),
    liftBan: async (targetId: string) => {
      if (options.liftBan) return options.liftBan(targetId);
      liftedBans.push(targetId);
      return true;
    }
  });

  return { runtime: createMassModerationRuntime(deps), guild, removedRoles, liftedBans, published, audits, model, approvals };
}

function event(targetId: string, action: "kick" | "ban", offsetMs = 0): MassModerationEvent {
  return { auditId: `a-${targetId}`, targetId, action, at: new Date(NOW + offsetMs) };
}

test("fereastra pastreaza doar evenimentele din ultimele 5 minute", () => {
  const events = [event("u1", "kick", -6 * 60_000), event("u2", "kick", -60_000), event("u3", "ban", 0)];

  const recent = withinWindow(events, new Date(NOW));

  assert.deepEqual(recent.map(entry => entry.targetId), ["u2", "u3"]);
  assert.equal(breachesThreshold(recent), false, "doua persoane distincte nu ating pragul");
  assert.equal(breachesThreshold([...recent, event("u4", "ban")]), true);
});

test("aceeasi tinta lovita de mai multe ori nu atinge pragul de persoane distincte", () => {
  const events = [event("u1", "kick"), event("u1", "ban"), event("u1", "kick")];

  assert.deepEqual(distinctTargets(events), ["u1"]);
  assert.equal(breachesThreshold(events), false);
});

test("sub prag nu se intampla nimic", async () => {
  const setup = harness();

  await setup.runtime.handleModerationAction(setup.guild, "mod-1", { auditId: "a1", targetId: "u1", action: "kick" });
  const outcome = await setup.runtime.handleModerationAction(setup.guild, "mod-1", { auditId: "a2", targetId: "u2", action: "kick" });

  assert.deepEqual(outcome, { kind: "below-threshold", distinct: 2 });
  assert.deepEqual(setup.removedRoles, []);
});

test("trei persoane distincte in 5 minute fara aprobare => sanctiune, ban-uri ridicate si incident", async () => {
  const setup = harness();

  await setup.runtime.handleModerationAction(setup.guild, "mod-1", { auditId: "a1", targetId: "u1", action: "ban" });
  await setup.runtime.handleModerationAction(setup.guild, "mod-1", { auditId: "a2", targetId: "u2", action: "ban" });
  const outcome = await setup.runtime.handleModerationAction(setup.guild, "mod-1", { auditId: "a3", targetId: "u3", action: "kick" });

  assert.equal(outcome.kind, "sanctioned");
  assert.deepEqual(setup.removedRoles, ["role-mod"]);
  assert.deepEqual(setup.liftedBans, ["u1", "u2"], "doar ban-urile se pot anula; kick-ul nu");
  assert.equal(setup.audits[0]?.action, "mass-moderation-sanctioned");
  assert.match(setup.published[0] ?? "", /3 persoane distincte/);
  assert.match(setup.published[0] ?? "", /reinvitati manual/);
});

test("acelasi eveniment din Audit Log raportat de doua ori nu umfla contorul", async () => {
  const setup = harness();

  await setup.runtime.handleModerationAction(setup.guild, "mod-1", { auditId: "a1", targetId: "u1", action: "kick" });
  await setup.runtime.handleModerationAction(setup.guild, "mod-1", { auditId: "a1", targetId: "u1", action: "kick" });
  const outcome = await setup.runtime.handleModerationAction(setup.guild, "mod-1", { auditId: "a2", targetId: "u2", action: "kick" });

  assert.deepEqual(outcome, { kind: "below-threshold", distinct: 2 });
});

test("doi moderatori diferiti au ferestre separate", async () => {
  const setup = harness();

  await setup.runtime.handleModerationAction(setup.guild, "mod-1", { auditId: "a1", targetId: "u1", action: "kick" });
  await setup.runtime.handleModerationAction(setup.guild, "mod-2", { auditId: "a2", targetId: "u2", action: "kick" });
  const outcome = await setup.runtime.handleModerationAction(setup.guild, "mod-1", { auditId: "a3", targetId: "u3", action: "kick" });

  assert.deepEqual(outcome, { kind: "below-threshold", distinct: 2 }, "actiunile altui moderator nu se aduna la contorul primului");
});

test("ownerul serverului poate modera in masa fara aprobare", async () => {
  const setup = harness();

  for (const target of ["u1", "u2", "u3"]) {
    const outcome = await setup.runtime.handleModerationAction(setup.guild, "owner-1", { auditId: `a-${target}`, targetId: target, action: "ban" });
    assert.equal(outcome.kind, "allowed-owner");
  }
  assert.deepEqual(setup.removedRoles, []);
});

test("o aprobare moderation-mass acopera actiunea si reseteaza fereastra", async () => {
  const approvals = permissionRequestStore();
  const repository = createPermissionRequestRepository(approvals);
  await repository.create({
    requestId: "req-1", guildId: "g1", type: "moderation-mass", requesterId: "mod-1",
    target: "mod-1", action: "ban", amount: 5, reason: "curatare conturi spam"
  }, new Date(NOW - 60_000));
  await repository.resolve("g1", "req-1", "approved", "owner-1", { target: "mod-1", action: "ban", amount: 5 }, new Date(NOW - 60_000));

  const setup = harness({ approvals });
  await setup.runtime.handleModerationAction(setup.guild, "mod-1", { auditId: "a1", targetId: "u1", action: "ban" });
  await setup.runtime.handleModerationAction(setup.guild, "mod-1", { auditId: "a2", targetId: "u2", action: "ban" });
  const outcome = await setup.runtime.handleModerationAction(setup.guild, "mod-1", { auditId: "a3", targetId: "u3", action: "ban" });

  assert.equal(outcome.kind, "allowed-approval");
  assert.deepEqual(setup.removedRoles, []);
  assert.deepEqual(setup.liftedBans, []);
  assert.equal(approvals.records[0].status, "used");
});

test("o aprobare pentru mai putine persoane decat au fost lovite nu acopera actiunea", async () => {
  const approvals = permissionRequestStore();
  const repository = createPermissionRequestRepository(approvals);
  await repository.create({
    requestId: "req-1", guildId: "g1", type: "moderation-mass", requesterId: "mod-1",
    target: "mod-1", action: "ban", amount: 2, reason: "doua conturi"
  }, new Date(NOW - 60_000));
  await repository.resolve("g1", "req-1", "approved", "owner-1", { target: "mod-1", action: "ban", amount: 2 }, new Date(NOW - 60_000));

  const setup = harness({ approvals });
  for (const target of ["u1", "u2", "u3"]) {
    await setup.runtime.handleModerationAction(setup.guild, "mod-1", { auditId: `a-${target}`, targetId: target, action: "ban" });
  }

  assert.deepEqual(setup.removedRoles, ["role-mod"], "aprobarea pentru 2 nu acopera 3 persoane");
});

test("cu moderation-guard oprit, moderarea in masa nu produce sanctiune", async () => {
  const setup = harness({ guardEnabled: false });

  for (const target of ["u1", "u2", "u3"]) {
    const outcome = await setup.runtime.handleModerationAction(setup.guild, "mod-1", { auditId: `a-${target}`, targetId: target, action: "ban" });
    assert.equal(outcome.kind, "guard-disabled");
  }
  assert.deepEqual(setup.removedRoles, []);
});

test("in timpul unui raid confirmat, moderarea in masa e treaba anti-raid", async () => {
  const setup = harness({ raidConfirmed: true });

  const outcome = await setup.runtime.handleModerationAction(setup.guild, "mod-1", { auditId: "a1", targetId: "u1", action: "ban" });

  assert.equal(outcome.kind, "raid-active");
});

test("acelasi autor nu este sanctionat de doua ori pentru aceeasi fereastra", async () => {
  const setup = harness();

  for (const target of ["u1", "u2", "u3"]) {
    await setup.runtime.handleModerationAction(setup.guild, "mod-1", { auditId: `a-${target}`, targetId: target, action: "ban" });
  }
  const again = await setup.runtime.handleModerationAction(setup.guild, "mod-1", { auditId: "a-u4", targetId: "u4", action: "ban" });

  assert.equal(again.kind, "already-sanctioned");
  assert.deepEqual(setup.removedRoles, ["role-mod"], "rolurile se elimina o singura data");
  assert.equal(setup.published.length, 1, "un singur incident per fereastra");
});

test("un ban care nu poate fi ridicat este raportat explicit", async () => {
  const setup = harness({ liftBan: async targetId => targetId !== "u2" });

  for (const target of ["u1", "u2", "u3"]) {
    await setup.runtime.handleModerationAction(setup.guild, "mod-1", { auditId: `a-${target}`, targetId: target, action: "ban" });
  }

  assert.match(setup.published[0] ?? "", /2 ban-uri ridicate, 1 NU au putut fi ridicate/);
});
