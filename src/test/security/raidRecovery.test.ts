import test from "node:test";
import assert from "node:assert/strict";

import { createRaidRecoveryRuntime } from "../../features/command-security/raidRecoveryRuntime.js";
import { emptyProtections, emptySnapshot, planRecovery, recoveryComplete, remapOverwrites } from "../../features/command-security/raidSnapshotTypes.js";
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
