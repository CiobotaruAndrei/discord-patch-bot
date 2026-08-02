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
} = {}) {
  const model = raidIncidentStore();
  const incidents = createRaidIncidentRepository(model);
  const locked: string[] = [];
  const sanctions: Array<{ userId: string; step: string }> = [];
  const published: string[] = [];
  let clock = T0;

  const guild: RaidGuildPort = {
    id: "g1",
    lockChannel: async channelId => { locked.push(channelId); return { locked: true, previousSendMessages: true }; },
    unlockChannel: async () => true,
    applySanction: async (userId, step) => { sanctions.push({ userId, step }); return { applied: true, retryable: false, error: null }; },
    purgeMessages: async () => 0,
    publish: async body => { published.push(body); return undefined; },
    alertOwner: async body => { published.push(body); return undefined; }
  };

  const runtime = createAntiRaidRuntime({
    RaidIncidentModel: model,
    readGuildSettings: async () => ({ antiRaidThresholds: options.thresholds ?? null, antiRaidEnabled: options.enabled !== false, antiRaidDryRunEnabled: options.dryRun === true }),
    findStructureActor: async () => options.structureActor ?? null,
    resolveGuild: async () => (options.resolvable === false ? null : guild),
    now: () => clock
  });

  return { runtime, incidents, model, locked, sanctions, published, advance: (ms: number) => { clock += ms; }, clockAt: () => clock };
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
  assert.match(outcome.kind === "opened" ? outcome.reason : "", /canale sau roluri/);
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
