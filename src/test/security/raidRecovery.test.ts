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
        if (expected && typeof expected === "object") {
          const clause = expected as Record<string, unknown>;
          if ("$not" in clause) {
            const inner = clause.$not as Record<string, unknown>;
            const match = (inner.$elemMatch ?? {}) as Record<string, unknown>;
            const present = (Array.isArray(actual) ? actual : []).some(item => {
              const entry = item as Record<string, unknown>;
              return Object.entries(match).every(([key, value]) => entry[key] === value);
            });
            if (present) return { matchedCount: 0, modifiedCount: 0 };
            continue;
          }
          if ("$gt" in clause && !(typeof actual === "number" && actual > Number(clause.$gt))) {
            return { matchedCount: 0, modifiedCount: 0 };
          }
          continue;
        }
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
      if (failures.has(role.roleId)) return { roleId: null, positioned: false };
      created.push(`role:${role.roleId}`);
      return { roleId: `${role.roleId}-nou`, positioned: true };
    },
    restoreRolePosition: async () => true,
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
});

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
      return { roleId: `rol-nou-${createdRoles.length}`, positioned: true };
    },
    restoreRolePosition: async () => true,
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

function roleGuild(options: { positionFails?: boolean; withoutSetPosition?: boolean } = {}) {
  const created: Array<{ name: string; hadPosition: boolean }> = [];
  const positioned: number[] = [];
  const published: string[] = [];

  const guild = moduleContext<Parameters<typeof adaptRecoveryGuild>[0]>({
    id: "g1",
    roles: {
      cache: { values: () => [] },
      create: async (payload: Record<string, unknown>) => {
        created.push({ name: String(payload.name), hadPosition: payload.position !== undefined });
        return {
          id: `rol-nou-${created.length}`,
          setPosition: options.withoutSetPosition
            ? undefined
            : async (position: number) => {
              if (options.positionFails) throw new Error("Missing Permissions");
              positioned.push(position);
              return undefined;
            }
        };
      }
    }
  });

  return {
    port: adaptRecoveryGuild(guild, async () => ({}), async () => true, async (body: string) => { published.push(String(body)); }),
    created,
    positioned,
    published
  };
}

const DELETED_ROLE = { roleId: "role-vechi", name: "Staff", position: 9, color: 0, hoist: false, mentionable: false, managed: false, permissions: "0" };

test("un rol care nu poate fi mutat la pozitia lui ramane totusi urmarit (review PR #994)", async () => {
  const setup = roleGuild({ positionFails: true });

  const created = await setup.port?.recreateRole(DELETED_ROLE);

  assert.equal(created?.roleId, "rol-nou-1",
    "rolul a fost creat; daca esecul mutarii intoarce null, resursa ramane orfana si remap-ul nu se persista niciodata");
  assert.equal(created?.positioned, false, "pozitia esuata trebuie sa fie distincta de succes, nu ascunsa in ID (audit N-04)");
  assert.match(setup.published.join(" "), /nu a putut fi mutat la pozitia 9/);
});

test("crearea nu mai cere pozitia in acelasi apel (review PR #994)", async () => {
  const setup = roleGuild();

  await setup.port?.recreateRole(DELETED_ROLE);

  assert.deepEqual(setup.created, [{ name: "Staff", hadPosition: false }],
    "RoleManager.create cu position face create plus move; un move respins arunca desi rolul exista deja");
  assert.deepEqual(setup.positioned, [9], "pozitionarea se incearca separat");
});

test("cand pozitionarea reuseste, nu se raporteaza nimic ownerului (review PR #994)", async () => {
  const setup = roleGuild();

  await setup.port?.recreateRole(DELETED_ROLE);

  assert.deepEqual(setup.published, []);
});

test("un rol pe care Discord nu il creeaza deloc ramane la owner (review PR #994)", async () => {
  const guild = moduleContext<Parameters<typeof adaptRecoveryGuild>[0]>({
    id: "g1",
    roles: { cache: { values: () => [] }, create: async () => { throw new Error("Missing Permissions"); } }
  });
  const port = adaptRecoveryGuild(guild, async () => ({}), async () => true, async () => undefined);

  assert.deepEqual(await port?.recreateRole(DELETED_ROLE), { roleId: null, positioned: false },
    "esecul crearii ramane esec, nu se mascheaza");
});

const BASE_CHANNEL = {
  channelId: "chan-1", name: "anunturi", channelType: 0, parentId: null,
  position: 2, topic: "reguli", nsfw: false, rateLimitPerUser: 0,
  overwrites: [{ id: "everyone", type: 0, allow: "0", deny: "1024" }]
};
const BASE_ROLE = { roleId: "role-1", name: "Staff", position: 5, color: 7, hoist: true, mentionable: false, managed: false, permissions: "8" };

function stateWith(overrides: Partial<CurrentServerState> = {}): CurrentServerState {
  return {
    channelIds: [], roleIds: [], webhookIds: [], inviteCodes: [], protections: emptyProtections(),
    channels: [], roles: [], ...overrides
  };
}

test("un canal redenumit in raid e planificat pentru restaurare, nu ignorat (N-03)", () => {
  const operations = planRecovery(
    snapshotWith({ channels: [BASE_CHANNEL] }),
    stateWith({ channelIds: ["chan-1"], channels: [{ ...BASE_CHANNEL, name: "hacked" }] })
  );

  assert.deepEqual(operations.map(entry => entry.kind), ["restore-channel"],
    "planul compara doar ID-uri, deci un canal existent dar alterat trecea neatins");
  assert.match(operations[0].label, /name/);
});

test("permisiunile alterate ale unui canal sunt detectate (N-03)", () => {
  const operations = planRecovery(
    snapshotWith({ channels: [BASE_CHANNEL] }),
    stateWith({
      channelIds: ["chan-1"],
      channels: [{ ...BASE_CHANNEL, overwrites: [{ id: "everyone", type: 0, allow: "2048", deny: "0" }] }]
    })
  );

  assert.equal(operations.length, 1);
  assert.match(operations[0].label, /permissions/);
});

test("un rol cu permisiuni ridicate de atacator e planificat pentru restaurare (N-03)", () => {
  const operations = planRecovery(
    snapshotWith({ roles: [BASE_ROLE] }),
    stateWith({ roleIds: ["role-1"], roles: [{ ...BASE_ROLE, permissions: "8589934591" }] })
  );

  assert.deepEqual(operations.map(entry => entry.kind), ["restore-role"]);
  assert.match(operations[0].label, /permissions/);
});

test("o resursa neschimbata nu produce nicio operatiune (N-03)", () => {
  const operations = planRecovery(
    snapshotWith({ channels: [BASE_CHANNEL], roles: [BASE_ROLE] }),
    stateWith({ channelIds: ["chan-1"], roleIds: ["role-1"], channels: [BASE_CHANNEL], roles: [BASE_ROLE] })
  );

  assert.deepEqual(operations, [], "restaurarea nu are voie sa rescrie ce nu s-a schimbat");
});

test("un canal creat de atacator in incident e eliminat (N-03)", () => {
  const operations = planRecovery(
    snapshotWith({ channels: [BASE_CHANNEL] }),
    stateWith({ channelIds: ["chan-1", "chan-raid"], channels: [BASE_CHANNEL, { ...BASE_CHANNEL, channelId: "chan-raid", name: "raid-here" }] }),
    { createdChannelIds: ["chan-raid"] }
  );

  assert.deepEqual(operations.map(entry => entry.kind), ["remove-extra-channel"]);
  assert.equal(operations[0].resourceId, "chan-raid");
});

test("un canal creat legitim de owner NU e eliminat (N-03)", () => {
  const operations = planRecovery(
    snapshotWith({ channels: [BASE_CHANNEL] }),
    stateWith({ channelIds: ["chan-1", "chan-legitim"], channels: [BASE_CHANNEL, { ...BASE_CHANNEL, channelId: "chan-legitim" }] }),
    {}
  );

  assert.deepEqual(operations, [],
    "remove-extra se aplica doar resurselor confirmate ca apartinand incidentului, altfel recovery ar sterge munca ownerului");
});

test("o resursa din incident care exista si in snapshot nu e eliminata (N-03)", () => {
  const operations = planRecovery(
    snapshotWith({ channels: [BASE_CHANNEL] }),
    stateWith({ channelIds: ["chan-1"], channels: [BASE_CHANNEL] }),
    { createdChannelIds: ["chan-1"] }
  );

  assert.deepEqual(operations, [], "un canal aflat in snapshot e legitim, chiar daca a fost atins in incident");
});

test("o resursa deja disparuta nu produce o eliminare inutila (N-03)", () => {
  const operations = planRecovery(
    snapshotWith({}),
    stateWith({}),
    { createdChannelIds: ["chan-sters-intre-timp"], createdRoleIds: ["role-sters"] }
  );

  assert.deepEqual(operations, []);
});

test("fara starea completa a serverului, planul ramane la comportamentul pe ID-uri (N-03)", () => {
  const operations = planRecovery(
    snapshotWith({ channels: [BASE_CHANNEL] }),
    { channelIds: ["chan-1"], roleIds: [], webhookIds: [], inviteCodes: [], protections: emptyProtections() }
  );

  assert.deepEqual(operations, [], "un adaptor care nu raporteaza inca starea completa nu trebuie sa produca restaurari inventate");
});

test("restaurarea semantica ajunge la portul de editare, nu doar in plan (N-03)", async () => {
  const edited: Array<{ id: string; name: unknown }> = [];
  const deleted: string[] = [];
  const guild = moduleContext<Parameters<typeof adaptRecoveryGuild>[0]>({
    id: "g1",
    channels: {
      cache: {
        get: (id: string) => ({
          edit: async (payload: Record<string, unknown>) => { edited.push({ id, name: payload.name }); },
          delete: async () => { deleted.push(id); }
        }),
        values: () => []
      }
    },
    roles: { cache: { values: () => [{ id: "role-1", edit: async () => undefined, setPosition: async () => undefined }] } }
  });
  const port = adaptRecoveryGuild(guild, async () => ({}), async () => true, async () => undefined);

  assert.equal(await port?.restoreChannel(BASE_CHANNEL), true);
  assert.deepEqual(edited, [{ id: "chan-1", name: "anunturi" }]);
  assert.equal(await port?.restoreRole(BASE_ROLE), true);
  assert.equal(await port?.removeExtraResource("channel", "chan-raid"), true);
  assert.deepEqual(deleted, ["chan-raid"]);
});

test("o resursa care nu mai poate fi editata raporteaza esec, nu succes tacut (N-03)", async () => {
  const guild = moduleContext<Parameters<typeof adaptRecoveryGuild>[0]>({
    id: "g1",
    channels: { cache: { get: () => undefined, values: () => [] } },
    roles: { cache: { values: () => [] } }
  });
  const port = adaptRecoveryGuild(guild, async () => ({}), async () => true, async () => undefined);

  assert.equal(await port?.restoreChannel(BASE_CHANNEL), false);
  assert.equal(await port?.restoreRole(BASE_ROLE), false);
  assert.equal(await port?.removeExtraResource("role", "role-raid"), false);
});

function editableGuild(options: { positionFails?: boolean; withoutSetPosition?: boolean } = {}) {
  const edits: Array<Record<string, unknown>> = [];
  const positions: number[] = [];
  const guild = moduleContext<Parameters<typeof adaptRecoveryGuild>[0]>({
    id: "g1",
    channels: {
      cache: {
        get: () => ({ edit: async (payload: Record<string, unknown>) => { edits.push(payload); } }),
        values: () => []
      }
    },
    roles: {
      cache: {
        values: () => [{
          id: "role-1",
          edit: async (payload: Record<string, unknown>) => { edits.push(payload); },
          setPosition: options.withoutSetPosition
            ? undefined
            : async (position: number) => {
              if (options.positionFails) throw new Error("Missing Permissions");
              positions.push(position);
            }
        }]
      }
    }
  });
  return { port: adaptRecoveryGuild(guild, async () => ({}), async () => true, async () => undefined), edits, positions };
}

test("restaurarea rolului aplica si pozitia, nu doar proprietatile (review PR #995)", async () => {
  const setup = editableGuild();

  assert.equal(await setup.port?.restoreRole(BASE_ROLE), true);
  assert.deepEqual(setup.positions, [5],
    "diff-ul programeaza restore-role tocmai fiindca pozitia difera; fara aplicarea ei, ierarhia alterata ramane");
});

test("o pozitie de rol care nu poate fi aplicata NU e raportata ca succes (review PR #995)", async () => {
  const setup = editableGuild({ positionFails: true });

  assert.equal(await setup.port?.restoreRole(BASE_ROLE), false,
    "altfel incidentul se inchide cu ierarhia inca modificata de atacator");
});

test("un rol fara API de pozitionare nu raporteaza restaurare completa (review PR #995)", async () => {
  const setup = editableGuild({ withoutSetPosition: true });

  assert.equal(await setup.port?.restoreRole(BASE_ROLE), false);
});

test("un topic pus de atacator peste unul gol e sters, nu ignorat (review PR #995)", async () => {
  const setup = editableGuild();

  await setup.port?.restoreChannel({ ...BASE_CHANNEL, topic: null });

  assert.equal(setup.edits[0].topic, null,
    "`undefined` inseamna camp omis in discord.js, deci topicul malitios ar fi ramas iar operatiunea ar fi fost marcata done");
});

test("campurile nullable ale canalului se transmit ca null, nu ca omisiuni (review PR #995)", async () => {
  const setup = editableGuild();

  await setup.port?.restoreChannel({ ...BASE_CHANNEL, parentId: null, nsfw: null, rateLimitPerUser: null });

  assert.equal(setup.edits[0].parent, null);
  assert.equal(setup.edits[0].nsfw, null);
  assert.equal(setup.edits[0].rateLimitPerUser, null);
});

test("tipul canalului face parte din restaurare (review PR #995)", async () => {
  const setup = editableGuild();

  await setup.port?.restoreChannel(BASE_CHANNEL);

  assert.equal(setup.edits[0].type, 0, "un canal convertit text -> announcement isi pastreaza ID-ul, deci doar tipul il tradeaza");
});

test("conversia de tip a unui canal e detectata de diff (review PR #995)", () => {
  const operations = planRecovery(
    snapshotWith({ channels: [BASE_CHANNEL] }),
    stateWith({ channelIds: ["chan-1"], channels: [{ ...BASE_CHANNEL, channelType: 5 }] })
  );

  assert.deepEqual(operations.map(entry => entry.kind), ["restore-channel"]);
  assert.match(operations[0].label, /channelType/);
});

function positionHarness(options: { positioned?: boolean; repositionFails?: boolean } = {}) {
  const model = snapshotModel();
  const repositioned: Array<{ roleId: string; position: number }> = [];

  const guild = moduleContext<RecoveryGuildPort>({
    id: "g1",
    readCurrentState: async () => ({
      channelIds: [], roleIds: [], webhookIds: [], inviteCodes: [], protections: emptyProtections(), channels: [], roles: []
    }),
    recreateRole: async () => ({ roleId: "rol-nou", positioned: options.positioned ?? false }),
    restoreRolePosition: async (roleId: string, position: number) => {
      if (options.repositionFails) return false;
      repositioned.push({ roleId, position });
      return true;
    },
    publish: async () => undefined
  });

  return { runtime: createRaidRecoveryRuntime({ RaidSnapshotModel: model, now: () => NOW }), guild, model, repositioned };
}

const UNPOSITIONED_ROLE = { roleId: "role-vechi", name: "Staff", position: 7, color: 0, hoist: false, mentionable: false, managed: false, permissions: "0" };

test("un rol recreat fara pozitie tine recovery-ul incomplet (audit N-04)", async () => {
  const setup = positionHarness();
  await setup.runtime.captureBeforeContainment(
    moduleContext<RecoveryGuildPort>({ ...setup.guild, captureSnapshot: async () => snapshotWith({ roles: [UNPOSITIONED_ROLE] }) }),
    INCIDENT
  );

  const outcome = await setup.runtime.restore(setup.guild, INCIDENT);

  assert.equal(outcome.kind, "restored");
  assert.equal(outcome.kind === "restored" && outcome.complete, false,
    "recrearea reusita cu pozitie neaplicata nu are voie sa incheie recovery-ul");
  assert.ok(
    outcome.kind === "restored" && outcome.operations.some(entry => entry.kind === "restore-position" && entry.status === "pending"),
    "pozitia ramasa se urmareste ca operatiune proprie, nu se pierde"
  );
});

test("remap-ul rolului se persista chiar cand pozitia a esuat (audit N-04)", async () => {
  const setup = positionHarness();
  await setup.runtime.captureBeforeContainment(
    moduleContext<RecoveryGuildPort>({ ...setup.guild, captureSnapshot: async () => snapshotWith({ roles: [UNPOSITIONED_ROLE] }) }),
    INCIDENT
  );

  await setup.runtime.restore(setup.guild, INCIDENT);

  assert.deepEqual(
    setup.model.docs.get(INCIDENT)?.remaps,
    [{ previousId: "role-vechi", nextId: "rol-nou" }],
    "rolul exista pe server, deci overwrite-urile si rebindingul trebuie sa il poata folosi"
  );
});

test("la retry, pozitia ramasa e reincercata si recovery-ul se poate incheia (audit N-04)", async () => {
  const setup = positionHarness();
  await setup.runtime.captureBeforeContainment(
    moduleContext<RecoveryGuildPort>({ ...setup.guild, captureSnapshot: async () => snapshotWith({ roles: [UNPOSITIONED_ROLE] }) }),
    INCIDENT
  );
  await setup.runtime.restore(setup.guild, INCIDENT);

  const outcome = await setup.runtime.restore(setup.guild, INCIDENT);

  assert.deepEqual(setup.repositioned, [{ roleId: "rol-nou", position: 7 }]);
  assert.equal(outcome.kind === "restored" && outcome.complete, true, "dupa restaurarea pozitiei nu mai ramane nimic blocant");
});

test("o pozitie care nu poate fi aplicata nici la retry ajunge la owner (audit N-04)", async () => {
  const setup = positionHarness({ repositionFails: true });
  await setup.runtime.captureBeforeContainment(
    moduleContext<RecoveryGuildPort>({ ...setup.guild, captureSnapshot: async () => snapshotWith({ roles: [UNPOSITIONED_ROLE] }) }),
    INCIDENT
  );
  await setup.runtime.restore(setup.guild, INCIDENT);

  const outcome = await setup.runtime.restore(setup.guild, INCIDENT);

  assert.ok(
    outcome.kind === "restored" && outcome.operations.some(entry =>
      entry.kind === "restore-position" && entry.status === "owner-intervention-required"),
    "dupa incercari repetate, pozitia devine explicit sarcina ownerului"
  );
  assert.equal(outcome.kind === "restored" && outcome.complete, false);
});

test("un rol recreat si pozitionat nu adauga operatiuni suplimentare (audit N-04)", async () => {
  const setup = positionHarness({ positioned: true });
  await setup.runtime.captureBeforeContainment(
    moduleContext<RecoveryGuildPort>({ ...setup.guild, captureSnapshot: async () => snapshotWith({ roles: [UNPOSITIONED_ROLE] }) }),
    INCIDENT
  );

  const outcome = await setup.runtime.restore(setup.guild, INCIDENT);

  assert.equal(outcome.kind === "restored" && outcome.complete, true);
  assert.equal(
    outcome.kind === "restored" && outcome.operations.filter(entry => entry.kind === "restore-position").length,
    0,
    "cazul reusit nu trebuie sa lase in urma o operatiune care sa para nerezolvata"
  );
});
