import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";

import {
  blockingGaps,
  degradedSubprotections,
  describeGuardReadiness,
  moderationGuardReadiness,
  readinessGapsByProtection
} from "../../features/command-security/moderationGuardReadiness.js";
import { MODERATION_GUARD_TYPES } from "../../features/command-security/moderationGuardDecision.js";
import { protectionToggleGate } from "../../features/command-security/protectionReadiness.js";
import { buildSecurityStatus } from "../../features/command-security/securityStatusModel.js";
import type { GuildSettingsLike } from "../../features/command-security/securitySettingsContracts.js";
import { moduleContext } from "../moduleContextStub.js";

import type { PermissionHolder } from "../../features/command-security/moderationGuardReadiness.js";
import type { SecurityInteraction } from "../../features/command-security/securityInteractionContracts.js";

const EVERY_PERMISSION = [
  PermissionFlagsBits.ViewAuditLog,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers
];

function holder(granted: readonly bigint[] = EVERY_PERMISSION, position = 5): PermissionHolder {
  const set = new Set(granted);
  return { permissions: { has: flag => set.has(flag) }, roles: { highest: { position } } };
}

test("cu toate permisiunile, toate cele sase subprotectii sunt gata (F-18)", () => {
  const report = moderationGuardReadiness(holder());

  assert.deepEqual(report.map(entry => entry.type).sort(), [...MODERATION_GUARD_TYPES].sort());
  for (const entry of report) assert.equal(entry.state, "ready", `${entry.type} ar trebui sa fie gata`);
  assert.deepEqual(blockingGaps(report), []);
});

test("fara View Audit Log toate subprotectiile sunt blocate, nu doar degradate (F-18)", () => {
  const report = moderationGuardReadiness(holder(EVERY_PERMISSION.filter(flag => flag !== PermissionFlagsBits.ViewAuditLog)));

  for (const entry of report) assert.equal(entry.state, "blocked", `${entry.type} nu poate identifica autorul`);
  assert.deepEqual(blockingGaps(report), ["View Audit Log"]);
});

test("fara Manage Webhooks doar subprotectia de webhook e degradata, restul raman gata (F-18)", () => {
  const report = moderationGuardReadiness(holder(EVERY_PERMISSION.filter(flag => flag !== PermissionFlagsBits.ManageWebhooks)));

  assert.deepEqual(degradedSubprotections(report).map(entry => entry.type), ["webhook"]);
  assert.deepEqual(blockingGaps(report), [], "o lipsa de corectie nu blocheaza pornirea, doar o marcheaza degradata");
  assert.match(describeGuardReadiness(report), /webhook: lipseste Manage Webhooks/);
});

test("fara Manage Channels, si structura serverului e degradata, nu doar resursele protejate (F-18)", () => {
  const report = moderationGuardReadiness(holder(EVERY_PERMISSION.filter(flag => flag !== PermissionFlagsBits.ManageChannels)));

  assert.deepEqual(
    degradedSubprotections(report).map(entry => entry.type).sort(),
    ["protected-resource-change", "server-structure"],
    "server-structure sterge si recreeaza canale la rollback, deci fara Manage Channels corectia nu se poate aplica"
  );
});

test("fara Ban Members, moderarea in masa nu poate ridica ban-urile aplicate (F-18)", () => {
  const report = moderationGuardReadiness(holder(EVERY_PERMISSION.filter(flag => flag !== PermissionFlagsBits.BanMembers)));

  assert.deepEqual(degradedSubprotections(report).map(entry => entry.type), ["moderation-mass"]);
});

test("un rol la nivelul @everyone blocheaza bot-add si degradeaza restul subprotectiilor (F-18)", () => {
  const report = moderationGuardReadiness(holder(EVERY_PERMISSION, 0));

  assert.deepEqual(report.filter(entry => entry.state === "blocked").map(entry => entry.type), ["bot-add"]);
  assert.equal(degradedSubprotections(report).length, MODERATION_GUARD_TYPES.length - 1);
  assert.match(describeGuardReadiness(report), /deasupra rolului @everyone/);
});

test("readiness-ul se raporteaza per subprotectie, ca /security-status sa nu arate o lipsa comuna (F-18)", () => {
  const gaps = readinessGapsByProtection(
    moderationGuardReadiness(holder(EVERY_PERMISSION.filter(flag => flag !== PermissionFlagsBits.ManageWebhooks)))
  );

  assert.deepEqual(gaps["webhook"], ["Manage Webhooks"]);
  assert.deepEqual(gaps["bot-add"], [], "o subprotectie gata primeste o lista goala explicita, nu lipsurile alteia prin fallback");
  assert.deepEqual(gaps["moderation-guard"], ["Manage Webhooks"]);
});

test("pornirea moderation-guard e refuzata pentru lipsuri critice, nu doar pentru cele de bot-add (F-18)", () => {
  const interaction = moduleContext<SecurityInteraction>({
    guild: { ownerId: "owner-1", members: { me: holder([PermissionFlagsBits.KickMembers]) } },
    user: { id: "owner-1" },
    options: { getBoolean: () => false }
  });

  const gate = protectionToggleGate(interaction, "moderation-guard");

  assert.deepEqual(gate.readinessGaps(), ["View Audit Log"]);
  assert.match(gate.degradedReport() ?? "", /Subprotectii BLOCATE/);
});

test("pornirea anti-raid isi pastreaza propriul readiness, neatins de cel al guard-ului (F-18)", () => {
  const interaction = moduleContext<SecurityInteraction>({
    guild: { ownerId: "owner-1", members: { me: holder(EVERY_PERMISSION, 3) } },
    user: { id: "owner-1" },
    options: { getBoolean: () => true }
  });

  const gate = protectionToggleGate(interaction, "anti-raid");

  assert.ok(gate.readinessGaps().includes("Moderate Members"), "anti-raid cere si Moderate Members");
  assert.equal(gate.degradedReport(), null, "raportul de subprotectii e specific moderation-guard");
});

test("cu permisiunile de bot-add dar fara restul, pornirea reuseste dar raporteaza TOATE subprotectiile degradate (F-18)", () => {
  const interaction = moduleContext<SecurityInteraction>({
    guild: {
      ownerId: "owner-1",
      members: { me: holder([PermissionFlagsBits.ViewAuditLog, PermissionFlagsBits.KickMembers]) }
    },
    user: { id: "owner-1" },
    options: { getBoolean: () => false }
  });

  const gate = protectionToggleGate(interaction, "moderation-guard");

  assert.deepEqual(gate.readinessGaps(), [], "readiness-ul vechi vedea doar bot-add, deci pornirea nu se blocheaza");
  const report = gate.degradedReport() ?? "";
  assert.match(report, /Subprotectii pornite dar degradate/,
    "pana acum guard-ul se marca pornit fara sa spuna ca nu poate gestiona roluri, canale sau webhook-uri");
  for (const type of ["permission-grant", "moderation-mass", "webhook", "server-structure", "protected-resource-change"]) {
    assert.match(report, new RegExp(`- ${type}: lipseste`), `${type} trebuie raportata ca degradata`);
  }
  assert.match(report, /- bot-add: lipseste .*Manage Roles/,
    "de cand bot-add sanctioneaza solicitantul, fara Manage Roles botul e eliminat dar autorul isi pastreaza rolurile");
});

test("in /security-status o subprotectie gata ramane pornita cand alta e degradata (review PR #951)", () => {
  const report = moderationGuardReadiness(holder(EVERY_PERMISSION.filter(flag => flag !== PermissionFlagsBits.ManageWebhooks)));

  const status = buildSecurityStatus({
    settings: moduleContext<GuildSettingsLike>({ moderationGuardEnabled: true, permissionRequestChannelId: "chan-1" }),
    readinessGaps: readinessGapsByProtection(report),
    activeApprovals: 0,
    degradedResources: 0,
    ownerInterventionOperations: 0,
    raidStage: null
  });

  const webhook = status.subprotections.find(entry => entry.key === "webhook");
  const botAdd = status.subprotections.find(entry => entry.key === "bot-add");

  assert.equal(webhook?.state, "degradat");
  assert.equal(botAdd?.state, "pornit", "o lipsa de Manage Webhooks nu are voie sa faca bot-add sa para degradata");
  assert.deepEqual(botAdd?.gaps, []);
});

test("anti-raid pornit pe canalul de cereri nu mai apare incomplet in /security-status (F-43)", () => {
  const status = buildSecurityStatus({
    settings: moduleContext<GuildSettingsLike>({
      antiRaidEnabled: true,
      antiRaidAlertChannelId: null,
      permissionRequestChannelId: "chan-cereri"
    }),
    readinessGaps: {},
    activeApprovals: 0,
    degradedResources: 0,
    ownerInterventionOperations: 0,
    raidStage: null
  });

  const antiRaid = status.protections.find(entry => entry.key === "anti-raid");
  assert.equal(antiRaid?.state, "pornit",
    "runtime-ul publica pe canalul de cereri cand nu exista unul dedicat, deci statusul nu are voie sa raporteze altceva");
  assert.match(antiRaid?.channelNote ?? "", /canalul de cereri/,
    "diferenta fata de configuratia dedicata ramane vizibila, nu ascunsa");
});

test("fara niciun canal, anti-raid ramane raportat incomplet (F-43)", () => {
  const status = buildSecurityStatus({
    settings: moduleContext<GuildSettingsLike>({ antiRaidEnabled: true, antiRaidAlertChannelId: null, permissionRequestChannelId: null }),
    readinessGaps: {},
    activeApprovals: 0,
    degradedResources: 0,
    ownerInterventionOperations: 0,
    raidStage: null
  });

  assert.equal(status.protections.find(entry => entry.key === "anti-raid")?.state, "incomplet");
});

test("o protectie cu canal dedicat nu primeste nota de fallback (F-43)", () => {
  const status = buildSecurityStatus({
    settings: moduleContext<GuildSettingsLike>({
      antiRaidEnabled: true,
      antiRaidAlertChannelId: "chan-raid",
      permissionRequestChannelId: "chan-cereri"
    }),
    readinessGaps: {},
    activeApprovals: 0,
    degradedResources: 0,
    ownerInterventionOperations: 0,
    raidStage: null
  });

  assert.equal(status.protections.find(entry => entry.key === "anti-raid")?.channelNote ?? null, null);
});
