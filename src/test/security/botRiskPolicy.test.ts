import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";

import { assessBotRisk } from "../../features/command-security/botRiskPolicy.js";

const NOW = Date.parse("2026-07-17T12:00:00.000Z");
const DAY_MS = 86_400_000;

function permissions(...values: bigint[]) {
  const set = new Set(values);
  return { has: (value: bigint) => set.has(value) };
}

test("un bot legitim si nou (verificat, fara permisiuni) NU mai e etichetat agresiv doar pe varsta", () => {
  const risk = assessBotRisk({
    createdTimestamp: NOW - 3_600_000,
    verifiedBot: true,
    approved: true,
    roles: [],
    guildRoleCount: 20
  }, NOW);

  assert.equal(risk.level, "normal", "cont nou (+3) - verificat (-2) - aprobat (-1) = 0 => normal, nu dangerous");
  assert.equal(risk.score, 0);
  assert.ok(risk.signals.some(signal => signal.includes("bot verificat de Discord")));
});

test("un bot VECHI dar cu permisiuni excesive: la join (fara activitate confirmata) e limitat la suspect, nu dangerous (audit, #26)", () => {
  const input = {
    createdTimestamp: NOW - 400 * DAY_MS,
    verifiedBot: false,
    approved: false,
    roles: [{
      id: "role-1",
      position: 3,
      permissions: permissions(PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageWebhooks)
    }],
    guildRoleCount: 20
  };
  const atJoin = assessBotRisk(input, NOW);

  assert.equal(atJoin.score, 5, "Administrator (+3) + Manage Webhooks (+2) = 5");
  assert.equal(atJoin.level, "suspicious", "la join semnalele statice nu pot depasi suspect; dangerous cere activitate confirmata");
  assert.ok(atJoin.signals.some(signal => signal.includes("clasificare limitata la suspect")), "semnalul explica de ce a fost limitat");
  assert.ok(atJoin.signals.some(signal => signal.includes("permisiune Administrator")));

  const withConfirmed = assessBotRisk({ ...input, confirmedActivity: true }, NOW);
  assert.equal(withConfirmed.level, "dangerous", "cu activitate periculoasa confirmata dupa join, acelasi scor devine dangerous");
});

test("scorul cumuleaza varsta, permisiunile, pozitia rolului si penalizeaza lipsa datelor; dangerous cere confirmare (audit, #26)", () => {
  const unknownAge = assessBotRisk({ roles: [], guildRoleCount: 10 }, NOW);
  assert.equal(unknownAge.score, 2, "varsta necunoscuta (+2)");
  assert.equal(unknownAge.level, "suspicious");

  const highPosition = assessBotRisk({
    createdTimestamp: NOW - 10 * DAY_MS,
    roles: [{ id: "role-1", position: 8, permissions: permissions(PermissionFlagsBits.ModerateMembers) }],
    guildRoleCount: 10
  }, NOW);
  assert.equal(highPosition.score, 5, "cont <30 zile (+2) + Moderate Members (+2) + pozitie inalta (+1)");
  assert.equal(highPosition.level, "suspicious", "scor 5 la join ramane suspect fara activitate confirmata");
  assert.ok(highPosition.signals.some(signal => signal.includes("jumatatea superioara a ierarhiei")));
  assert.equal(assessBotRisk({
    createdTimestamp: NOW - 10 * DAY_MS,
    roles: [{ id: "role-1", position: 8, permissions: permissions(PermissionFlagsBits.ModerateMembers) }],
    guildRoleCount: 10,
    confirmedActivity: true
  }, NOW).level, "dangerous", "cu activitate confirmata, scorul 5 devine dangerous");

  const lowPosition = assessBotRisk({
    createdTimestamp: NOW - 10 * DAY_MS,
    roles: [{ id: "role-1", position: 2, permissions: permissions(PermissionFlagsBits.ModerateMembers) }],
    guildRoleCount: 10
  }, NOW);
  assert.equal(lowPosition.score, 4, "aceleasi semnale fara bonusul de pozitie");
  assert.equal(lowPosition.level, "suspicious");
});

test("pragurile: >=5 dangerous DOAR cu activitate confirmata (altfel suspect la join), >=2 suspicious, sub 2 normal (audit, #26)", () => {
  assert.equal(assessBotRisk({ createdTimestamp: NOW - 60 * DAY_MS, roles: [] }, NOW).level, "normal", "cont 60 zile (+1) => normal");
  assert.equal(assessBotRisk({ createdTimestamp: NOW - 10 * DAY_MS, roles: [] }, NOW).level, "suspicious", "cont 10 zile (+2) => suspicious");
  const dangerousInput = {
    createdTimestamp: NOW - 3_600_000,
    roles: [{ id: "r", permissions: permissions(PermissionFlagsBits.BanMembers) }]
  };
  assert.equal(assessBotRisk(dangerousInput, NOW).level, "suspicious", "cont <24h (+3) + Ban Members (+2) = 5 la join => limitat la suspect");
  assert.equal(assessBotRisk({ ...dangerousInput, confirmedActivity: true }, NOW).level, "dangerous", "acelasi scor cu activitate confirmata => dangerous");
});
