import test from "node:test";
import assert from "node:assert/strict";

import {
  ANTI_RAID_THRESHOLD_KEYS,
  DEFAULT_ANTI_RAID_THRESHOLDS,
  applyThresholdOverrides,
  describeThresholds,
  formatDuration,
  parseDuration,
  readThresholds
} from "../../features/command-security/antiRaidThresholds.js";
import {
  RAID_STAGES,
  canAdvance,
  lockdownOverdue,
  nextSanctionStep,
  participantSettled,
  raidConfirmed,
  safetyPeriodElapsed
} from "../../features/command-security/antiRaidIncidentTypes.js";
import { createRaidIncidentRepository } from "../../features/command-security/antiRaidIncidentRepository.js";
import { raidIncidentStore } from "./raidIncidentStore.js";
import { START_STOP_TOGGLE_FIELDS } from "../../features/command-security/securityCommandFields.js";

test("pragurile implicite sunt exact cele scrise in specificatie", () => {
  assert.equal(DEFAULT_ANTI_RAID_THRESHOLDS.identicalMessages, 3);
  assert.equal(DEFAULT_ANTI_RAID_THRESHOLDS.identicalWindowMs, 8_000);
  assert.equal(DEFAULT_ANTI_RAID_THRESHOLDS.mentionCount, 4, "mai mult de 3 mentiuni inseamna minimum 4");
  assert.equal(DEFAULT_ANTI_RAID_THRESHOLDS.inviteMessages, 3, "mai mult de 2 inseamna minimum 3");
  assert.equal(DEFAULT_ANTI_RAID_THRESHOLDS.linkMessages, 4);
  assert.equal(DEFAULT_ANTI_RAID_THRESHOLDS.coordinatedActors, 2);
  assert.equal(DEFAULT_ANTI_RAID_THRESHOLDS.structureChanges, 3);
  assert.equal(DEFAULT_ANTI_RAID_THRESHOLDS.safetyPeriodMs, 30 * 60_000);
  assert.equal(DEFAULT_ANTI_RAID_THRESHOLDS.muteDurationMs, 24 * 3_600_000);
  assert.equal(DEFAULT_ANTI_RAID_THRESHOLDS.timeoutDurationMs, 24 * 3_600_000);
  assert.equal(DEFAULT_ANTI_RAID_THRESHOLDS.maxLockdownMs, 45 * 60_000);
  assert.equal(ANTI_RAID_THRESHOLD_KEYS.length, Object.keys(DEFAULT_ANTI_RAID_THRESHOLDS).length,
    "orice prag nou trebuie sa fie si validabil, altfel ar fi setabil fara limite");
});

test("duratele se parseaza si se reafiseaza fara pierdere", () => {
  assert.equal(parseDuration("8s"), 8_000);
  assert.equal(parseDuration("30m"), 30 * 60_000);
  assert.equal(parseDuration("24h"), 24 * 3_600_000);
  assert.equal(parseDuration("2d"), 2 * 86_400_000);
  assert.equal(parseDuration("maine"), null);
  assert.equal(parseDuration("0m"), null, "o durata zero ar dezactiva tacit un prag");
  assert.equal(formatDuration(45 * 60_000), "45m");
  assert.equal(formatDuration(24 * 3_600_000), "24h");
});

test("ownerul poate stramta sau largi pragurile in limitele acceptate", () => {
  const { thresholds, rejected } = applyThresholdOverrides(DEFAULT_ANTI_RAID_THRESHOLDS, {
    identicalMessages: 2,
    safetyPeriodMs: "1h",
    maxLockdownMs: "10m"
  });

  assert.deepEqual(rejected, []);
  assert.equal(thresholds.identicalMessages, 2);
  assert.equal(thresholds.safetyPeriodMs, 3_600_000);
  assert.equal(thresholds.maxLockdownMs, 600_000);
  assert.equal(thresholds.mentionCount, DEFAULT_ANTI_RAID_THRESHOLDS.mentionCount, "pragurile neatinse raman implicite");
});

test("o valoare absurda e refuzata cu motiv, iar restul se aplica", () => {
  const { thresholds, rejected } = applyThresholdOverrides(DEFAULT_ANTI_RAID_THRESHOLDS, {
    identicalMessages: 1,
    linkMessages: 9,
    safetyPeriodMs: "99d",
    inexistent: 5
  });

  assert.equal(thresholds.linkMessages, 9, "o valoare valida nu e pierduta din cauza uneia invalide");
  assert.equal(thresholds.identicalMessages, 3, "un prag de 1 ar declansa raid la orice mesaj");
  assert.equal(thresholds.safetyPeriodMs, DEFAULT_ANTI_RAID_THRESHOLDS.safetyPeriodMs);
  assert.deepEqual(rejected.map(entry => entry.key).sort(), ["identicalMessages", "inexistent", "safetyPeriodMs"]);
  assert.match(rejected.find(entry => entry.key === "inexistent")?.reason ?? "", /nu este un prag anti-raid cunoscut/);
});

test("citirea unei configuratii lipsa sau stricate cade pe implicit, nu pe zero", () => {
  assert.deepEqual(readThresholds(null), DEFAULT_ANTI_RAID_THRESHOLDS);
  assert.deepEqual(readThresholds({ identicalMessages: -5, safetyPeriodMs: "nu" }), DEFAULT_ANTI_RAID_THRESHOLDS);
  assert.equal(describeThresholds(DEFAULT_ANTI_RAID_THRESHOLDS).length, 10);
});

test("etapele incidentului merg doar inainte", () => {
  assert.deepEqual([...RAID_STAGES], ["suspected", "confirmed", "containment", "cleanup", "recovery", "resolved"]);
  assert.equal(canAdvance("suspected", "confirmed"), true);
  assert.equal(canAdvance("suspected", "recovery"), true, "sarirea inainte e permisa, de exemplu la force-stop");
  assert.equal(canAdvance("cleanup", "confirmed"), false, "un incident nu se poate intoarce la o etapa depasita");
  assert.equal(canAdvance("resolved", "resolved"), false);
});

test("raidul e considerat confirmat exact din etapa confirmed pana la resolved", () => {
  assert.equal(raidConfirmed("suspected"), false, "o suspiciune nu suspenda moderation-guard");
  assert.equal(raidConfirmed("confirmed"), true);
  assert.equal(raidConfirmed("cleanup"), true);
  assert.equal(raidConfirmed("recovery"), true);
  assert.equal(raidConfirmed("resolved"), false);
});

test("scara de sanctiuni pentru oameni e mute, apoi timeout, apoi ban", () => {
  const base = { bot: false, appliedSteps: [], failedSteps: [] };
  assert.equal(nextSanctionStep(base), "mute");
  assert.equal(nextSanctionStep({ ...base, failedSteps: ["mute"] }), "timeout");
  assert.equal(nextSanctionStep({ ...base, failedSteps: ["mute", "timeout"] }), "ban");
  assert.equal(nextSanctionStep({ ...base, failedSteps: ["mute", "timeout", "ban"] }), null);
});

test("un pas reusit opreste escaladarea, ca sa nu se aplice si ban dupa un mute care a functionat", () => {
  assert.equal(nextSanctionStep({ bot: false, appliedSteps: ["mute"], failedSteps: [] }), null);
  assert.equal(participantSettled({ bot: false, appliedSteps: ["mute"], failedSteps: [] }), true);
  assert.equal(participantSettled({ bot: false, appliedSteps: [], failedSteps: ["mute"] }), false);
});

test("un bot intrat in timpul raidului primeste direct ban, fara mute sau timeout", () => {
  assert.equal(nextSanctionStep({ bot: true, appliedSteps: [], failedSteps: [] }), "ban");
  assert.equal(nextSanctionStep({ bot: true, appliedSteps: ["ban"], failedSteps: [] }), null);
});

test("perioada de siguranta si lockdown-ul depasit se masoara din momente diferite", () => {
  const start = Date.parse("2026-08-01T10:00:00.000Z");
  const incident = {
    lastActivityAt: new Date(start),
    confirmedAt: new Date(start - 60 * 60_000),
    stage: "containment" as const
  };

  assert.equal(safetyPeriodElapsed(incident, 30 * 60_000, start + 29 * 60_000), false);
  assert.equal(safetyPeriodElapsed(incident, 30 * 60_000, start + 30 * 60_000), true);
  assert.equal(lockdownOverdue(incident, 45 * 60_000, start), true, "lockdown-ul se masoara din confirmare, nu din ultima activitate");
  assert.equal(lockdownOverdue({ ...incident, stage: "resolved" }, 45 * 60_000, start), false);
  assert.equal(lockdownOverdue({ ...incident, confirmedAt: null }, 45 * 60_000, start), false);
});

test("un singur incident activ per server", async () => {
  const model = raidIncidentStore();
  const repository = createRaidIncidentRepository(model);

  const first = await repository.open({ guildId: "g1", triggerReason: "spam identic" });
  const second = await repository.open({ guildId: "g1", triggerReason: "alt spam" });
  const other = await repository.open({ guildId: "g2", triggerReason: "spam identic" });

  assert.ok(first);
  assert.equal(second, null, "al doilea incident ar fi impartit lockdown-ul si sanctiunile in doua");
  assert.ok(other, "alt server poate avea incidentul lui");
  assert.match(first?._id ?? "", /^raid-/);
});

test("dupa rezolvare se poate deschide un incident nou", async () => {
  const model = raidIncidentStore();
  const repository = createRaidIncidentRepository(model);
  const first = await repository.open({ guildId: "g1", triggerReason: "spam" });

  await repository.advance(first?._id ?? "", "suspected", "resolved");
  const second = await repository.open({ guildId: "g1", triggerReason: "al doilea val" });

  assert.ok(second);
  assert.notEqual(second?._id, first?._id);
});

test("avansarea etapei e un compare-and-set, deci doua instante nu o pot aplica de doua ori", async () => {
  const model = raidIncidentStore();
  const repository = createRaidIncidentRepository(model);
  const incident = await repository.open({ guildId: "g1", triggerReason: "spam" });
  const id = incident?._id ?? "";

  assert.equal(await repository.advance(id, "suspected", "confirmed"), true);
  assert.equal(await repository.advance(id, "suspected", "confirmed"), false, "a doua instanta nu mai gaseste etapa veche");
  assert.equal((await repository.read(id))?.stage, "confirmed");
  assert.ok((await repository.read(id))?.confirmedAt, "confirmarea isi noteaza momentul, pentru masurarea lockdown-ului");
});

test("un participant nu se dubleaza, iar sanctiunile se noteaza o singura data", async () => {
  const model = raidIncidentStore();
  const repository = createRaidIncidentRepository(model);
  const incident = await repository.open({ guildId: "g1", triggerReason: "spam" });
  const id = incident?._id ?? "";

  assert.equal(await repository.addParticipant(id, "u1", false), true);
  assert.equal(await repository.addParticipant(id, "u1", false), false, "acelasi participant nu poate fi sanctionat de doua ori");

  await repository.recordSanction(id, "u1", "mute", false, "Missing Permissions");
  await repository.recordSanction(id, "u1", "mute", false, "Missing Permissions");
  await repository.recordSanction(id, "u1", "timeout", true, null);

  const stored = await repository.read(id);
  assert.deepEqual(stored?.participants[0].failedSteps, ["mute"]);
  assert.deepEqual(stored?.participants[0].appliedSteps, ["timeout"]);
  assert.equal(stored?.participants[0].state, "stopped");
});

test("canalele blocate se noteaza cu starea dinainte, ca restaurarea sa nu ghiceasca", async () => {
  const model = raidIncidentStore();
  const repository = createRaidIncidentRepository(model);
  const incident = await repository.open({ guildId: "g1", triggerReason: "spam" });
  const id = incident?._id ?? "";

  assert.equal(await repository.lockChannel(id, "c1", true), true);
  assert.equal(await repository.lockChannel(id, "c1", false), false, "un canal deja blocat nu isi rescrie starea anterioara");
  assert.equal(await repository.markChannelRestored(id, "c1"), true);
  assert.equal(await repository.markChannelRestored(id, "c1"), false, "restaurarea e idempotenta");

  const stored = await repository.read(id);
  assert.equal(stored?.lockedChannels[0].previousSendMessages, true);
  assert.ok(stored?.lockedChannels[0].restoredAt);
});

test("incidentul activ e regasit dupa repornire, cu sanctiunile deja aplicate", async () => {
  const model = raidIncidentStore();
  const repository = createRaidIncidentRepository(model);
  const incident = await repository.open({ guildId: "g1", triggerReason: "spam" });
  const id = incident?._id ?? "";
  await repository.advance(id, "suspected", "containment");
  await repository.addParticipant(id, "u1", false);
  await repository.recordSanction(id, "u1", "mute", true, null);

  const resumed = await createRaidIncidentRepository(model).active("g1");

  assert.equal(resumed?._id, id);
  assert.equal(resumed?.stage, "containment");
  assert.deepEqual(resumed?.participants[0].appliedSteps, ["mute"], "repornirea nu are voie sa repete sanctiunile deja aplicate");
});

test("doua force-start concurente nu pot crea doua incidente active", async () => {
  const model = raidIncidentStore();
  const repository = createRaidIncidentRepository(model);

  const [first, second] = await Promise.all([
    repository.open({ guildId: "g1", triggerReason: "primul" }),
    repository.open({ guildId: "g1", triggerReason: "al doilea" })
  ]);

  assert.equal([first, second].filter(Boolean).length, 1,
    "cheia unica pe server opreste al doilea incident chiar daca amandoua citesc simultan ca nu exista niciunul");
  assert.equal(model.records.length, 1);
});

test("dupa inchidere, cheia de unicitate se elibereaza pentru urmatorul incident", async () => {
  const model = raidIncidentStore();
  const repository = createRaidIncidentRepository(model);
  const first = await repository.open({ guildId: "g1", triggerReason: "primul" });
  await repository.advance(first?._id ?? "", "suspected", "resolved");

  const second = await repository.open({ guildId: "g1", triggerReason: "al doilea val" });

  assert.ok(second, "un incident inchis nu are voie sa blocheze pentru totdeauna serverul");
  assert.equal(model.records.filter(record => record.activeKey === "g1").length, 1);
});

test("anti-raid-dry-run este o protectie reala, cu canal si comutator propriu", () => {
  const toggle = START_STOP_TOGGLE_FIELDS["anti-raid-dry-run"];
  assert.ok(toggle, "fara intrare in tabel, /start anti-raid-dry-run ar cadea pe handlerul de abonamente si ar raspunde subcomanda necunoscuta");
  assert.equal(toggle.channel, "antiRaidAlertChannelId");
  assert.equal(toggle.enabled, "antiRaidDryRunEnabled");
});
