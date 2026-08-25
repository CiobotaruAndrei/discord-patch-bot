import test from "node:test";
import assert from "node:assert/strict";

import { createBotAddSecurityRuntime } from "../../features/command-security/botAddSecurityRuntime.js";
import { createPermissionRequestRepository } from "../../features/command-security/permissionRequestRepository.js";
import { permissionRequestStore, type PermissionRequestStore } from "./permissionRequestStore.js";
import { m19_dropLegacyBotAddFields } from "../../infra/mongo/migrations/m19_dropLegacyBotAddFields.js";
import { moduleContext } from "../moduleContextStub.js";
import type { SecurityRuntimeDeps } from "../../features/command-security/securityEventContext.js";
import type { GuildSettings } from "../../features/guild-config/guildSettingsTypes.js";

const NOW = Date.parse("2026-08-02T09:00:00.000Z");
const BOT_ID = "bot-9";
const REQUESTER = "mod-1";

interface ScenarioOptions {
  model?: PermissionRequestStore;
  isRaidConfirmed?: () => Promise<boolean>;
  settings?: Partial<GuildSettings>;
  actorRoles?: readonly { id: string; name: string; position: number; managed: boolean; elevated: boolean }[];
  withoutSanctionContext?: boolean;
  kickFails?: boolean;
  keepsRolesAfterRemoval?: boolean;
}

function scenario(options: ScenarioOptions = {}) {
  const model = options.model ?? permissionRequestStore();
  const kicks: string[] = [];
  const sent: string[] = [];
  const removedRoles: string[] = [];
  let actorRoles = [...(options.actorRoles ?? [{ id: "role-mod", name: "Moderator", position: 5, managed: false, elevated: true }])];
  const settings = moduleContext<GuildSettings>({
    moderationGuardEnabled: true,
    permissionRequestChannelId: "chan-1",
    ...options.settings
  });
  const guild = {
    id: "g1",
    ownerId: "owner-1",
    fetchAuditLogs: async () => ({
      entries: new Map([["e1", { id: "a1", executor: { id: REQUESTER }, target: { id: BOT_ID }, createdTimestamp: NOW }]])
    })
  };
  const deps = moduleContext<SecurityRuntimeDeps>({
    PermissionRequestModel: model,
    isRaidConfirmed: options.isRaidConfirmed,
    getGuildSettings: async () => settings,
    client: { channels: { fetch: async () => ({ send: async (payload: unknown) => { sent.push(JSON.stringify(payload)); return undefined; } }) } },
    GuildModel: { updateOne: async () => ({ modifiedCount: 1 }), findOne: () => ({ lean: async () => null }) },
    GuildAuditLogModel: {
      create: async (record: unknown) => record,
      find: () => ({ sort() { return this; }, skip() { return this; }, limit() { return this; }, lean: async () => [] })
    },
    adminAlert: async () => undefined,
    sanctionContext: options.withoutSanctionContext ? undefined : async () => ({
      botHighestRolePosition: 10,
      everyoneRoleId: "everyone",
      resolveActor: async () => ({
        roles: actorRoles,
        removeRoles: async (ids: readonly string[]) => {
          removedRoles.push(...ids);
          if (!options.keepsRolesAfterRemoval) actorRoles = actorRoles.filter(role => !ids.includes(role.id));
        }
      })
    }),
    now: () => NOW,
    wait: async () => undefined
  });
  const runtime = createBotAddSecurityRuntime(deps);
  const member = moduleContext<Parameters<typeof runtime.handleGuildMemberAdd>[0]>({
    id: BOT_ID,
    guild,
    joinedTimestamp: NOW,
    user: { id: BOT_ID, bot: true, tag: "Bot#0001", createdTimestamp: NOW - 90 * 86_400_000 },
    kick: async (reason: string) => {
      if (options.kickFails) throw new Error("ierarhie insuficienta");
      kicks.push(reason);
      return undefined;
    }
  });
  return { runtime, member, kicks, sent, model, removedRoles };
}

async function approvedRequest(): Promise<PermissionRequestStore> {
  const model = permissionRequestStore();
  const repository = createPermissionRequestRepository(model);
  await repository.create({
    requestId: "req-1", guildId: "g1", type: "bot-add", requesterId: REQUESTER,
    target: BOT_ID, action: "add", botId: BOT_ID, reason: "bot de muzica"
  });
  await repository.resolve("g1", "req-1", "approved", "owner-1", { target: BOT_ID, action: "add" });
  return model;
}

test("cu moderation-guard oprit, adaugarea unui bot nu mai declanseaza nicio interventie", async () => {
  const run = scenario({ settings: { moderationGuardEnabled: false } });

  await run.runtime.handleGuildMemberAdd(run.member);

  assert.deepEqual(run.kicks, [], "bot-add nu mai are un comutator propriu; fara poarta nu se elimina nimic");
  assert.deepEqual(run.sent, []);
});

test("fara canal de cereri configurat, poarta nu poate cere aprobare deci nu intervine", async () => {
  const run = scenario({ settings: { permissionRequestChannelId: null } });

  await run.runtime.handleGuildMemberAdd(run.member);

  assert.deepEqual(run.kicks, []);
});

test("o aprobare de tip bot-add pentru botul si solicitantul exact lasa botul in server", async () => {
  const model = await approvedRequest();
  const run = scenario({ model });

  await run.runtime.handleGuildMemberAdd(run.member);

  assert.deepEqual(run.kicks, [], "aprobarea unificata acopera adaugarea");
  assert.equal(model.records[0].status, "used", "aprobarea este de unica folosinta");
});

test("aceeasi aprobare nu acopera o a doua adaugare a aceluiasi bot", async () => {
  const model = await approvedRequest();

  const first = scenario({ model });
  await first.runtime.handleGuildMemberAdd(first.member);
  const second = scenario({ model });
  await second.runtime.handleGuildMemberAdd(second.member);

  assert.deepEqual(first.kicks, []);
  assert.equal(second.kicks.length, 1, "a doua adaugare nu se poate ascunde in spatele aceleiasi aprobari");
});

test("un bot adaugat fara nicio aprobare este eliminat", async () => {
  const run = scenario();

  await run.runtime.handleGuildMemberAdd(run.member);

  assert.equal(run.kicks.length, 1);
});

test("in timpul unui raid confirmat, bot-add cedeaza controlul catre anti-raid", async () => {
  const run = scenario({ isRaidConfirmed: async () => true });

  await run.runtime.handleGuildMemberAdd(run.member);

  assert.deepEqual(run.kicks, [], "anti-raid decide singur ce se intampla cu joinurile in timpul incidentului");
});

test("migrarea 19 muta protectia veche in moderation-guard si sterge campurile legacy", async () => {
  const updates: Array<{ filter: Record<string, unknown>; update: Record<string, unknown> }> = [];
  await m19_dropLegacyBotAddFields.up(moduleContext<Parameters<typeof m19_dropLegacyBotAddFields.up>[0]>({
    collection: () => ({
      updateMany: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
        updates.push({ filter, update });
        return undefined;
      }
    })
  }));

  assert.equal(updates.length, 2);
  assert.deepEqual(updates[0].update, { $set: { moderationGuardEnabled: true } });
  assert.deepEqual(updates[0].filter, { botAddProtectionEnabled: true, moderationGuardEnabled: { $ne: true } });
  assert.deepEqual(updates[1].update, { $unset: { botAddAlertChannelId: "", botAddProtectionEnabled: "", botAddPermissions: "" } });
});

test("solicitantul unui bot neaprobat isi pierde rolurile ridicate, nu doar botul (F-45)", async () => {
  const run = scenario();

  await run.runtime.handleGuildMemberAdd(run.member);

  assert.equal(run.kicks.length, 1);
  assert.deepEqual(run.removedRoles, ["role-mod"], "fara sanctiune, autorul pastreaza permisiunile ca sa adauge imediat alt bot");
  assert.match(run.sent.join(" "), /Roluri eliminate si verificate: Moderator/);
});

test("sanctiunea se aplica si cand botul nu a putut fi eliminat (F-45)", async () => {
  const run = scenario({ kickFails: true });

  await run.runtime.handleGuildMemberAdd(run.member);

  assert.deepEqual(run.kicks, [], "botul a ramas: exact cazul in care autorul e cel mai periculos");
  assert.deepEqual(run.removedRoles, ["role-mod"]);
  assert.match(run.sent.join(" "), /INCIDENT CRITIC/);
});

test("un bot aprobat nu declanseaza nicio sanctiune asupra solicitantului (F-45)", async () => {
  const model = await approvedRequest();
  const run = scenario({ model });

  await run.runtime.handleGuildMemberAdd(run.member);

  assert.deepEqual(run.removedRoles, [], "aprobarea ownerului nu are voie sa coste solicitantul rolurile");
});

test("rolurile peste rolul botului sunt raportate ca blocate, nu ca retrase (F-45)", async () => {
  const run = scenario({ actorRoles: [{ id: "role-sef", name: "Head Admin", position: 20, managed: false, elevated: true }] });

  await run.runtime.handleGuildMemberAdd(run.member);

  assert.deepEqual(run.removedRoles, [], "un rol peste rolul botului nu poate fi retras");
  assert.match(run.sent.join(" "), /Head Admin/);
});

test("un rol care ramane dupa retragere ridica interventia ownerului (F-45)", async () => {
  const run = scenario({ keepsRolesAfterRemoval: true });

  await run.runtime.handleGuildMemberAdd(run.member);

  assert.match(run.sent.join(" "), /interventie|inca/i, "o retragere care raspunde cu succes dar lasa rolul pe autor nu e o sanctiune reusita");
});

test("fara contextul de sanctionare, incidentul spune ca sanctiunea nu s-a putut aplica (F-45)", async () => {
  const run = scenario({ withoutSanctionContext: true });

  await run.runtime.handleGuildMemberAdd(run.member);

  assert.equal(run.kicks.length, 1, "eliminarea botului nu depinde de sanctiune");
  assert.deepEqual(run.removedRoles, []);
});
