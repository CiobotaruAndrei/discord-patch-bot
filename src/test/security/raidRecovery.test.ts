import test from "node:test";
import assert from "node:assert/strict";

import { createRaidRecoveryRuntime } from "../../features/command-security/raidRecoveryRuntime.js";
import { describeRecovery, emptyProtections, emptySnapshot, planRecovery, recoveryComplete, remapChannelId, remapOverwrites, webhookAvatarUrl } from "../../features/command-security/raidSnapshotTypes.js";
import { adaptRecoveryGuild } from "../../app/runtime/raidRecoveryGuildAdapter.js";
import { moduleContext } from "../moduleContextStub.js";
import type { RecoveryGuildPort } from "../../features/command-security/raidRecoveryRuntime.js";
import type { CurrentServerState, RaidSnapshot, SnapshotProtections } from "../../features/command-security/raidSnapshotTypes.js";
import type { RaidSnapshotModelLike } from "../../features/command-security/raidSnapshotRepository.js";

const NOW = Date.parse("2026-08-02T15:00:00.000Z");
const INCIDENT = "raid-1";

function snapshotModel(): RaidSnapshotModelLike & { docs: Map<string, Record<string, unknown>> } {
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
      if (!existing) {
        const seed = (update.$setOnInsert ?? update.$set) as Record<string, unknown> | undefined;
        if (!options?.upsert || !seed) return { matchedCount: 0, modifiedCount: 0 };
        docs.set(id, { _id: id, ...seed });
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }
      for (const [field, expected] of Object.entries(filter)) {
        if (field === "_id") continue;
        const actual = existing[field] ?? null;
        if (actual !== expected) return { matchedCount: 0, modifiedCount: 0 };
      }
      if (update.$set) Object.assign(existing, update.$set);
      for (const [field, value] of Object.entries((update.$push ?? {}) as Record<string, unknown>)) {
        const current = existing[field];
        existing[field] = [...(Array.isArray(current) ? current : []), value];
      }
      return { matchedCount: 1, modifiedCount: 1 };
    }
  };
}

function snapshotWith(overrides: Partial<RaidSnapshot> = {}): RaidSnapshot {
  return { ...emptySnapshot(new Date(NOW)), ...overrides };
}

function harness(options: {
  snapshot?: RaidSnapshot;
  current?: Partial<CurrentServerState>;
  failures?: Set<string>;
} = {}) {
  const model = snapshotModel();
  const created: string[] = [];
  const published: string[] = [];
  const protections: Array<{ field: string; enabled: boolean }> = [];
  const failures = options.failures ?? new Set<string>();

  const current: CurrentServerState = {
    channelIds: [],
    roleIds: [],
    webhookIds: [],
    inviteCodes: [],
    protections: emptyProtections(),
    ...options.current
  };

  const guild = moduleContext<RecoveryGuildPort>({
    id: "g1",
    captureSnapshot: async () => options.snapshot ?? snapshotWith(),
    readCurrentState: async () => current,
    recreateChannel: async (channel: { channelId: string }) => {
      if (failures.has(channel.channelId)) return null;
      created.push(`channel:${channel.channelId}`);
      return `${channel.channelId}-nou`;
    },
    recreateRole: async (role: { roleId: string }) => {
      if (failures.has(role.roleId)) return null;
      created.push(`role:${role.roleId}`);
      return `${role.roleId}-nou`;
    },
    recreateWebhook: async (webhook: { webhookId: string }) => {
      if (failures.has(webhook.webhookId)) return null;
      created.push(`webhook:${webhook.webhookId}`);
      return `${webhook.webhookId}-nou`;
    },
    restoreInvite: async (invite: { code: string }) => {
      if (failures.has(invite.code)) return null;
      created.push(`invite:${invite.code}`);
      return `${invite.code}-nou`;
    },
    restoreProtection: async (field: keyof SnapshotProtections, enabled: boolean) => {
      if (failures.has(String(field))) return false;
      protections.push({ field: String(field), enabled });
      return true;
    },
    publish: async (body: string) => { published.push(body); return undefined; }
  });

  return { runtime: createRaidRecoveryRuntime({ RaidSnapshotModel: model, now: () => NOW }), guild, model, created, published, protections };
}

test("planul de restaurare cere doar ce lipseste fata de starea curenta", () => {
  const snapshot = snapshotWith({
    channels: [
      { channelId: "c1", name: "general", channelType: 0, parentId: null, position: 0, topic: null, nsfw: null, rateLimitPerUser: null, overwrites: [] },
      { channelId: "c2", name: "sters", channelType: 0, parentId: null, position: 1, topic: null, nsfw: null, rateLimitPerUser: null, overwrites: [] }
    ],
    roles: [{ roleId: "r1", name: "Mod", permissions: "0", position: 3, color: null, hoist: false, mentionable: false, managed: false }]
  });

  const operations = planRecovery(snapshot, {
    channelIds: ["c1"],
    roleIds: ["r1"],
    webhookIds: [],
    inviteCodes: [],
    protections: emptyProtections()
  });

  assert.deepEqual(operations.map(entry => [entry.kind, entry.resourceId]), [["recreate-channel", "c2"]]);
});

test("rolurile gestionate de integrari nu se recreeaza, fiindca nu pot fi", () => {
  const snapshot = snapshotWith({
    roles: [{ roleId: "r-bot", name: "Bot", permissions: "0", position: 3, color: null, hoist: false, mentionable: false, managed: true }]
  });

  const operations = planRecovery(snapshot, {
    channelIds: [], roleIds: [], webhookIds: [], inviteCodes: [], protections: emptyProtections()
  });

  assert.deepEqual(operations, []);
});

test("rolurile se recreeaza inaintea canalelor, ca overwrite-urile sa aiba pe cine referi", () => {
  const snapshot = snapshotWith({
    channels: [{ channelId: "c1", name: "general", channelType: 0, parentId: null, position: 0, topic: null, nsfw: null, rateLimitPerUser: null, overwrites: [] }],
    roles: [{ roleId: "r1", name: "Mod", permissions: "0", position: 3, color: null, hoist: false, mentionable: false, managed: false }]
  });

  const operations = planRecovery(snapshot, {
    channelIds: [], roleIds: [], webhookIds: [], inviteCodes: [], protections: emptyProtections()
  });

  assert.deepEqual(operations.map(entry => entry.kind), ["recreate-role", "recreate-channel"]);
});

test("o protectie oprita in timpul raidului este readusa la valoarea din snapshot", () => {
  const snapshot = snapshotWith({ protections: { ...emptyProtections(), moderationGuardEnabled: true, threatProtectionEnabled: true } });

  const operations = planRecovery(snapshot, {
    channelIds: [], roleIds: [], webhookIds: [], inviteCodes: [],
    protections: { ...emptyProtections(), threatProtectionEnabled: true }
  });

  assert.deepEqual(operations.map(entry => entry.resourceId), ["moderationGuardEnabled"]);
});

test("snapshotul se captureaza o singura data per incident", async () => {
  const setup = harness({ snapshot: snapshotWith({ roles: [{ roleId: "r1", name: "Mod", permissions: "0", position: 3, color: null, hoist: false, mentionable: false, managed: false }] }) });

  const first = await setup.runtime.captureBeforeContainment(setup.guild, INCIDENT);
  const second = await setup.runtime.captureBeforeContainment(setup.guild, INCIDENT);

  assert.equal(first.kind, "captured");
  assert.equal(second.kind, "already-captured", "o a doua incercare nu poate suprascrie starea de dinaintea atacului");
});

test("fara snapshot capturat, restaurarea nu inventeaza nimic", async () => {
  const setup = harness();

  assert.deepEqual(await setup.runtime.restore(setup.guild, INCIDENT), { kind: "no-snapshot" });
});

test("restaurarea recreeaza ce lipseste si raporteaza ID-urile noi", async () => {
  const snapshot = snapshotWith({
    channels: [{ channelId: "c1", name: "general", channelType: 0, parentId: null, position: 0, topic: null, nsfw: null, rateLimitPerUser: null, overwrites: [] }],
    roles: [{ roleId: "r1", name: "Mod", permissions: "0", position: 3, color: null, hoist: false, mentionable: false, managed: false }],
    webhooks: [{ webhookId: "w1", channelId: "c1", name: "anunturi", avatar: null }],
    invites: [{ code: "abc", channelId: "c1", inviterId: null, maxAge: null, maxUses: null, temporary: false }]
  });
  const setup = harness({ snapshot });
  await setup.runtime.captureBeforeContainment(setup.guild, INCIDENT);

  const outcome = await setup.runtime.restore(setup.guild, INCIDENT);

  assert.equal(outcome.kind, "restored");
  assert.deepEqual(setup.created, ["role:r1", "channel:c1", "webhook:w1", "invite:abc"]);
  assert.match(setup.published[0] ?? "", /4 din 4/);
  assert.match(setup.published[0] ?? "", /ID-uri noi/, "mesajul nu pretinde ca s-a recuperat totul");
});

test("o resursa care exista deja la restaurare este sarita, nu duplicata", async () => {
  const snapshot = snapshotWith({
    channels: [{ channelId: "c1", name: "general", channelType: 0, parentId: null, position: 0, topic: null, nsfw: null, rateLimitPerUser: null, overwrites: [] }]
  });
  const setup = harness({ snapshot, current: { channelIds: [] } });
  await setup.runtime.captureBeforeContainment(setup.guild, INCIDENT);

  const first = await setup.runtime.restore(setup.guild, INCIDENT);
  const second = await setup.runtime.restore(setup.guild, INCIDENT);

  assert.equal(first.kind, "restored");
  assert.equal(second.kind, "restored");
  assert.deepEqual(setup.created, ["channel:c1"], "a doua rulare nu recreeaza inca o data acelasi canal");
});

test("o operatiune care esueaza ajunge la owner-intervention-required, nu la resolved tacut", async () => {
  const snapshot = snapshotWith({
    channels: [
      { channelId: "c1", name: "general", channelType: 0, parentId: null, position: 0, topic: null, nsfw: null, rateLimitPerUser: null, overwrites: [] },
      { channelId: "c2", name: "anunturi", channelType: 0, parentId: null, position: 1, topic: null, nsfw: null, rateLimitPerUser: null, overwrites: [] }
    ]
  });
  const setup = harness({ snapshot, failures: new Set(["c2"]) });
  await setup.runtime.captureBeforeContainment(setup.guild, INCIDENT);

  const outcome = await setup.runtime.restore(setup.guild, INCIDENT);

  assert.equal(outcome.kind, "restored");
  assert.equal(
    outcome.kind === "restored" ? outcome.complete : true,
    false,
    "o operatiune care cere interventia ownerului NU inseamna recovery complet; incidentul ramane deschis"
  );
  const blocked = outcome.kind === "restored" ? outcome.operations.filter(entry => entry.status === "owner-intervention-required") : [];
  assert.deepEqual(blocked.map(entry => entry.label), ["anunturi"]);
  assert.match(setup.published[0] ?? "", /interventia ownerului/);
});

test("recovery e complet doar cand tot ce era de facut e done sau skipped (review #944)", () => {
  assert.equal(recoveryComplete([{ kind: "recreate-channel", resourceId: "c1", label: "general", status: "pending", attempts: 0, detail: null }]), false);
  assert.equal(recoveryComplete([{ kind: "recreate-channel", resourceId: "c1", label: "general", status: "done", attempts: 1, detail: null }]), true);
  assert.equal(recoveryComplete([{ kind: "recreate-channel", resourceId: "c1", label: "general", status: "skipped", attempts: 1, detail: null }]), true);
  assert.equal(
    recoveryComplete([{ kind: "recreate-channel", resourceId: "c1", label: "general", status: "owner-intervention-required", attempts: 3, detail: null }]),
    false,
    "un server ramas deteriorat nu poate fi raportat ca restaurat complet"
  );
});

test("overwrite-urile care tinteau un rol sters primesc ID-ul rolului recreat (review #944)", () => {
  const overwrites = [
    { id: "role-vechi", type: 0, allow: "1", deny: "0" },
    { id: "membru-1", type: 1, allow: "0", deny: "2" }
  ];

  const remapped = remapOverwrites(overwrites, [{ previousRoleId: "role-vechi", nextRoleId: "role-nou" }]);

  assert.deepEqual(remapped.map(entry => entry.id), ["role-nou", "membru-1"]);
  assert.equal(remapped[0].allow, "1", "restul overwrite-ului ramane neatins");
});

test("fara remapari, overwrite-urile raman exact cum erau", () => {
  const overwrites = [{ id: "role-1", type: 0, allow: "1", deny: "0" }];

  assert.deepEqual(remapOverwrites(overwrites, []), overwrites);
});

test("un canal recreat dupa rolul lui foloseste ID-ul nou al rolului in overwrite (review #944)", async () => {
  const snapshot = snapshotWith({
    roles: [{ roleId: "r1", name: "Mod", permissions: "0", position: 3, color: null, hoist: false, mentionable: false, managed: false }],
    channels: [{
      channelId: "c1", name: "general", channelType: 0, parentId: null, position: 0, topic: null, nsfw: null, rateLimitPerUser: null,
      overwrites: [{ id: "r1", type: 0, allow: "1", deny: "0" }]
    }]
  });
  const seenOverwrites: string[][] = [];
  const setup = harness({ snapshot });
  const guild = moduleContext<RecoveryGuildPort>({
    ...setup.guild,
    recreateChannel: async (channel: { overwrites: Array<{ id: string }> }) => {
      seenOverwrites.push(channel.overwrites.map(entry => entry.id));
      return "c1-nou";
    }
  });
  await setup.runtime.captureBeforeContainment(guild, INCIDENT);

  await setup.runtime.restore(guild, INCIDENT);

  assert.deepEqual(seenOverwrites, [["r1-nou"]], "altfel Discord refuza overwrite-ul pentru un rol care nu mai exista");
});

test("protectiile oprite in raid sunt readuse exact la valorile din snapshot", async () => {
  const snapshot = snapshotWith({ protections: { ...emptyProtections(), moderationGuardEnabled: true, adProtectionEnabled: true } });
  const setup = harness({ snapshot });
  await setup.runtime.captureBeforeContainment(setup.guild, INCIDENT);

  await setup.runtime.restore(setup.guild, INCIDENT);

  assert.deepEqual(
    [...setup.protections].sort((left, right) => left.field.localeCompare(right.field)),
    [{ field: "adProtectionEnabled", enabled: true }, { field: "moderationGuardEnabled", enabled: true }]
  );
});

test("resursele protejate recreate sunt rebindate la ID-ul nou, nu doar marcate (review #945)", async () => {
  const rebinds: Array<{ previous: string; next: string }> = [];
  const snapshot = snapshotWith({
    channels: [{ channelId: "c1", name: "general", channelType: 0, parentId: null, position: 0, topic: null, nsfw: null, rateLimitPerUser: null, overwrites: [] }],
    roles: [{ roleId: "r1", name: "Mod", permissions: "0", position: 3, color: null, hoist: false, mentionable: false, managed: false }]
  });
  const model = snapshotModel();
  const runtime = createRaidRecoveryRuntime({
    RaidSnapshotModel: model,
    now: () => NOW,
    onResourceRecreated: async (_guildId: string, previous: string, next: string) => {
      rebinds.push({ previous, next });
      return undefined;
    }
  });
  const setup = harness({ snapshot });
  await runtime.captureBeforeContainment(setup.guild, INCIDENT);

  await runtime.restore(setup.guild, INCIDENT);

  assert.deepEqual(rebinds, [
    { previous: "r1", next: "r1-nou" },
    { previous: "c1", next: "c1-nou" }
  ], "fara asta, inregistrarea de protectie ramane legata de un ID Discord inexistent");
});

test("o resursa care NU a putut fi recreata nu produce rebind (review #945)", async () => {
  const rebinds: string[] = [];
  const snapshot = snapshotWith({
    channels: [{ channelId: "c1", name: "general", channelType: 0, parentId: null, position: 0, topic: null, nsfw: null, rateLimitPerUser: null, overwrites: [] }]
  });
  const model = snapshotModel();
  const runtime = createRaidRecoveryRuntime({
    RaidSnapshotModel: model,
    now: () => NOW,
    onResourceRecreated: async (_guildId: string, previous: string) => { rebinds.push(previous); return undefined; }
  });
  const setup = harness({ snapshot, failures: new Set(["c1"]) });
  await runtime.captureBeforeContainment(setup.guild, INCIDENT);

  await runtime.restore(setup.guild, INCIDENT);

  assert.deepEqual(rebinds, [], "o resursa neredata nu poate fi rebindata la nimic");
});

function baselineHarness() {
  const model = snapshotModel();
  let clock = NOW - 3 * 60 * 60 * 1000;
  const runtime = createRaidRecoveryRuntime({ RaidSnapshotModel: model, now: () => clock });
  const captured: RaidSnapshot[] = [];
  let live = snapshotWith();

  const guild = moduleContext<RecoveryGuildPort>({
    id: "g1",
    captureSnapshot: async () => {
      captured.push(live);
      return live;
    }
  });

  return {
    runtime,
    guild,
    model,
    captured,
    setLive: (snapshot: RaidSnapshot) => { live = snapshot; },
    advance: (ms: number) => { clock += ms; }
  };
}

const CHANNEL = {
  channelId: "chan-distrus", name: "anunturi", channelType: 0, parentId: null,
  position: 0, topic: null, nsfw: false, rateLimitPerUser: null, overwrites: []
};
const ROLE = { roleId: "role-1", name: "Staff", position: 3, color: 0, hoist: false, mentionable: false, managed: false, permissions: "0" };

test("baseline-ul inghetat inainte de raid e cel folosit de recovery, nu starea de la confirmare (N-02)", async () => {
  const setup = baselineHarness();
  setup.setLive(snapshotWith({ channels: [CHANNEL] }));
  await setup.runtime.refreshBaseline(setup.guild);

  setup.advance(3 * 60 * 60 * 1000);
  await setup.runtime.freezeBaseline("g1");
  setup.setLive(snapshotWith({ channels: [] }));

  const outcome = await setup.runtime.captureBeforeContainment(setup.guild, INCIDENT, new Date(NOW));

  assert.equal(outcome.kind === "captured" && outcome.source, "frozen-baseline");
  assert.equal(outcome.kind === "captured" && outcome.channels, 1, "canalul sters inainte de confirmare trebuie sa fie in snapshot");
  assert.match(outcome.kind === "captured" ? outcome.note : "", /pot fi recreate/);
});

test("fara baseline inghetat, recovery cade pe starea curenta si o spune explicit (N-02)", async () => {
  const setup = baselineHarness();

  const outcome = await setup.runtime.captureBeforeContainment(setup.guild, INCIDENT, new Date(NOW));

  assert.equal(outcome.kind === "captured" && outcome.source, "live-capture");
  assert.match(outcome.kind === "captured" ? outcome.note : "", /NU pot fi recreate/);
});

test("un baseline necongelat nu e de incredere: a putut fi rescris in timpul raidului (N-02)", async () => {
  const setup = baselineHarness();
  setup.setLive(snapshotWith({ channels: [CHANNEL] }));
  await setup.runtime.refreshBaseline(setup.guild);
  setup.advance(3 * 60 * 60 * 1000);

  const outcome = await setup.runtime.captureBeforeContainment(setup.guild, INCIDENT, new Date(NOW));

  assert.equal(outcome.kind === "captured" && outcome.source, "live-capture", "fara inghetare, baseline-ul putea fi rescris de atacator");
});

test("cat timp baseline-ul e inghetat, reimprospatarea nu il rescrie (N-02)", async () => {
  const setup = baselineHarness();
  setup.setLive(snapshotWith({ roles: [ROLE] }));
  await setup.runtime.refreshBaseline(setup.guild);
  setup.advance(3 * 60 * 60 * 1000);
  await setup.runtime.freezeBaseline("g1");

  setup.setLive(snapshotWith({ roles: [] }));
  setup.advance(7 * 60 * 60 * 1000);
  const refreshed = await setup.runtime.refreshBaseline(setup.guild);
  const outcome = await setup.runtime.captureBeforeContainment(setup.guild, INCIDENT, new Date(NOW));

  assert.equal(refreshed, false, "un atacator care declanseaza o reimprospatare nu are voie sa stearga referinta");
  assert.equal(outcome.kind === "captured" && outcome.roles, 1);
});

test("dupa dezghetare, baseline-ul redevine reimprospatabil (N-02)", async () => {
  const setup = baselineHarness();
  setup.setLive(snapshotWith({ roles: [ROLE] }));
  await setup.runtime.refreshBaseline(setup.guild);
  await setup.runtime.freezeBaseline("g1");
  await setup.runtime.releaseBaseline("g1");

  setup.advance(7 * 60 * 60 * 1000);
  assert.equal(await setup.runtime.refreshBaseline(setup.guild), true, "dupa inchiderea incidentului serverul curent redevine referinta");
});

test("reimprospatarea nu recaptureaza inainte de intervalul stabilit (N-02)", async () => {
  const setup = baselineHarness();
  await setup.runtime.refreshBaseline(setup.guild);
  const dupaPrima = setup.captured.length;

  setup.advance(60_000);
  await setup.runtime.refreshBaseline(setup.guild);

  assert.equal(setup.captured.length, dupaPrima, "un baseline proaspat nu se recaptureaza la fiecare pornire");
});

test("un baseline foarte vechi nu e folosit ca referinta (N-02)", async () => {
  const setup = baselineHarness();
  setup.setLive(snapshotWith({ channels: [CHANNEL] }));
  await setup.runtime.refreshBaseline(setup.guild);
  await setup.runtime.freezeBaseline("g1");
  setup.advance(30 * 24 * 60 * 60 * 1000);

  const outcome = await setup.runtime.captureBeforeContainment(setup.guild, INCIDENT, new Date(NOW));

  assert.equal(outcome.kind === "captured" && outcome.source, "live-capture", "un baseline de o luna descrie alt server");
});

const WEBHOOK = { webhookId: "wh-1", channelId: "chan-1", name: "Anunturi", avatar: null };
const INVITE = { code: "abc123", channelId: "chan-1", inviterId: "u1", maxAge: 3600, maxUses: 5, temporary: false };

function recoveryGuild(options: {
  channels?: Record<string, { createWebhook?: boolean; createInvite?: boolean }>;
  fetchable?: Record<string, { createWebhook?: boolean; createInvite?: boolean }>;
} = {}) {
  const createdWebhooks: Array<{ channelId: string; name: string }> = [];
  const createdInvites: Array<{ channelId: string; maxAge: number; maxUses: number; temporary: boolean }> = [];

  const build = (channelId: string, caps: { createWebhook?: boolean; createInvite?: boolean }) => ({
    createWebhook: caps.createWebhook === false ? undefined : async (payload: Record<string, unknown>) => {
      createdWebhooks.push({ channelId, name: String(payload.name) });
      return { id: `wh-nou-${createdWebhooks.length}`, url: `https://discord.com/api/webhooks/wh-nou-${createdWebhooks.length}/token` };
    },
    createInvite: caps.createInvite === false ? undefined : async (payload: Record<string, unknown>) => {
      createdInvites.push({
        channelId,
        maxAge: Number(payload.maxAge),
        maxUses: Number(payload.maxUses),
        temporary: payload.temporary === true
      });
      return { code: `cod-nou-${createdInvites.length}` };
    }
  });

  const cache = new Map(Object.entries(options.channels ?? { "chan-1": {} }).map(([id, caps]) => [id, build(id, caps)]));
  const fetchable = new Map(Object.entries(options.fetchable ?? {}).map(([id, caps]) => [id, build(id, caps)]));

  const guild = moduleContext<Parameters<typeof adaptRecoveryGuild>[0]>({
    id: "g1",
    channels: {
      cache: { get: (id: string) => cache.get(id), values: () => [...cache.values()] },
      fetch: async (id: string) => fetchable.get(id) ?? null
    }
  });

  return {
    port: adaptRecoveryGuild(guild, async () => ({}), async () => true, async () => undefined),
    createdWebhooks,
    createdInvites
  };
}

test("un webhook distrus in raid este recreat efectiv (N-05)", async () => {
  const setup = recoveryGuild();

  const created = await setup.port?.recreateWebhook(WEBHOOK);

  assert.ok(created, "pana acum orice webhook lipsa ajungea inevitabil la owner-intervention-required");
  assert.doesNotMatch(created ?? "", /http/,
    "URL-ul webhook-ului e o credentiala: se returneaza ID-ul, nu tokenul (review PR #993)");
  assert.deepEqual(setup.createdWebhooks, [{ channelId: "chan-1", name: "Anunturi" }]);
});

test("o invitatie distrusa in raid este recreata cu configuratia pastrata (N-05)", async () => {
  const setup = recoveryGuild();

  const created = await setup.port?.restoreInvite(INVITE);

  assert.equal(created, "cod-nou-1");
  assert.deepEqual(setup.createdInvites, [{ channelId: "chan-1", maxAge: 3600, maxUses: 5, temporary: false }]);
});

test("cand canalul lipseste cu totul, resursa ramane la owner (N-05)", async () => {
  const setup = recoveryGuild({ channels: {} });

  assert.equal(await setup.port?.recreateWebhook(WEBHOOK), null);
  assert.equal(await setup.port?.restoreInvite(INVITE), null);
});

test("un canal necachat e adus prin fetch inainte sa fie declarat pierdut (N-05)", async () => {
  const setup = recoveryGuild({ channels: {}, fetchable: { "chan-1": {} } });

  assert.ok(await setup.port?.recreateWebhook(WEBHOOK), "recovery ruleaza dupa recreari, deci canalul poate lipsi din cache");
});

test("un canal fara permisiunea de webhook nu produce o recreare falsa (N-05)", async () => {
  const setup = recoveryGuild({ channels: { "chan-1": { createWebhook: false } } });

  assert.equal(await setup.port?.recreateWebhook(WEBHOOK), null);
});

test("webhook-ul urmeaza canalul recreat, nu ID-ul disparut din snapshot (N-05)", async () => {
  const setup = baselineHarness();
  await setup.runtime.refreshBaseline(setup.guild);

  const remapped = remapChannelId("chan-vechi", [{ previousId: "chan-vechi", nextId: "chan-nou" }]);

  assert.equal(remapped, "chan-nou", "fara remapare, webhook-ul s-ar crea intr-un canal care nu mai exista");
  assert.equal(remapChannelId("chan-intact", [{ previousId: "altul", nextId: "nou" }]), "chan-intact");
});

test("avatarul stocat ca hash e transformat in URL CDN inainte de creare (review PR #993)", () => {
  assert.equal(
    webhookAvatarUrl("wh-1", "a1b2c3"),
    "https://cdn.discordapp.com/avatars/wh-1/a1b2c3.png",
    "Discord stocheaza hash-ul, dar createWebhook cere date rezolvabile ca imagine"
  );
  assert.equal(webhookAvatarUrl("wh-1", "a_animat"), "https://cdn.discordapp.com/avatars/wh-1/a_animat.gif");
  assert.equal(webhookAvatarUrl("wh-1", null), null);
  assert.equal(webhookAvatarUrl("wh-1", "https://deja/url.png"), "https://deja/url.png");
});

test("un avatar respins nu impinge webhook-ul la owner: se recreeaza fara el (review PR #993)", async () => {
  const rejected: string[] = [];
  let attempts = 0;
  const guild = moduleContext<Parameters<typeof adaptRecoveryGuild>[0]>({
    id: "g1",
    channels: {
      cache: {
        get: () => ({
          createWebhook: async (payload: Record<string, unknown>) => {
            attempts += 1;
            if (payload.avatar !== undefined) {
              rejected.push(String(payload.avatar));
              throw new Error("avatar invalid");
            }
            return { id: "wh-fara-avatar" };
          }
        }),
        values: () => []
      }
    }
  });

  const port = adaptRecoveryGuild(guild, async () => ({}), async () => true, async () => undefined);
  const created = await port?.recreateWebhook({ ...WEBHOOK, avatar: "hash-invalid" });

  assert.equal(created, "wh-fara-avatar", "un avatar pe care Discord il refuza nu are voie sa piarda webhook-ul cu totul");
  assert.equal(attempts, 2, "prima incercare pastreaza avatarul, a doua renunta doar la el");
  assert.deepEqual(rejected, ["https://cdn.discordapp.com/avatars/wh-1/hash-invalid.png"]);
});

test("raportul ii spune ownerului ce webhook-uri s-au recreat, fara sa publice URL-uri (review PR #993)", () => {
  const report = describeRecovery([
    { kind: "recreate-webhook", resourceId: "wh-1", label: "Anunturi", status: "done", attempts: 1, detail: "recreat ca wh-nou" },
    { kind: "restore-invite", resourceId: "abc", label: "abc", status: "done", attempts: 1, detail: "cod nou" }
  ]);

  assert.match(report, /Anunturi/, "ownerul trebuie sa stie ce integrari sa reconfigureze");
  assert.match(report, /Server Settings > Integrations/);
  assert.doesNotMatch(report, /http/, "URL-ul e o credentiala si nu se publica in canal");
  assert.match(report, /invitatii au fost recreate cu coduri noi/);
function retryHarness(options: { failFirstChannel?: boolean } = {}) {
  const model = snapshotModel();
  const createdRoles: Array<{ name: string; position: number }> = [];
  const createdChannels: Array<{ name: string; parentId: string | null; overwriteIds: string[] }> = [];
  let channelAttempts = 0;

  const guild = moduleContext<RecoveryGuildPort>({
    id: "g1",
    readCurrentState: async () => ({
      channelIds: [], roleIds: [], webhookIds: [], inviteCodes: [], protections: emptyProtections()
    }),
    recreateRole: async (role: { name: string; position: number }) => {
      createdRoles.push({ name: role.name, position: role.position });
      return `rol-nou-${createdRoles.length}`;
    },
    recreateChannel: async (channel: { name: string; parentId: string | null; overwrites: Array<{ id: string }> }) => {
      channelAttempts += 1;
      if (options.failFirstChannel && channelAttempts === 1) throw new Error("Discord indisponibil");
      createdChannels.push({
        name: channel.name,
        parentId: channel.parentId,
        overwriteIds: channel.overwrites.map(entry => entry.id)
      });
      return `chan-nou-${createdChannels.length}`;
    },
    restoreProtection: async () => true,
    publish: async () => undefined,
    captureSnapshot: async () => snapshotWith()
  });

  return { runtime: createRaidRecoveryRuntime({ RaidSnapshotModel: model, now: () => NOW }), guild, model, createdRoles, createdChannels };
}

const CATEGORY = {
  channelId: "cat-1", name: "Categoria", channelType: 4, parentId: null,
  position: 0, topic: null, nsfw: false, rateLimitPerUser: null, overwrites: []
};
const CHILD = {
  channelId: "chan-copil", name: "general", channelType: 0, parentId: "cat-1",
  position: 1, topic: null, nsfw: false, rateLimitPerUser: null, overwrites: [{ id: "role-vechi", type: 0, allow: "1", deny: "0" }]
};
const STAFF_ROLE = { roleId: "role-vechi", name: "Staff", position: 4, color: 0, hoist: false, mentionable: false, managed: false, permissions: "0" };

test("categoriile se recreeaza inaintea canalelor care le refera (N-04)", () => {
  const operations = planRecovery(
    snapshotWith({ channels: [CHILD, CATEGORY] }),
    { channelIds: [], roleIds: [], webhookIds: [], inviteCodes: [], protections: emptyProtections() }
  );

  const channelOps = operations.filter(entry => entry.kind === "recreate-channel").map(entry => entry.resourceId);
  assert.deepEqual(channelOps, ["cat-1", "chan-copil"],
    "fara ordine topologica, canalul copil ar fi creat cu un parinte care inca nu exista");
});

test("parintele canalului urmeaza categoria recreata, nu ID-ul disparut (N-04)", async () => {
  const setup = retryHarness();
  await setup.runtime.captureBeforeContainment(setup.guild, INCIDENT, new Date(NOW));
  setup.model.docs.set(INCIDENT, {
    ...setup.model.docs.get(INCIDENT),
    snapshot: snapshotWith({ channels: [CATEGORY, CHILD] })
  });

  await setup.runtime.restore(setup.guild, INCIDENT);

  const child = setup.createdChannels.find(entry => entry.name === "general");
  assert.equal(child?.parentId, "chan-nou-1", "categoria recreata are ID nou, deci copilul trebuie sa il urmeze");
});

test("remap-urile supravietuiesc unui retry, nu se pierd intre apeluri (N-04)", async () => {
  const setup = retryHarness({ failFirstChannel: true });
  await setup.runtime.captureBeforeContainment(setup.guild, INCIDENT, new Date(NOW));
  setup.model.docs.set(INCIDENT, {
    ...setup.model.docs.get(INCIDENT),
    snapshot: snapshotWith({ roles: [STAFF_ROLE], channels: [CHILD] })
  });

  await setup.runtime.restore(setup.guild, INCIDENT);
  const stored = setup.model.docs.get(INCIDENT);
  assert.ok(Array.isArray(stored?.remaps) && stored.remaps.length > 0, "maparea vechi-nou trebuie sa ajunga in snapshot");

  await setup.runtime.restore(setup.guild, INCIDENT);

  const retried = setup.createdChannels.find(entry => entry.name === "general");
  assert.deepEqual(retried?.overwriteIds, ["rol-nou-1"],
    "la retry, overwrite-ul trebuie sa refere rolul recreat; fara persistare ar fi folosit iar ID-ul vechi");
});

test("pozitia rolului e restaurata, nu lasata la capatul ierarhiei (N-04)", async () => {
  const setup = retryHarness();
  await setup.runtime.captureBeforeContainment(setup.guild, INCIDENT, new Date(NOW));
  setup.model.docs.set(INCIDENT, { ...setup.model.docs.get(INCIDENT), snapshot: snapshotWith({ roles: [STAFF_ROLE] }) });

  await setup.runtime.restore(setup.guild, INCIDENT);

  assert.deepEqual(setup.createdRoles, [{ name: "Staff", position: 4 }],
    "un rol recreat la pozitia implicita nu mai are aceleasi drepturi relative fata de restul ierarhiei");
});
