import test from "node:test";
import assert from "node:assert/strict";

import { adaptRaidGuild } from "../../app/runtime/antiRaidGuildAdapter.js";
import { moduleContext } from "../moduleContextStub.js";
import type { AdaptableRaidGuild } from "../../app/runtime/antiRaidGuildAdapter.js";

const NOW = Date.parse("2026-08-02T14:00:00.000Z");
const BOT_ADD_AUDIT_EVENT = 28;

interface MemberState {
  roleIds: Set<string>;
  timeoutUntil: number | null;
  voiceMuted: boolean;
  removedRoles: string[][];
  roleAddFails?: boolean;
  roleSilentlyDropped?: boolean;
  roleRemoveFails?: boolean;
}

function guildWith(options: {
  roles?: Array<{ id: string; name: string; position: number; managed?: boolean; elevated?: boolean }>;
  botPosition?: number | null;
  member?: Partial<MemberState>;
  auditEntries?: Array<{ type: number; executor: string; target: string; at: number }>;
} = {}) {
  const state: MemberState = {
    roleIds: new Set(),
    timeoutUntil: null,
    voiceMuted: false,
    removedRoles: [],
    ...options.member
  };
  const roles = options.roles ?? [];
  const roleById = new Map(roles.map(role => [role.id, role]));

  const memberRoles = {
    cache: {
      has: (roleId: string) => state.roleIds.has(roleId),
      values: () => [...state.roleIds]
        .map(id => roleById.get(id))
        .filter((role): role is NonNullable<typeof role> => role !== undefined)
        .map(role => ({
          id: role.id,
          name: role.name,
          position: role.position,
          managed: role.managed === true,
          permissions: { has: () => role.elevated === true }
        }))[Symbol.iterator]()
    },
    add: async (roleId: string) => {
      if (state.roleAddFails) throw new Error("permisiuni insuficiente");
      if (!state.roleSilentlyDropped) state.roleIds.add(roleId);
    },
    remove: async (roleIds: readonly string[]) => {
      if (state.roleRemoveFails) throw new Error("permisiuni insuficiente");
      state.removedRoles.push([...roleIds]);
      for (const id of roleIds) state.roleIds.delete(id);
    }
  };

  const guild = moduleContext<AdaptableRaidGuild>({
    id: "g1",
    roles: {
      everyone: { id: "everyone" },
      cache: { values: () => roles.map(role => ({ id: role.id, name: role.name, position: role.position }))[Symbol.iterator]() }
    },
    channels: { cache: { get: () => undefined } },
    members: {
      fetch: async () => ({
        roles: memberRoles,
        timeout: async (durationMs: number | null) => { state.timeoutUntil = durationMs === null ? null : NOW + durationMs; },
        get communicationDisabledUntilTimestamp() { return state.timeoutUntil; },
        voice: { setMute: async (mute: boolean) => { state.voiceMuted = mute; } },
        ban: async () => undefined
      }),
      me: { roles: { highest: { position: options.botPosition === undefined ? 10 : options.botPosition } } }
    },
    fetchAuditLogs: async (query: { type?: number }) => ({
      entries: new Map((options.auditEntries ?? [])
        .filter(entry => entry.type === query?.type)
        .map((entry, index) => [String(index), {
          executor: { id: entry.executor },
          target: { id: entry.target },
          createdTimestamp: entry.at
        }]))
    })
  });

  const adapted = adaptRaidGuild(guild, async () => null, undefined, () => NOW);
  return { adapted, state };
}

test("mute fara rol Muted NU este raportat ca aplicat, ca scara sa poata escalada (F-29)", async () => {
  const setup = guildWith({ roles: [] });

  const outcome = await setup.adapted.applySanction("raider", "mute", 86_400_000, "raid");

  assert.equal(outcome.applied, false, "un mute care nu opreste scrisul nu poate marca participantul oprit");
  assert.match(outcome.error ?? "", /rol Muted/);
  assert.equal(setup.state.voiceMuted, false, "nu se atinge voice-ul cand mute-ul nu poate fi garantat");
});

test("mute cu rol Muted aplicabil aplica rolul si il verifica dupa (F-29)", async () => {
  const setup = guildWith({ roles: [{ id: "role-muted", name: "Muted", position: 2 }] });

  const outcome = await setup.adapted.applySanction("raider", "mute", 86_400_000, "raid");

  assert.equal(outcome.applied, true);
  assert.ok(setup.state.roleIds.has("role-muted"), "rolul care blocheaza scrisul e cel care conteaza");
  assert.equal(setup.state.voiceMuted, true, "voice-ul e blocat suplimentar, nu in locul textului");
});

test("un rol Muted peste rolul botului nu poate fi aplicat si nu e raportat ca aplicat (F-29)", async () => {
  const setup = guildWith({ roles: [{ id: "role-muted", name: "Muted", position: 50 }], botPosition: 10 });

  const outcome = await setup.adapted.applySanction("raider", "mute", 86_400_000, "raid");

  assert.equal(outcome.applied, false);
  assert.match(outcome.error ?? "", /peste rolul botului/);
});

test("daca rolul nu ramane aplicat dupa verificare, mute-ul e raportat ca esuat si reincercabil (F-29)", async () => {
  const setup = guildWith({
    roles: [{ id: "role-muted", name: "Muted", position: 2 }],
    member: { roleSilentlyDropped: true }
  });

  const outcome = await setup.adapted.applySanction("raider", "mute", 86_400_000, "raid");

  assert.equal(outcome.applied, false, "verificarea post-actiune impiedica un stopped fals pozitiv");
  assert.equal(outcome.retryable, true);
});

test("timeout-ul este verificat dupa aplicare (F-29)", async () => {
  const setup = guildWith();

  const outcome = await setup.adapted.applySanction("raider", "timeout", 3_600_000, "raid");

  assert.equal(outcome.applied, true);
  assert.ok((setup.state.timeoutUntil ?? 0) > NOW);
});

test("autorul adaugarii unui bot este gasit din Audit Log in fereastra de corelare (F-33)", async () => {
  const setup = guildWith({
    auditEntries: [{ type: BOT_ADD_AUDIT_EVENT, executor: "vinovat", target: "bot-9", at: NOW - 5_000 }]
  });

  assert.equal(await setup.adapted.findBotAdder?.("bot-9"), "vinovat");
});

test("o intrare de audit pentru alt bot sau prea veche nu produce un vinovat (F-33)", async () => {
  const other = guildWith({
    auditEntries: [{ type: BOT_ADD_AUDIT_EVENT, executor: "altcineva", target: "bot-1", at: NOW }]
  });
  const stale = guildWith({
    auditEntries: [{ type: BOT_ADD_AUDIT_EVENT, executor: "vechi", target: "bot-9", at: NOW - 300_000 }]
  });

  assert.equal(await other.adapted.findBotAdder?.("bot-9"), null);
  assert.equal(await stale.adapted.findBotAdder?.("bot-9"), null);
});

test("autorului i se elimina rolurile cu permisiuni ridicate, iar cele blocate sunt raportate (F-33)", async () => {
  const setup = guildWith({
    roles: [
      { id: "role-admin", name: "Admin", position: 5, elevated: true },
      { id: "role-integrare", name: "Integrare", position: 4, elevated: true, managed: true },
      { id: "role-sus", name: "Peste bot", position: 20, elevated: true },
      { id: "role-membru", name: "Membru", position: 1 }
    ],
    botPosition: 10,
    member: { roleIds: new Set(["role-admin", "role-integrare", "role-sus", "role-membru"]) }
  });

  const plan = await setup.adapted.stripElevatedRoles?.("vinovat", "raid");

  assert.deepEqual(plan?.removed, ["Admin"]);
  assert.deepEqual([...(plan?.blocked ?? [])].sort(), ["Integrare", "Peste bot"]);
  assert.deepEqual(setup.state.removedRoles, [["role-admin"]]);
  assert.ok(setup.state.roleIds.has("role-membru"), "rolurile fara permisiuni ridicate raman");
});

test("cand eliminarea rolurilor esueaza, nimic nu e raportat ca eliminat (F-33)", async () => {
  const setup = guildWith({
    roles: [{ id: "role-admin", name: "Admin", position: 5, elevated: true }],
    botPosition: 10,
    member: { roleIds: new Set(["role-admin"]), roleRemoveFails: true }
  });

  const plan = await setup.adapted.stripElevatedRoles?.("vinovat", "raid");

  assert.deepEqual(plan?.removed, [], "un rol care nu a putut fi eliminat nu se raporteaza ca eliminat");
  assert.deepEqual(plan?.blocked, ["Admin"], "ajunge in lista celor care cer interventie manuala");
  assert.ok(setup.state.roleIds.has("role-admin"), "rolul a ramas pe autor");
});
