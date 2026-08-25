import test from "node:test";
import assert from "node:assert/strict";

import { createAntiRaidRuntime } from "../../features/command-security/antiRaidRuntime.js";
import { createRaidIncidentRepository } from "../../features/command-security/antiRaidIncidentRepository.js";
import { raidIncidentStore } from "./raidIncidentStore.js";

import type { RaidGuildPort } from "../../features/command-security/antiRaidIntervention.js";

const T0 = Date.parse("2026-08-01T12:00:00.000Z");

function harness(options: {
  thresholds?: Record<string, unknown> | null;
  enabled?: boolean;
  resolvable?: boolean;
  dryRun?: boolean;
  structureActor?: { id: string; bot: boolean } | null;
  ownerId?: string;
  approvedStructure?: boolean;
} = {}) {
  const model = raidIncidentStore();
  const incidents = createRaidIncidentRepository(model);
  const locked: string[] = [];
  const sanctions: Array<{ userId: string; step: string }> = [];
  const published: string[] = [];
  let approvalChecks = 0;
  let clock = T0;

  const baselineCalls: string[] = [];
  const guild: RaidGuildPort = {
    id: "g1",
    freezeStructureBaseline: async () => { baselineCalls.push("freeze"); return true; },
    releaseStructureBaseline: async () => { baselineCalls.push("release"); return true; },
    refreshStructureBaseline: async () => { baselineCalls.push("refresh"); return true; },
    lockChannel: async channelId => { locked.push(channelId); return { locked: true, previousSendMessages: true }; },
    unlockChannel: async () => true,
    applySanction: async (userId, step) => { sanctions.push({ userId, step }); return { applied: true, retryable: false, error: null }; },
    purgeMessages: async () => ({ deleted: 0, unreachable: 0 }),
    publish: async body => { published.push(body); return undefined; },
    alertOwner: async body => { published.push(body); return undefined; }
  };

  const runtime = createAntiRaidRuntime({
    RaidIncidentModel: model,
    readGuildSettings: async () => ({ antiRaidThresholds: options.thresholds ?? null, antiRaidEnabled: options.enabled !== false, antiRaidDryRunEnabled: options.dryRun === true }),
    findStructureActor: async () => options.structureActor ?? null,
    isGuildOwner: async (_guildId, actorId) => options.ownerId === actorId,
    consumeStructureApproval: async () => {
      approvalChecks += 1;
      return options.approvedStructure === true;
    },
    resolveGuild: async () => (options.resolvable === false ? null : guild),
    now: () => clock
  });

  return {
    runtime,
    incidents,
    model,
    baselineCalls,
    locked,
    sanctions,
    published,
    guildPort: guild,
    approvalCount: () => approvalChecks,
    advance: (ms: number) => { clock += ms; },
    clockAt: () => clock
  };
}

function message(overrides: Record<string, unknown> = {}) {
  return {
    actorId: "u1", bot: false, channelId: "c1", content: "reclama ieftina",
    mentionCount: 0, attachmentCount: 0, at: T0,
    ...overrides
  };
}

test("un mesaj obisnuit nu deschide niciun incident", async () => {
  const setup = harness();
  const outcome = await setup.runtime.observeMessage("g1", message({ content: "salut tuturor" }));

  assert.deepEqual(outcome, { kind: "quiet" });
  assert.equal(setup.model.records.length, 0);
});

test("un mesaj fara autor e ignorat, fara sa atinga detectorul", async () => {
  const setup = harness();
  const outcome = await setup.runtime.observeMessage("g1", message({ actorId: "" }));

  assert.deepEqual(outcome, { kind: "ignored" });
});

test("trei mesaje identice deschid un incident, il blocheaza si sanctioneaza autorul", async () => {
  const setup = harness();
  await setup.runtime.observeMessage("g1", message({ at: T0 }));
  await setup.runtime.observeMessage("g1", message({ at: T0 + 1_000 }));
  const outcome = await setup.runtime.observeMessage("g1", message({ at: T0 + 2_000 }));

  assert.equal(outcome.kind, "opened");
  assert.equal(outcome.kind === "opened" && outcome.participants.includes("u1"), true);
  assert.match(outcome.kind === "opened" ? outcome.reason : "", /mesaje identice/);
  assert.deepEqual(setup.locked, ["c1"]);
  assert.deepEqual(setup.sanctions, [{ userId: "u1", step: "mute" }]);
  assert.match(setup.published[0], /raid confirmat/);
});

test("al doilea val nu deschide un incident nou, ci alimenteaza pe cel activ", async () => {
  const setup = harness();
  for (const offset of [0, 1_000, 2_000]) await setup.runtime.observeMessage("g1", message({ at: T0 + offset }));

  const outcome = await setup.runtime.observeMessage("g1", message({ actorId: "u2", content: "alt spam", at: T0 + 3_000 }));

  assert.equal(outcome.kind, "existing");
  assert.equal((await setup.incidents.history("g1")).length, 1, "un al doilea incident ar imparti lockdown-ul in doua");
});

test("modificarile de structura declanseaza incidentul si numesc motivul", async () => {
  const setup = harness();
  await setup.runtime.observeStructureChange("g1", "c1", { id: "mod-1", bot: false });
  await setup.runtime.observeStructureChange("g1", "c2", { id: "mod-1", bot: false });
  const outcome = await setup.runtime.observeStructureChange("g1", "c3", { id: "mod-1", bot: false });

  assert.equal(outcome.kind, "opened");
  assert.match(outcome.kind === "opened" ? outcome.reason : "", /canale create ori sterse/);
  assert.deepEqual(setup.sanctions, [{ userId: "mod-1", step: "mute" }]);
});

test("o modificare de structura cu autor neconfirmat e ignorata", async () => {
  const setup = harness();
  const outcome = await setup.runtime.observeStructureChange("g1", "c1");

  assert.deepEqual(outcome, { kind: "ignored" });
  assert.equal(setup.model.records.length, 0);
});

test("un bot intrat in timpul unui raid confirmat primeste direct ban", async () => {
  const setup = harness();
  for (const offset of [0, 1_000, 2_000]) await setup.runtime.observeMessage("g1", message({ at: T0 + offset }));
  setup.sanctions.length = 0;

  const outcome = await setup.runtime.observeBotJoin("g1", "bot-nou");

  assert.equal(outcome.kind, "existing");
  assert.deepEqual(setup.sanctions, [{ userId: "bot-nou", step: "ban" }]);
});

test("un bot intrat fara raid activ nu e atins", async () => {
  const setup = harness();
  const outcome = await setup.runtime.observeBotJoin("g1", "bot-nou");

  assert.deepEqual(outcome, { kind: "quiet" });
  assert.deepEqual(setup.sanctions, []);
});

test("isRaidConfirmed devine adevarat abia dupa confirmare si redevine fals dupa inchidere", async () => {
  const setup = harness();
  assert.equal(await setup.runtime.isRaidConfirmed("g1"), false);

  await setup.incidents.open({ guildId: "g1", triggerReason: "suspiciune" }, new Date(T0));
  assert.equal(await setup.runtime.isRaidConfirmed("g1"), false, "o simpla suspiciune nu suspenda moderation-guard");

  const incident = await setup.incidents.active("g1");
  await setup.incidents.advance(incident?._id ?? "", "suspected", "containment", new Date(T0));
  assert.equal(await setup.runtime.isRaidConfirmed("g1"), true);

  await setup.incidents.advance(incident?._id ?? "", "containment", "resolved", new Date(T0));
  assert.equal(await setup.runtime.isRaidConfirmed("g1"), false, "dupa inchidere, celelalte protectii reintra in functiune");
});

test("pragurile stramte ale ownerului schimba momentul confirmarii", async () => {
  const setup = harness({ thresholds: { identicalMessages: 2 } });
  await setup.runtime.observeMessage("g1", message({ at: T0 }));
  const outcome = await setup.runtime.observeMessage("g1", message({ at: T0 + 1_000 }));

  assert.equal(outcome.kind, "opened", "cu prag de 2, al doilea mesaj identic declanseaza deja");
});

test("cand serverul nu poate fi rezolvat, incidentul se salveaza dar nu se pretinde ca s-a intervenit", async () => {
  const setup = harness({ resolvable: false });
  for (const offset of [0, 1_000, 2_000]) await setup.runtime.observeMessage("g1", message({ at: T0 + offset }));

  assert.equal((await setup.incidents.active("g1")) !== null, true, "incidentul ramane persistat pentru o incercare ulterioara");
  assert.deepEqual(setup.locked, []);
  assert.deepEqual(setup.sanctions, []);
});

test("tick continua un incident existent si nu inventeaza unul nou", async () => {
  const setup = harness();
  assert.deepEqual(await setup.runtime.tick("g1"), { kind: "quiet" });

  await setup.incidents.open({ guildId: "g1", triggerReason: "spam" }, new Date(T0));
  const outcome = await setup.runtime.tick("g1");

  assert.equal(outcome.kind, "existing");
  assert.equal((await setup.incidents.active("g1"))?.stage, "containment", "tick-ul impinge incidentul mai departe");
});

test("doua servere au detectoare separate", async () => {
  const setup = harness();
  await setup.runtime.observeMessage("g1", message({ at: T0 }));
  await setup.runtime.observeMessage("g2", message({ at: T0 + 1_000 }));
  const outcome = await setup.runtime.observeMessage("g2", message({ at: T0 + 2_000 }));

  assert.equal(outcome.kind, "quiet", "mesajele de pe alt server nu se aduna in acelasi cos");
  assert.equal(setup.model.records.length, 0);
});

test("detectorul unui server linistit e uitat, deci memoria nu creste cu fiecare server", async () => {
  const setup = harness();
  await setup.runtime.observeMessage("g1", message({ at: T0 }));
  await setup.runtime.observeMessage("g1", message({ at: T0 + 1_000 }));

  setup.advance(20 * 60_000);
  const outcome = await setup.runtime.observeMessage("g1", message({ at: setup.clockAt() }));

  assert.deepEqual(outcome, { kind: "quiet" }, "dupa liniste prelungita, semnalele vechi nu mai conteaza");
});

test("identitatea de bot se pastreaza pentru fiecare participant, nu doar pentru autorul ultimului mesaj", async () => {
  const setup = harness({ thresholds: { identicalMessages: 2 } });
  await setup.runtime.observeMessage("g1", message({ actorId: "bot-spam", bot: true, content: "cumpara acum", at: T0 }));
  await setup.runtime.observeMessage("g1", message({ actorId: "bot-spam", bot: true, content: "cumpara acum", at: T0 + 1_000 }));
  await setup.runtime.observeMessage("g1", message({ actorId: "om", bot: false, content: "cumpara acum", at: T0 + 2_000 }));
  await setup.runtime.observeMessage("g1", message({ actorId: "om", bot: false, content: "cumpara acum", at: T0 + 3_000 }));

  const incident = await setup.incidents.active("g1");
  const bot = incident?.participants.find(entry => entry.userId === "bot-spam");
  const human = incident?.participants.find(entry => entry.userId === "om");

  assert.equal(bot?.bot, true, "un bot observat mai devreme nu are voie sa intre in scara umana mute/timeout");
  assert.equal(human?.bot, false);
  assert.ok(setup.sanctions.some(entry => entry.userId === "bot-spam" && entry.step === "ban"));
  assert.ok(setup.sanctions.some(entry => entry.userId === "om" && entry.step === "mute"));
});

test("modul dry-run configurat de owner ajunge pe incidentul deschis automat", async () => {
  const setup = harness({ dryRun: true });
  for (const offset of [0, 1_000, 2_000]) await setup.runtime.observeMessage("g1", message({ at: T0 + offset }));

  const incident = await setup.incidents.active("g1");
  assert.equal(incident?.dryRun, true, "fara asta, /start anti-raid-dry-run nu ar avea niciun efect asupra incidentelor reale");
  assert.deepEqual(setup.locked, []);
  assert.deepEqual(setup.sanctions, []);
});

test("sweep-ul impinge incidentele active si le ignora pe cele inchise", async () => {
  const setup = harness();
  await setup.incidents.open({ guildId: "g1", triggerReason: "spam" }, new Date(T0));
  const closed = await setup.incidents.open({ guildId: "g2", triggerReason: "spam" }, new Date(T0));
  await setup.incidents.advance(closed?._id ?? "", "suspected", "resolved", new Date(T0));

  const driven = await setup.runtime.sweep();

  assert.deepEqual(driven, ["g1"], "fara un ciclu periodic, un incident ramane blocat cand atacul se opreste");
  assert.equal((await setup.incidents.active("g1"))?.stage, "containment");
});

test("modificarile de structura folosesc autorul din Audit Log cand nu e dat explicit", async () => {
  const setup = harness({ structureActor: { id: "mod-audit", bot: false } });
  await setup.runtime.observeStructureChange("g1", "c1");
  await setup.runtime.observeStructureChange("g1", "c2");
  const outcome = await setup.runtime.observeStructureChange("g1", "c3");

  assert.equal(outcome.kind, "opened");
  assert.deepEqual(setup.sanctions, [{ userId: "mod-audit", step: "mute" }]);
});

test("fara activare explicita, detectorul nu acumuleaza nimic (audit, F-24)", async () => {
  const setup = harness({ enabled: false });

  for (let index = 0; index < 5; index += 1) {
    const outcome = await setup.runtime.observeMessage("g1", {
      actorId: "spammer",
      bot: false,
      channelId: "chan-1",
      content: "acelasi mesaj",
      mentionCount: 0,
      attachmentCount: 0,
      at: T0 + index * 1000
    });
    assert.deepEqual(outcome, { kind: "ignored" });
  }

  assert.equal(await setup.incidents.active("g1"), null, "niciun incident nu se deschide cat timp anti-raid nu e pornit");
});

test("modul de testare dry-run tine detectorul activ chiar fara /start anti-raid", async () => {
  const setup = harness({ enabled: false, dryRun: true });

  const outcome = await setup.runtime.observeMessage("g1", {
    actorId: "spammer",
    bot: false,
    channelId: "chan-1",
    content: "acelasi mesaj",
    mentionCount: 0,
    attachmentCount: 0,
    at: T0
  });

  assert.notDeepEqual(outcome, { kind: "ignored" });
});

test("un bot adaugat in raid: botul e participant, iar cel care l-a adaugat e sanctionat si numit (F-33)", async () => {
  const setup = harness();
  const stripped: Array<{ userId: string }> = [];
  setup.guildPort.findBotAdder = async () => "vinovat";
  setup.guildPort.stripElevatedRoles = async (userId: string) => {
    stripped.push({ userId });
    return { removed: ["Admin"], blocked: ["Integrare"] };
  };

  await setup.incidents.open({ guildId: "g1", triggerReason: "spam" }, new Date(T0));
  const incident = await setup.incidents.active("g1");
  await setup.incidents.advance(incident?._id ?? "", "suspected", "confirmed", new Date(T0));

  await setup.runtime.observeBotJoin("g1", "bot-9");

  assert.deepEqual(stripped, [{ userId: "vinovat" }], "autorul pierde rolurile ridicate, nu doar botul e banat");
  const message = setup.published.find(entry => entry.includes("<@vinovat>")) ?? "";
  assert.match(message, /<@bot-9>/, "incidentul numeste si botul, si autorul");
  assert.match(message, /Roluri eliminate: Admin/);
  assert.match(message, /NU au putut fi eliminate: Integrare/);
});

test("fara autor identificabil in Audit Log, botul e tratat dar nu se sanctioneaza nimeni la intamplare (F-33)", async () => {
  const setup = harness();
  const stripped: string[] = [];
  setup.guildPort.findBotAdder = async () => null;
  setup.guildPort.stripElevatedRoles = async (userId: string) => {
    stripped.push(userId);
    return { removed: [], blocked: [] };
  };

  await setup.incidents.open({ guildId: "g1", triggerReason: "spam" }, new Date(T0));
  const incident = await setup.incidents.active("g1");
  await setup.incidents.advance(incident?._id ?? "", "suspected", "confirmed", new Date(T0));

  await setup.runtime.observeBotJoin("g1", "bot-9");

  assert.deepEqual(stripped, []);
});

test("schimbarea pragurilor rebuildeaza detectorul, chiar pe un server activ (review #943)", async () => {
  let stored: Record<string, unknown> | null = { identicalMessages: 50 };
  const model = raidIncidentStore();
  const incidents = createRaidIncidentRepository(model);
  const runtime = createAntiRaidRuntime({
    RaidIncidentModel: model,
    readGuildSettings: async () => ({ antiRaidThresholds: stored, antiRaidEnabled: true }),
    resolveGuild: async () => null,
    now: () => T0
  });

  for (let index = 0; index < 4; index += 1) {
    await runtime.observeMessage("g1", {
      actorId: "spammer", bot: false, channelId: "chan-1", content: "identic",
      mentionCount: 0, attachmentCount: 0, at: T0 + index * 100
    });
  }
  assert.equal(await incidents.active("g1"), null, "cu pragul la 50 nu se deschide nimic");

  stored = { identicalMessages: 2 };
  for (let index = 0; index < 3; index += 1) {
    await runtime.observeMessage("g1", {
      actorId: "spammer", bot: false, channelId: "chan-1", content: "identic",
      mentionCount: 0, attachmentCount: 0, at: T0 + 1000 + index * 100
    });
  }

  assert.notEqual(await incidents.active("g1"), null, "pragul nou se aplica imediat, nu dupa 10 minute de inactivitate");
});

test("incidentul NU se inchide cat timp restaurarea structurii cere interventia ownerului (F-32)", async () => {
  const setup = harness();
  setup.guildPort.restoreStructure = async () => ({ complete: false, blocked: 2 });

  await setup.incidents.open({ guildId: "g1", triggerReason: "spam" }, new Date(T0));
  const incident = await setup.incidents.active("g1");
  const id = incident?._id ?? "";
  await setup.incidents.advance(id, "suspected", "confirmed", new Date(T0));
  await setup.incidents.advance(id, "confirmed", "containment", new Date(T0));
  await setup.incidents.advance(id, "containment", "cleanup", new Date(T0));
  await setup.incidents.advance(id, "cleanup", "recovery", new Date(T0));
  setup.advance(60 * 60_000);

  await setup.runtime.tick("g1");

  const after = await setup.incidents.read(id);
  assert.equal(after?.stage, "recovery", "un server ramas deteriorat nu poate fi marcat rezolvat");
  assert.ok(setup.published.some(entry => entry.includes("2 operatiuni cer interventia ownerului")));
});

test("cu structura restaurata complet, incidentul se inchide (F-32)", async () => {
  const setup = harness();
  setup.guildPort.restoreStructure = async () => ({ complete: true, blocked: 0 });

  await setup.incidents.open({ guildId: "g1", triggerReason: "spam" }, new Date(T0));
  const incident = await setup.incidents.active("g1");
  const id = incident?._id ?? "";
  await setup.incidents.advance(id, "suspected", "confirmed", new Date(T0));
  await setup.incidents.advance(id, "confirmed", "containment", new Date(T0));
  await setup.incidents.advance(id, "containment", "cleanup", new Date(T0));
  await setup.incidents.advance(id, "cleanup", "recovery", new Date(T0));
  setup.advance(60 * 60_000);

  await setup.runtime.tick("g1");

  assert.equal((await setup.incidents.read(id))?.stage, "resolved");
});

test("snapshotul structurii se captureaza la trecerea in containment, inainte de lockdown (F-31)", async () => {
  const setup = harness();
  const captured: string[] = [];
  setup.guildPort.captureStructureSnapshot = async (incidentId: string) => {
    assert.deepEqual(setup.locked, [], "snapshotul trebuie luat INAINTE sa blocam canale");
    captured.push(incidentId);
    return undefined;
  };

  await setup.incidents.open({ guildId: "g1", triggerReason: "spam" }, new Date(T0));
  const incident = await setup.incidents.active("g1");
  const id = incident?._id ?? "";
  await setup.incidents.advance(id, "suspected", "confirmed", new Date(T0));

  await setup.runtime.tick("g1");

  assert.deepEqual(captured, [id]);
});

test("modificarile de structura facute de owner nu deschid incident (F-36)", async () => {
  const setup = harness({ ownerId: "owner-1" });

  for (const resourceId of ["c1", "c2", "c3"]) {
    const outcome = await setup.runtime.observeStructureChange("g1", resourceId, { id: "owner-1", bot: false }, { surface: "channel", action: "delete" });
    assert.deepEqual(outcome, { kind: "ignored" }, "ownerul isi reorganizeaza serverul, nu il ataca");
  }

  assert.equal(setup.model.records.length, 0);
});

test("o modificare de structura cu aprobare activa e consumata si nu devine semnal (F-36)", async () => {
  const setup = harness({ approvedStructure: true });

  for (const resourceId of ["c1", "c2", "c3"]) {
    const outcome = await setup.runtime.observeStructureChange("g1", resourceId, { id: "mod-1", bot: false }, { surface: "channel", action: "delete" });
    assert.deepEqual(outcome, { kind: "ignored" });
  }

  assert.equal(setup.approvalCount(), 3, "aprobarea se verifica INAINTE de inregistrarea semnalului, pentru fiecare modificare");
  assert.equal(setup.model.records.length, 0, "o operatiune aprobata nu are voie sa fie tratata ca raid");
});

test("fara aprobare, aceleasi trei modificari deschid incidentul (F-36)", async () => {
  const setup = harness({ approvedStructure: false });

  await setup.runtime.observeStructureChange("g1", "c1", { id: "mod-1", bot: false }, { surface: "channel", action: "delete" });
  await setup.runtime.observeStructureChange("g1", "c2", { id: "mod-1", bot: false }, { surface: "channel", action: "delete" });
  const outcome = await setup.runtime.observeStructureChange("g1", "c3", { id: "mod-1", bot: false }, { surface: "channel", action: "delete" });

  assert.equal(outcome.kind, "opened");
});

test("doua canale si un rol nu declanseaza un raid fals prin runtime (F-36)", async () => {
  const setup = harness();

  await setup.runtime.observeStructureChange("g1", "c1", { id: "mod-1", bot: false }, { surface: "channel", action: "create" });
  await setup.runtime.observeStructureChange("g1", "c2", { id: "mod-1", bot: false }, { surface: "channel", action: "create" });
  const outcome = await setup.runtime.observeStructureChange("g1", "r1", { id: "mod-1", bot: false }, { surface: "role", action: "create" });

  assert.notEqual(outcome.kind, "opened", "pragul e 3 canale SAU 3 roluri, nu 3 modificari amestecate");
});

test("pe calea garzii de structura, suprafata si actiunea reale ajung la anti-raid (review PR #965)", async () => {
  const setup = harness();

  await setup.runtime.observeStructureChange("g1", "r1", { id: "mod-1", bot: false }, { surface: "role", action: "delete", approvalChecked: true });
  await setup.runtime.observeStructureChange("g1", "r2", { id: "mod-1", bot: false }, { surface: "role", action: "delete", approvalChecked: true });
  const outcome = await setup.runtime.observeStructureChange("g1", "r3", { id: "mod-1", bot: false }, { surface: "role", action: "delete", approvalChecked: true });

  assert.equal(outcome.kind, "opened");
  assert.match(outcome.kind === "opened" ? outcome.reason : "", /roluri create ori sterse/,
    "fara suprafata propagata, evenimentele de rol cadeau pe channel-structure");
});

test("cand garda a verificat deja aprobarea, anti-raid nu mai consuma inca una (review PR #965)", async () => {
  const setup = harness({ approvedStructure: true });

  const outcome = await setup.runtime.observeStructureChange(
    "g1",
    "c1",
    { id: "mod-1", bot: false },
    { surface: "channel", action: "delete", approvalChecked: true }
  );

  assert.equal(setup.approvalCount(), 0, "a doua cautare de aprobare putea consuma o aprobare de create pentru aceeasi resursa");
  assert.notEqual(outcome.kind, "ignored", "semnalul trebuie inregistrat: garda deja a stabilit ca nu era autorizat");
});

test("un participant deja cunoscut care continua raidul reseteaza perioada de siguranta (F-38)", async () => {
  const setup = harness({ thresholds: { identicalMessages: 2, identicalWindowMs: 60_000 } });

  await setup.runtime.observeMessage("g1", message({ actorId: "u1", content: "cumpara acum ieftin" }));
  const opened = await setup.runtime.observeMessage("g1", message({ actorId: "u1", content: "cumpara acum ieftin", at: T0 + 1_000 }));
  assert.equal(opened.kind, "opened");

  const incidentId = opened.kind === "opened" ? opened.incidentId : "";
  const before = (await setup.incidents.read(incidentId))?.lastActivityAt;

  setup.advance(10 * 60_000);
  await setup.runtime.observeMessage("g1", message({ actorId: "u1", content: "salut tuturor", at: setup.clockAt() }));

  const after = (await setup.incidents.read(incidentId))?.lastActivityAt;
  assert.ok(
    after && before && new Date(after).getTime() > new Date(before).getTime(),
    "un raid care continua prin aceiasi participanti ajungea prematur in recovery, fiindca nimic nu marca activitatea"
  );
});

test("un mesaj al cuiva strain de incident NU prelungeste perioada de siguranta (F-38)", async () => {
  const setup = harness({ thresholds: { identicalMessages: 2, identicalWindowMs: 60_000 } });

  await setup.runtime.observeMessage("g1", message({ actorId: "u1", content: "cumpara acum ieftin" }));
  const opened = await setup.runtime.observeMessage("g1", message({ actorId: "u1", content: "cumpara acum ieftin", at: T0 + 1_000 }));
  const incidentId = opened.kind === "opened" ? opened.incidentId : "";
  const before = (await setup.incidents.read(incidentId))?.lastActivityAt;

  setup.advance(10 * 60_000);
  await setup.runtime.observeMessage("g1", message({ actorId: "strain", content: "ce faceti?", at: setup.clockAt() }));

  const after = (await setup.incidents.read(incidentId))?.lastActivityAt;
  assert.equal(
    new Date(after ?? 0).getTime(),
    new Date(before ?? 0).getTime(),
    "conversatia obisnuita a altcuiva nu are voie sa tina lockdown-ul activ la nesfarsit"
  );
});

test("un mesaj obisnuit al altcuiva NU prelungeste incidentul doar fiindca fereastra e inca declansata (review PR #970)", async () => {
  const setup = harness({ thresholds: { identicalMessages: 2, identicalWindowMs: 300_000 }, resolvable: false });

  await setup.runtime.observeMessage("g1", message({ actorId: "u1", content: "cumpara acum ieftin" }));
  const opened = await setup.runtime.observeMessage("g1", message({ actorId: "u1", content: "cumpara acum ieftin", at: T0 + 1_000 }));
  const incidentId = opened.kind === "opened" ? opened.incidentId : "";
  const before = (await setup.incidents.read(incidentId))?.lastActivityAt;

  setup.advance(60_000);
  await setup.runtime.observeMessage("g1", message({ actorId: "trecator", content: "ce faceti pe aici", at: setup.clockAt() }));

  const after = (await setup.incidents.read(incidentId))?.lastActivityAt;
  assert.equal(
    new Date(after ?? 0).getTime(),
    new Date(before ?? 0).getTime(),
    "verdict.triggered descrie toata fereastra retinuta, nu mesajul curent: legat de el, orice trecator amana recovery-ul"
  );
});

test("baseline-ul e inghetat la deschiderea incidentului, nu la confirmare (N-02)", async () => {
  const setup = harness();

  await setup.runtime.observeMessage("g1", message({ at: T0 }));
  await setup.runtime.observeMessage("g1", message({ at: T0 + 1_000 }));
  const outcome = await setup.runtime.observeMessage("g1", message({ at: T0 + 2_000 }));

  assert.equal(outcome.kind, "opened");
  assert.ok(setup.baselineCalls.includes("freeze"), "resursele distruse inaintea confirmarii se pierd daca baseline-ul nu e inghetat la primul semnal");
});

test("un al doilea semnal pe acelasi incident nu reingheta baseline-ul (N-02)", async () => {
  const setup = harness();
  await setup.runtime.observeMessage("g1", message({ at: T0 }));
  await setup.runtime.observeMessage("g1", message({ at: T0 + 1_000 }));
  await setup.runtime.observeMessage("g1", message({ at: T0 + 2_000 }));
  const dupaPrimul = setup.baselineCalls.filter(entry => entry === "freeze").length;

  await setup.runtime.observeMessage("g1", message({ at: T0 + 3_000 }));
  await setup.runtime.observeMessage("g1", message({ at: T0 + 4_000 }));

  assert.equal(dupaPrimul, 1, "inghetarea se face la deschiderea incidentului");
  assert.equal(setup.baselineCalls.filter(entry => entry === "freeze").length, dupaPrimul,
    "semnalele urmatoare din acelasi incident nu au voie sa reingheta, altfel referinta s-ar muta in timpul raidului");
});
