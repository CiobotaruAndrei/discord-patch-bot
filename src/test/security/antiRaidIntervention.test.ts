import test from "node:test";
import assert from "node:assert/strict";

import { createRaidIntervention } from "../../features/command-security/antiRaidIntervention.js";
import { createRaidIncidentRepository } from "../../features/command-security/antiRaidIncidentRepository.js";
import { DEFAULT_ANTI_RAID_THRESHOLDS } from "../../features/command-security/antiRaidThresholds.js";
import { raidIncidentStore } from "./raidIncidentStore.js";

import type { RaidGuildPort, SanctionOutcome } from "../../features/command-security/antiRaidIntervention.js";
import type { SanctionStep } from "../../features/command-security/antiRaidIncidentTypes.js";

const T0 = Date.parse("2026-08-01T12:00:00.000Z");

function harness(options: {
  sanction?: (userId: string, step: SanctionStep) => SanctionOutcome;
  lockOk?: boolean;
  unlockOk?: boolean;
  thresholds?: Partial<typeof DEFAULT_ANTI_RAID_THRESHOLDS>;
  clock?: () => number;
} = {}) {
  const model = raidIncidentStore();
  const incidents = createRaidIncidentRepository(model);
  const locked: string[] = [];
  const unlocked: string[] = [];
  const sanctions: Array<{ userId: string; step: SanctionStep; durationMs: number }> = [];
  const published: string[] = [];
  const ownerAlerts: string[] = [];
  const purged: Array<{ channelIds: string[]; userIds: string[] }> = [];

  const guild: RaidGuildPort = {
    id: "g1",
    lockChannel: async channelId => {
      if (options.lockOk === false) return { locked: false, previousSendMessages: null };
      locked.push(channelId);
      return { locked: true, previousSendMessages: true };
    },
    unlockChannel: async channelId => {
      if (options.unlockOk === false) return false;
      unlocked.push(channelId);
      return true;
    },
    applySanction: async (userId, step, durationMs) => {
      sanctions.push({ userId, step, durationMs });
      return options.sanction?.(userId, step) ?? { applied: true, retryable: false, error: null };
    },
    purgeMessages: async (channelIds, userIds) => {
      purged.push({ channelIds: [...channelIds], userIds: [...userIds] });
      return { deleted: userIds.length * 5, unreachable: 0 };
    },
    publish: async body => { published.push(body); return undefined; },
    alertOwner: async body => { ownerAlerts.push(body); return undefined; }
  };

  const intervention = createRaidIntervention({
    RaidIncidentModel: model,
    thresholds: async () => ({ ...DEFAULT_ANTI_RAID_THRESHOLDS, ...options.thresholds }),
    now: options.clock ?? (() => T0),
    wait: async () => undefined,
    retryDelayMs: 0
  });

  return { model, incidents, intervention, guild, locked, unlocked, sanctions, published, ownerAlerts, purged };
}

test("fara incident activ nu se face nimic", async () => {
  const setup = harness();
  const steps = await setup.intervention.advanceIncident(setup.guild, ["c1"]);

  assert.deepEqual(steps, [{ kind: "no-incident" }]);
  assert.equal(setup.locked.length, 0);
});

test("un incident suspectat e confirmat, anuntat si trece la lockdown", async () => {
  const setup = harness();
  await setup.incidents.open({ guildId: "g1", triggerReason: "mesaje identice" }, new Date(T0));

  const steps = await setup.intervention.advanceIncident(setup.guild, ["c1", "c2"]);

  assert.match(setup.published[0], /raid confirmat/);
  assert.match(setup.published[0], /mesaje identice/);
  assert.deepEqual(setup.locked, ["c1", "c2"]);
  assert.equal(steps.some(step => step.kind === "locked"), true);
  assert.equal((await setup.incidents.active("g1"))?.stage, "containment");
});

test("un canal deja blocat nu se blocheaza a doua oara", async () => {
  const setup = harness();
  const incident = await setup.incidents.open({ guildId: "g1", triggerReason: "spam" }, new Date(T0));
  await setup.incidents.advance(incident?._id ?? "", "suspected", "containment", new Date(T0));
  await setup.incidents.lockChannel(incident?._id ?? "", "c1", true, new Date(T0));

  await setup.intervention.advanceIncident(setup.guild, ["c1", "c2"]);

  assert.deepEqual(setup.locked, ["c2"], "starea de dinainte de lockdown nu are voie sa fie rescrisa");
});

test("un lockdown esuat e notat ca eroare, fara sa opreasca restul canalelor", async () => {
  const setup = harness({ lockOk: false });
  await setup.incidents.open({ guildId: "g1", triggerReason: "spam" }, new Date(T0));

  await setup.intervention.advanceIncident(setup.guild, ["c1"]);

  const stored = await setup.incidents.active("g1");
  assert.equal(stored?.lockedChannels.length, 0);
  assert.match(stored?.errors[0] ?? "", /Lockdown esuat pentru canalul c1/);
});

test("participantii umani primesc mute cu durata configurata, in ordinea confirmarii", async () => {
  const setup = harness();
  const incident = await setup.incidents.open({ guildId: "g1", triggerReason: "spam" }, new Date(T0));
  const id = incident?._id ?? "";
  await setup.incidents.addParticipant(id, "u1", false, new Date(T0));
  await setup.incidents.addParticipant(id, "u2", false, new Date(T0 + 1));

  await setup.intervention.advanceIncident(setup.guild, []);

  assert.deepEqual(setup.sanctions.map(entry => entry.userId), ["u1", "u2"]);
  assert.deepEqual(setup.sanctions.map(entry => entry.step), ["mute", "mute"]);
  assert.equal(setup.sanctions[0].durationMs, DEFAULT_ANTI_RAID_THRESHOLDS.muteDurationMs);
});

test("un bot participant primeste direct ban, fara mute sau timeout", async () => {
  const setup = harness();
  const incident = await setup.incidents.open({ guildId: "g1", triggerReason: "boti" }, new Date(T0));
  await setup.incidents.addParticipant(incident?._id ?? "", "bot-1", true, new Date(T0));

  await setup.intervention.advanceIncident(setup.guild, []);

  assert.deepEqual(setup.sanctions.map(entry => entry.step), ["ban"]);
});

test("un mute reusit opreste escaladarea, deci nu se aplica si ban", async () => {
  const setup = harness();
  const incident = await setup.incidents.open({ guildId: "g1", triggerReason: "spam" }, new Date(T0));
  const id = incident?._id ?? "";
  await setup.incidents.addParticipant(id, "u1", false, new Date(T0));

  await setup.intervention.advanceIncident(setup.guild, []);
  await setup.intervention.advanceIncident(setup.guild, []);

  assert.deepEqual(setup.sanctions.map(entry => entry.step), ["mute"], "al doilea ciclu nu mai atinge un participant oprit");
  assert.equal((await setup.incidents.read(id))?.participants[0].state, "stopped");
});

test("o eroare temporara e reincercata inainte sa se treaca la treapta urmatoare", async () => {
  let attempts = 0;
  const setup = harness({
    sanction: (_userId, step) => {
      if (step !== "mute") return { applied: true, retryable: false, error: null };
      attempts += 1;
      return attempts < 3
        ? { applied: false, retryable: true, error: "rate limited" }
        : { applied: true, retryable: false, error: null };
    }
  });
  const incident = await setup.incidents.open({ guildId: "g1", triggerReason: "spam" }, new Date(T0));
  await setup.incidents.addParticipant(incident?._id ?? "", "u1", false, new Date(T0));

  await setup.intervention.advanceIncident(setup.guild, []);

  assert.equal(attempts, 3, "eroarea temporara se reincearca controlat, nu se abandoneaza la prima incercare");
  assert.deepEqual(setup.sanctions.map(entry => entry.step), ["mute", "mute", "mute"]);
});

test("o eroare permanenta nu se reincearca, iar escaladarea trece la treapta urmatoare", async () => {
  const setup = harness({
    sanction: (_userId, step) => (step === "mute"
      ? { applied: false, retryable: false, error: "Missing Permissions" }
      : { applied: true, retryable: false, error: null })
  });
  const incident = await setup.incidents.open({ guildId: "g1", triggerReason: "spam" }, new Date(T0));
  const id = incident?._id ?? "";
  await setup.incidents.addParticipant(id, "u1", false, new Date(T0));

  await setup.intervention.advanceIncident(setup.guild, []);
  await setup.intervention.advanceIncident(setup.guild, []);

  assert.deepEqual(setup.sanctions.map(entry => entry.step), ["mute", "timeout"]);
  const stored = await setup.incidents.read(id);
  assert.deepEqual(stored?.participants[0].failedSteps, ["mute"]);
  assert.deepEqual(stored?.participants[0].appliedSteps, ["timeout"]);
});

test("cand toate cele trei trepte esueaza, ownerul primeste alerta si lockdown-ul ramane", async () => {
  const setup = harness({ sanction: () => ({ applied: false, retryable: false, error: "ierarhie Discord" }) });
  const incident = await setup.incidents.open({ guildId: "g1", triggerReason: "spam" }, new Date(T0));
  const id = incident?._id ?? "";
  await setup.incidents.addParticipant(id, "u1", false, new Date(T0));

  await setup.intervention.advanceIncident(setup.guild, ["c1"]);
  await setup.intervention.advanceIncident(setup.guild, ["c1"]);
  const steps = await setup.intervention.advanceIncident(setup.guild, ["c1"]);

  assert.deepEqual(setup.sanctions.map(entry => entry.step), ["mute", "timeout", "ban"]);
  assert.equal(steps.some(step => step.kind === "escalation-exhausted"), true);
  assert.match(setup.ownerAlerts.at(-1) ?? "", /nu a putut fi oprit/);
  assert.equal((await setup.incidents.read(id))?.participants[0].state, "failed");
  assert.equal((await setup.incidents.active("g1"))?.stage, "containment", "lockdown-ul nu se ridica singur dupa un esec");
});

test("lockdown-ul depasit cere decizia ownerului, fara sa se ridice singur", async () => {
  let clock = T0;
  const setup = harness({ clock: () => clock });
  await setup.incidents.open({ guildId: "g1", triggerReason: "spam" }, new Date(T0));
  await setup.intervention.advanceIncident(setup.guild, ["c1"]);

  clock = T0 + DEFAULT_ANTI_RAID_THRESHOLDS.maxLockdownMs + 1_000;
  const steps = await setup.intervention.advanceIncident(setup.guild, ["c1"]);

  assert.equal(steps.some(step => step.kind === "lockdown-overdue"), true);
  assert.match(setup.ownerAlerts.at(-1) ?? "", /force-stop/);
  assert.equal((await setup.incidents.active("g1"))?.stage, "containment");
});

test("containment trece la cleanup doar cand toti participantii sunt opriti", async () => {
  const setup = harness();
  const incident = await setup.incidents.open({ guildId: "g1", triggerReason: "spam" }, new Date(T0));
  const id = incident?._id ?? "";
  await setup.incidents.advance(id, "suspected", "containment", new Date(T0));
  await setup.incidents.addParticipant(id, "u1", false, new Date(T0));
  await setup.incidents.addParticipant(id, "u2", false, new Date(T0));

  await setup.incidents.recordSanction(id, "u1", "mute", true, null, new Date(T0));
  assert.equal(await setup.intervention.markContained("g1"), false, "un participant neoprit tine incidentul in containment");

  await setup.incidents.recordSanction(id, "u2", "mute", true, null, new Date(T0));
  assert.equal(await setup.intervention.markContained("g1"), true);
  assert.equal((await setup.incidents.active("g1"))?.stage, "cleanup");
});

test("curatarea sterge mesajele participantilor opriti si trece la recovery", async () => {
  const setup = harness();
  const incident = await setup.incidents.open({ guildId: "g1", triggerReason: "spam" }, new Date(T0));
  const id = incident?._id ?? "";
  await setup.incidents.advance(id, "suspected", "containment", new Date(T0));
  await setup.incidents.lockChannel(id, "c1", true, new Date(T0));
  await setup.incidents.addParticipant(id, "u1", false, new Date(T0));
  await setup.incidents.recordSanction(id, "u1", "mute", true, null, new Date(T0));
  await setup.incidents.advance(id, "containment", "cleanup", new Date(T0));

  const steps = await setup.intervention.advanceIncident(setup.guild, []);

  assert.deepEqual(setup.purged, [{ channelIds: ["c1"], userIds: ["u1"] }]);
  assert.equal(steps.some(step => step.kind === "cleaned"), true);
  assert.equal((await setup.incidents.active("g1"))?.stage, "recovery");
});

test("restaurarea asteapta perioada de siguranta si nu ridica lockdown-ul mai devreme", async () => {
  let clock = T0;
  const setup = harness({ clock: () => clock });
  const incident = await setup.incidents.open({ guildId: "g1", triggerReason: "spam" }, new Date(T0));
  const id = incident?._id ?? "";
  await setup.incidents.advance(id, "suspected", "recovery", new Date(T0));
  await setup.incidents.lockChannel(id, "c1", true, new Date(T0));

  clock = T0 + 10 * 60_000;
  const early = await setup.intervention.advanceIncident(setup.guild, []);

  assert.equal(early[0].kind, "waiting");
  assert.equal(setup.unlocked.length, 0, "lockdown-ul nu se ridica inainte de perioada de siguranta");
});

test("dupa perioada de siguranta lockdown-ul se ridica, iar sanctiunile raman", async () => {
  let clock = T0;
  const setup = harness({ clock: () => clock });
  const incident = await setup.incidents.open({ guildId: "g1", triggerReason: "spam" }, new Date(T0));
  const id = incident?._id ?? "";
  await setup.incidents.advance(id, "suspected", "recovery", new Date(T0));
  await setup.incidents.lockChannel(id, "c1", true, new Date(T0));

  clock = T0 + DEFAULT_ANTI_RAID_THRESHOLDS.safetyPeriodMs + 1_000;
  const steps = await setup.intervention.advanceIncident(setup.guild, []);

  assert.deepEqual(setup.unlocked, ["c1"]);
  assert.equal(steps.some(step => step.kind === "restored"), true);
  assert.equal(await setup.incidents.active("g1"), null, "incidentul e inchis");
  assert.equal((await setup.incidents.read(id))?.restoreProgress, 100);
  assert.match(setup.published.at(-1) ?? "", /raman aplicate/);
});

test("o restaurare esuata e notata, iar incidentul nu pretinde ca s-a terminat curat", async () => {
  let clock = T0;
  const setup = harness({ clock: () => clock, unlockOk: false });
  const incident = await setup.incidents.open({ guildId: "g1", triggerReason: "spam" }, new Date(T0));
  const id = incident?._id ?? "";
  await setup.incidents.advance(id, "suspected", "recovery", new Date(T0));
  await setup.incidents.lockChannel(id, "c1", true, new Date(T0));

  clock = T0 + DEFAULT_ANTI_RAID_THRESHOLDS.safetyPeriodMs + 1_000;
  await setup.intervention.advanceIncident(setup.guild, []);

  const stored = await setup.incidents.read(id);
  assert.match(stored?.errors.at(-1) ?? "", /Restaurarea canalului c1 a esuat/);
  assert.equal(stored?.lockedChannels[0].restoredAt, null, "canalul ramane marcat ca blocat, ca ownerul sa stie ce a ramas");
});

test("in dry-run nu se blocheaza si nu se sanctioneaza nimic, doar se raporteaza", async () => {
  const setup = harness();
  const incident = await setup.incidents.open({ guildId: "g1", triggerReason: "spam", dryRun: true }, new Date(T0));
  await setup.incidents.addParticipant(incident?._id ?? "", "u1", false, new Date(T0));

  const steps = await setup.intervention.advanceIncident(setup.guild, ["c1"]);

  assert.equal(steps[0].kind, "dry-run");
  assert.deepEqual(setup.locked, []);
  assert.deepEqual(setup.sanctions, []);
  assert.deepEqual(setup.published, [], "dry-run nu sperie serverul cu anunturi de raid");
  assert.equal(steps[0].kind === "dry-run" && steps[0].wouldSanction.length, 1);
});
