import test from "node:test";
import assert from "node:assert/strict";

import { createWebhookGuardRuntime } from "../../features/command-security/webhookGuardRuntime.js";
import { diffWebhooks } from "../../features/command-security/webhookGuardTypes.js";
import { createPermissionRequestRepository } from "../../features/command-security/permissionRequestRepository.js";
import { permissionRequestStore } from "./permissionRequestStore.js";
import { moduleContext } from "../moduleContextStub.js";
import type { WebhookGuardChannel, WebhookGuardDeps } from "../../features/command-security/webhookGuardRuntime.js";
import type { WebhookSnapshotEntry } from "../../features/command-security/webhookGuardTypes.js";
import type { WebhookSnapshotModelLike } from "../../features/command-security/webhookSnapshotRepository.js";

const NOW = Date.parse("2026-08-02T11:00:00.000Z");

function hook(webhookId: string, name: string, avatar: string | null = null): WebhookSnapshotEntry {
  return { webhookId, channelId: "chan-1", name, avatar, creatorId: "mod-1" };
}

function snapshotModel(seeded: readonly WebhookSnapshotEntry[] | null): WebhookSnapshotModelLike & { stored: WebhookSnapshotEntry[] | null } {
  const state: { stored: WebhookSnapshotEntry[] | null } = { stored: seeded ? [...seeded] : null };
  return {
    get stored() { return state.stored; },
    set stored(value: WebhookSnapshotEntry[] | null) { state.stored = value; },
    findOne() {
      return {
        lean: async () => (state.stored ? { _id: "g1:chan-1", entries: state.stored, capturedAt: new Date(NOW - 1000) } : null)
      };
    },
    async updateOne(_filter: Record<string, unknown>, update: Record<string, unknown>) {
      const set = update.$set as { entries?: WebhookSnapshotEntry[] };
      state.stored = [...(set.entries ?? [])];
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async deleteMany() { state.stored = null; return { deletedCount: 1 }; }
  };
}

interface Harness {
  runtime: ReturnType<typeof createWebhookGuardRuntime>;
  channel: WebhookGuardChannel;
  deleted: string[];
  edited: Array<{ webhookId: string; name: string }>;
  recreated: string[];
  removedRoles: string[];
  published: string[];
  audits: Array<{ action: string; details: string }>;
  model: ReturnType<typeof snapshotModel>;
}

function harness(options: {
  before: readonly WebhookSnapshotEntry[] | null;
  after: readonly WebhookSnapshotEntry[];
  actorId?: string | null;
  ownerId?: string | null;
  guardEnabled?: boolean;
  raidConfirmed?: boolean;
  approvals?: ReturnType<typeof permissionRequestStore>;
  reportRaidActor?: (guildId: string, actorId: string, surface: string) => Promise<unknown>;
}): Harness {
  const deleted: string[] = [];
  const edited: Array<{ webhookId: string; name: string }> = [];
  const recreated: string[] = [];
  const removedRoles: string[] = [];
  const published: string[] = [];
  const audits: Array<{ action: string; details: string }> = [];
  const model = snapshotModel(options.before);
  const approvals = options.approvals ?? permissionRequestStore();
  const requests = createPermissionRequestRepository(approvals);

  let live = [...options.after];

  const deps: WebhookGuardDeps = {
    WebhookSnapshotModel: model,
    gate: {
      readSituation: async () => ({
        guardEnabled: options.guardEnabled ?? true,
        raidConfirmed: options.raidConfirmed ?? false
      }),
      consumeApproval: async (guildId, actorId, channelId, action, webhookId) => {
        const onWebhook = action === "create"
          ? null
          : await requests.consume(guildId, "webhook", actorId, { target: webhookId, action }, new Date(NOW)).catch(() => null);
        return onWebhook ?? requests.consume(guildId, "webhook", actorId, { target: channelId, action }, new Date(NOW));
      }
    },
    publish: async (_guildId, message) => { published.push(message); },
    recordAudit: async (_guildId, entry) => { audits.push({ action: entry.action, details: entry.details }); },
    reportRaidActor: options.reportRaidActor,
    now: () => NOW
  };

  const channel = moduleContext<WebhookGuardChannel>({
    guildId: "g1",
    channelId: "chan-1",
    channelName: "anunturi",
    ownerId: options.ownerId ?? "owner-1",
    botHighestRolePosition: 10,
    everyoneRoleId: "everyone",
    listWebhooks: async () => [...live],
    findAuditActor: async () => (options.actorId === undefined ? "mod-1" : options.actorId),
    deleteWebhook: async (webhookId: string) => {
      deleted.push(webhookId);
      live = live.filter(entry => entry.webhookId !== webhookId);
    },
    editWebhook: async (webhookId: string, patch: { name: string }) => {
      edited.push({ webhookId, name: patch.name });
      live = live.map(entry => (entry.webhookId === webhookId ? { ...entry, name: patch.name } : entry));
    },
    recreateWebhook: async (entry: WebhookSnapshotEntry) => {
      recreated.push(entry.webhookId);
      live = [...live, { ...entry, webhookId: `${entry.webhookId}-nou` }];
      return `${entry.webhookId}-nou`;
    },
    resolveActor: async () => ({
      roles: [{ id: "role-mod", name: "Moderator", position: 5, managed: false, elevated: true }],
      removeRoles: async (ids: readonly string[]) => { removedRoles.push(...ids); }
    })
  });

  return { runtime: createWebhookGuardRuntime(deps), channel, deleted, edited, recreated, removedRoles, published, audits, model };
}

async function webhookApproval(action: string) {
  const model = permissionRequestStore();
  const repository = createPermissionRequestRepository(model);
  await repository.create({
    requestId: `req-${action}`, guildId: "g1", type: "webhook", requesterId: "mod-1",
    target: "chan-1", action, reason: "integrare"
  }, new Date(NOW - 60_000));
  await repository.resolve("g1", `req-${action}`, "approved", "owner-1", { target: "chan-1", action }, new Date(NOW - 60_000));
  return model;
}

test("diferenta de webhook-uri distinge creare, editare si stergere", () => {
  const changes = diffWebhooks(
    [hook("w1", "vechi"), hook("w2", "sters")],
    [hook("w1", "redenumit"), hook("w3", "nou")]
  );

  assert.deepEqual(changes.map(change => [change.kind, change.webhookId]), [
    ["update", "w1"],
    ["delete", "w2"],
    ["create", "w3"]
  ]);
});

test("prima observatie a unui canal doar captureaza baseline-ul, fara interventie", async () => {
  const setup = harness({ before: null, after: [hook("w1", "existent")] });

  const outcome = await setup.runtime.handleWebhookUpdate(setup.channel);

  assert.equal(outcome.kind, "baseline-captured");
  assert.deepEqual(setup.deleted, []);
  assert.deepEqual(setup.model.stored?.map(entry => entry.webhookId), ["w1"]);
});

test("cu moderation-guard oprit, webhook-urile sunt doar urmarite, nu corectate", async () => {
  const setup = harness({ before: [hook("w1", "vechi")], after: [hook("w1", "vechi"), hook("w2", "nou")], guardEnabled: false });

  const outcome = await setup.runtime.handleWebhookUpdate(setup.channel);

  assert.equal(outcome.kind, "guard-disabled");
  assert.deepEqual(setup.deleted, [], "fara poarta activa nu se modifica nimic pe server");
  assert.deepEqual(setup.model.stored?.map(entry => entry.webhookId), ["w1", "w2"], "baseline-ul urmeaza realitatea");
});

test("un webhook creat fara aprobare este sters si autorul sanctionat", async () => {
  const setup = harness({ before: [hook("w1", "vechi")], after: [hook("w1", "vechi"), hook("w2", "malitios")] });

  const outcome = await setup.runtime.handleWebhookUpdate(setup.channel);

  assert.equal(outcome.kind, "reverted");
  assert.deepEqual(setup.deleted, ["w2"]);
  assert.deepEqual(setup.removedRoles, ["role-mod"], "autorul pierde rolurile cu permisiuni ridicate");
  assert.equal(setup.audits[0]?.action, "webhook-change-reverted");
  assert.match(setup.published[0] ?? "", /<@mod-1>/);
  assert.deepEqual(setup.model.stored?.map(entry => entry.webhookId), ["w1"], "snapshotul revine la starea aprobata");
});

test("un webhook editat fara aprobare este restaurat din snapshot", async () => {
  const setup = harness({ before: [hook("w1", "Anunturi")], after: [hook("w1", "Payouts oficiale")] });

  const outcome = await setup.runtime.handleWebhookUpdate(setup.channel);

  assert.equal(outcome.kind, "reverted");
  assert.deepEqual(setup.edited, [{ webhookId: "w1", name: "Anunturi" }]);
});

test("un webhook sters fara aprobare este recreat, cu avertisment despre URL-ul nou", async () => {
  const setup = harness({ before: [hook("w1", "Anunturi")], after: [] });

  const outcome = await setup.runtime.handleWebhookUpdate(setup.channel);

  assert.equal(outcome.kind, "reverted");
  assert.deepEqual(setup.recreated, ["w1"]);
  assert.match(setup.published[0] ?? "", /URL nou/);
});

test("ownerul serverului poate modifica webhook-uri fara aprobare", async () => {
  const setup = harness({ before: [hook("w1", "vechi")], after: [hook("w1", "vechi"), hook("w2", "nou")], actorId: "owner-1" });

  const outcome = await setup.runtime.handleWebhookUpdate(setup.channel);

  assert.equal(outcome.kind, "allowed-owner");
  assert.deepEqual(setup.deleted, []);
});

test("o aprobare de tip webhook pentru actiunea exacta lasa modificarea sa treaca si se consuma", async () => {
  const approvals = await webhookApproval("create");
  const setup = harness({ before: [hook("w1", "vechi")], after: [hook("w1", "vechi"), hook("w2", "integrare")], approvals });

  const outcome = await setup.runtime.handleWebhookUpdate(setup.channel);

  assert.equal(outcome.kind, "allowed-approval");
  assert.deepEqual(setup.deleted, []);
  assert.equal(approvals.records[0].status, "used", "aprobarea este de unica folosinta");
});

test("o aprobare pentru o singura actiune nu acopera si celelalte modificari din acelasi eveniment", async () => {
  const approvals = await webhookApproval("create");
  const setup = harness({
    before: [hook("w1", "Anunturi"), hook("w2", "Statistici")],
    after: [hook("w1", "Anunturi"), hook("w2", "Payouts"), hook("w3", "integrare")],
    approvals
  });

  const outcome = await setup.runtime.handleWebhookUpdate(setup.channel);

  assert.equal(outcome.kind, "reverted");
  assert.deepEqual(setup.deleted, [], "crearea aprobata ramane");
  assert.deepEqual(setup.edited, [{ webhookId: "w2", name: "Statistici" }], "editarea neaprobata este revenita");
});

test("in timpul unui raid confirmat, webhook-ul E sters si autorul intra in incident (audit, F-30)", async () => {
  const escalated: string[] = [];
  const setup = harness({
    before: [hook("w1", "vechi")],
    after: [hook("w1", "vechi"), hook("w2", "nou")],
    raidConfirmed: true,
    reportRaidActor: async (_guildId: string, actorId: string) => { escalated.push(actorId); return true; }
  });

  const outcome = await setup.runtime.handleWebhookUpdate(setup.channel);

  assert.equal(outcome.kind, "reverted");
  assert.deepEqual(setup.deleted, ["w2"], "anti-raid nu asculta webhookUpdate, deci nimeni nu ar fi corectat");
  assert.deepEqual(escalated, ["mod-1"]);
  assert.equal(setup.audits[0]?.action, "webhook-change-reverted-in-raid");
});

test("cand autorul nu poate fi identificat din Audit Log, nu se sanctioneaza nimeni", async () => {
  const setup = harness({ before: [hook("w1", "vechi")], after: [hook("w1", "vechi"), hook("w2", "nou")], actorId: null });

  const outcome = await setup.runtime.handleWebhookUpdate(setup.channel);

  assert.equal(outcome.kind, "actor-unknown");
  assert.deepEqual(setup.removedRoles, []);
  assert.deepEqual(setup.deleted, []);
});

test("o corectie esuata este raportata explicit, fara sa opreasca restul", async () => {
  const setup = harness({ before: [hook("w1", "Anunturi"), hook("w2", "Statistici")], after: [] });
  const channel = moduleContext<WebhookGuardChannel>({
    ...setup.channel,
    recreateWebhook: async (entry: WebhookSnapshotEntry) => (entry.webhookId === "w1" ? null : "w2-nou")
  });

  const outcome = await setup.runtime.handleWebhookUpdate(channel);

  assert.equal(outcome.kind, "reverted");
  assert.equal(outcome.kind === "reverted" ? outcome.failed : -1, 1);
  assert.match(setup.published[0] ?? "", /1 din 2 modificari NU au putut fi corectate/);
});

async function approvalsFor(entries: readonly { id: string; target: string; action: string }[]) {
  const model = permissionRequestStore();
  const repository = createPermissionRequestRepository(model);
  for (const entry of entries) {
    await repository.create({
      requestId: entry.id, guildId: "g1", type: "webhook", requesterId: "mod-1",
      target: entry.target, action: entry.action, reason: "integrare"
    }, new Date(NOW - 60_000));
    await repository.resolve("g1", entry.id, "approved", "owner-1", { target: entry.target, action: entry.action }, new Date(NOW - 60_000));
  }
  return model;
}

test("o singura aprobare de creare nu acopera doua webhook-uri create (F-47)", async () => {
  const approvals = await approvalsFor([{ id: "req-1", target: "chan-1", action: "create" }]);
  const setup = harness({
    before: [hook("w1", "existent")],
    after: [hook("w1", "existent"), hook("w2", "nou-a"), hook("w3", "nou-b")],
    approvals
  });

  const outcome = await setup.runtime.handleWebhookUpdate(setup.channel);

  assert.equal(outcome.kind, "reverted", "aprobarea consumata acopera o singura operatiune, nu tot lotul de acelasi tip");
  assert.equal(setup.deleted.length, 1, "exact un webhook ramane acoperit de aprobare; celalalt se sterge");
  assert.equal(approvals.records.filter(record => record.status === "used").length, 1);
});

test("doua aprobari de creare acopera exact doua webhook-uri create (F-47)", async () => {
  const approvals = await approvalsFor([
    { id: "req-1", target: "chan-1", action: "create" },
    { id: "req-2", target: "chan-1", action: "create" }
  ]);
  const setup = harness({
    before: [hook("w1", "existent")],
    after: [hook("w1", "existent"), hook("w2", "nou-a"), hook("w3", "nou-b")],
    approvals
  });

  const outcome = await setup.runtime.handleWebhookUpdate(setup.channel);

  assert.equal(outcome.kind, "allowed-approval");
  assert.deepEqual(setup.deleted, [], "cate o aprobare pentru fiecare operatiune inseamna lot acoperit complet");
  assert.equal(approvals.records.filter(record => record.status === "used").length, 2);
});

test("o aprobare de stergere legata de un webhook anume nu acopera stergerea altuia (F-47)", async () => {
  const approvals = await approvalsFor([{ id: "req-1", target: "w1", action: "delete" }]);
  const setup = harness({
    before: [hook("w1", "permis"), hook("w2", "protejat")],
    after: [],
    approvals
  });

  const outcome = await setup.runtime.handleWebhookUpdate(setup.channel);

  assert.equal(outcome.kind, "reverted");
  assert.deepEqual(setup.recreated, ["w2"], "aprobarea pe w1 nu are voie sa acopere stergerea lui w2");
});

test("aprobarea legata de un webhook acopera si modificarea aceluiasi webhook (F-47)", async () => {
  const approvals = await approvalsFor([{ id: "req-1", target: "w1", action: "update" }]);
  const setup = harness({
    before: [hook("w1", "vechi")],
    after: [hook("w1", "redenumit")],
    approvals
  });

  const outcome = await setup.runtime.handleWebhookUpdate(setup.channel);

  assert.equal(outcome.kind, "allowed-approval");
  assert.deepEqual(setup.edited, []);
});

test("un lot mixt consuma aprobari separate per operatiune, restul se corecteaza (F-47)", async () => {
  const approvals = await approvalsFor([{ id: "req-1", target: "w1", action: "update" }]);
  const setup = harness({
    before: [hook("w1", "vechi"), hook("w2", "protejat")],
    after: [hook("w1", "redenumit"), hook("w3", "nou")],
    approvals
  });

  const outcome = await setup.runtime.handleWebhookUpdate(setup.channel);

  assert.equal(outcome.kind, "reverted");
  assert.deepEqual(setup.edited, [], "update-ul aprobat ramane");
  assert.deepEqual(setup.recreated, ["w2"], "stergerea neaprobata se corecteaza");
  assert.deepEqual(setup.deleted, ["w3"], "crearea neaprobata se corecteaza");
});
