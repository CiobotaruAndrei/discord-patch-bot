import test from "node:test";
import assert from "node:assert/strict";

import { buildSecurityStatus, renderSecurityStatus } from "../../features/command-security/securityStatusModel.js";
import { mergeSecurityLog, pageCount, pageOf, redact, renderSecurityLog, SECURITY_LOG_PAGE_SIZE } from "../../features/command-security/securityLogModel.js";
import { runSecurityOverview } from "../../features/command-handlers/securityOverviewHandler.js";
import { MODERATION_GUARD_TYPES } from "../../features/command-security/moderationGuardDecision.js";
import { moduleContext } from "../moduleContextStub.js";
import type { SecurityLogEntry } from "../../features/command-security/securityLogModel.js";
import type { SecurityStatusInput } from "../../features/command-security/securityStatusModel.js";
import type { GuildSettingsLike } from "../../features/command-security/securitySettingsContracts.js";

const NOW = Date.parse("2026-08-02T16:00:00.000Z");

function statusInput(overrides: Partial<SecurityStatusInput> = {}): SecurityStatusInput {
  return {
    settings: moduleContext<GuildSettingsLike>({}),
    readinessGaps: {},
    activeApprovals: 0,
    degradedResources: 0,
    ownerInterventionOperations: 0,
    raidStage: null,
    ...overrides
  };
}

function entry(overrides: Partial<SecurityLogEntry> = {}): SecurityLogEntry {
  return { source: "audit", at: new Date(NOW), action: "test", actorId: "mod-1", summary: "ceva", ...overrides };
}

test("o protectie oprita este raportata ca oprita, nu ca degradata (F-43)", () => {
  const report = buildSecurityStatus(statusInput());

  const guard = report.protections.find(item => item.key === "moderation-guard");
  assert.equal(guard?.state, "oprit");
});

test("o protectie pornita fara canal este incompleta, nu pornita (F-43)", () => {
  const report = buildSecurityStatus(statusInput({
    settings: moduleContext<GuildSettingsLike>({ moderationGuardEnabled: true })
  }));

  assert.equal(report.protections.find(item => item.key === "moderation-guard")?.state, "incomplet");
});

test("o protectie pornita cu lipsuri de permisiuni este degradata si le enumera (F-43)", () => {
  const report = buildSecurityStatus(statusInput({
    settings: moduleContext<GuildSettingsLike>({ antiRaidEnabled: true, antiRaidAlertChannelId: "chan-1" }),
    readinessGaps: { "anti-raid": ["Ban Members", "Manage Roles"] }
  }));

  const antiRaid = report.protections.find(item => item.key === "anti-raid");
  assert.equal(antiRaid?.state, "degradat");
  assert.deepEqual(antiRaid?.gaps, ["Ban Members", "Manage Roles"]);
  assert.match(renderSecurityStatus(report), /Ban Members, Manage Roles/);
});

test("toate cele sase subprotectii moderation-guard apar in raport (F-43)", () => {
  const report = buildSecurityStatus(statusInput({
    settings: moduleContext<GuildSettingsLike>({ moderationGuardEnabled: true, permissionRequestChannelId: "chan-1" })
  }));

  assert.deepEqual(report.subprotections.map(item => item.key).sort(), [...MODERATION_GUARD_TYPES].sort());
  for (const sub of report.subprotections) assert.equal(sub.state, "pornit");
});

test("raportul arata aprobarile active, resursele degradate si operatiunile blocate (F-43)", () => {
  const text = renderSecurityStatus(buildSecurityStatus(statusInput({
    activeApprovals: 3,
    degradedResources: 2,
    ownerInterventionOperations: 1,
    raidStage: "containment"
  })));

  assert.match(text, /Aprobari active: 3/);
  assert.match(text, /degradate: 2/);
  assert.match(text, /interventia ownerului: 1/);
  assert.match(text, /etapa: containment/);
});

test("fara incident activ raportul o spune explicit (F-43)", () => {
  assert.match(renderSecurityStatus(buildSecurityStatus(statusInput())), /Niciun incident anti-raid activ/);
});

test("cronologia pune cele mai recente incidente primele, indiferent de sursa (F-42)", () => {
  const merged = mergeSecurityLog([
    entry({ source: "audit", at: new Date(NOW - 1000), action: "vechi" }),
    entry({ source: "raid", at: new Date(NOW), action: "nou" }),
    entry({ source: "ad", at: new Date(NOW - 5000), action: "cel-mai-vechi" })
  ]);

  assert.deepEqual(merged.map(item => item.action), ["nou", "vechi", "cel-mai-vechi"]);
});

test("token-urile, linkurile si ID-urile sunt redactate (F-42)", () => {
  const text = redact("token MTIzNDU2Nzg5MDEyMzQ1Njc4.GaBcDe.fghijklmnopqrstuvwxyz123456 pe https://evil.example/x pentru 123456789012345678");

  assert.match(text, /\[token redactat\]/);
  assert.match(text, /\[link redactat\]/);
  assert.doesNotMatch(text, /123456789012345678/);
  assert.match(text, /1234…78/);
});

test("paginarea respecta dimensiunea si numara paginile corect (F-42)", () => {
  const entries = Array.from({ length: SECURITY_LOG_PAGE_SIZE * 2 + 3 }, (_unused, index) =>
    entry({ at: new Date(NOW - index * 1000), action: `a${index}` }));

  assert.equal(pageCount(entries), 3);
  assert.equal(pageOf(entries, 1).length, SECURITY_LOG_PAGE_SIZE);
  assert.equal(pageOf(entries, 3).length, 3);
  assert.deepEqual(pageOf(entries, 1)[0], entries[0]);
});

test("o pagina in afara intervalului e adusa inapoi la ultima, nu produce lista goala (F-42)", () => {
  const entries = [entry({ action: "unic" })];

  assert.match(renderSecurityLog(entries, 99), /pagina 1\/1/);
  assert.match(renderSecurityLog(entries, 0), /pagina 1\/1/);
});

test("fara incidente, mesajul o spune in loc sa arate o lista goala (F-42)", () => {
  assert.match(renderSecurityLog([], 1), /Nu exista incidente/);
});

test("/security-log filtreaza dupa sursa (F-42)", async () => {
  const entries = [
    entry({ source: "raid", action: "raid-1" }),
    entry({ source: "audit", action: "audit-1" }),
    entry({ source: "ad", action: "ad-1" })
  ];

  const text = await runSecurityOverview(
    { guildId: "g1", command: "security-log", source: "raid", page: 1 },
    { readLog: async () => entries, readStatus: async () => statusInput() }
  );

  assert.match(text, /raid-1/);
  assert.doesNotMatch(text, /audit-1/);
  assert.doesNotMatch(text, /ad-1/);
});

test("/security-status trece prin acelasi handler si produce raportul (F-43)", async () => {
  const text = await runSecurityOverview(
    { guildId: "g1", command: "security-status", source: null, page: 1 },
    {
      readLog: async () => [],
      readStatus: async () => statusInput({ settings: moduleContext<GuildSettingsLike>({ adProtectionEnabled: true, adAlertChannelId: "chan-1" }) })
    }
  );

  assert.match(text, /Protectie reclame: \*\*pornit\*\*/);
  assert.match(text, /Subprotectii moderation-guard/);
});
