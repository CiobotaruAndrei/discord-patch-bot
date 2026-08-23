import test from "node:test";
import assert from "node:assert/strict";

import { buildSecurityStatus, renderSecurityStatus } from "../../features/command-security/securityStatusModel.js";
import { mergeSecurityLog, pageCount, pageOf, redact, renderSecurityLog, SECURITY_LOG_MAX_LENGTH, SECURITY_LOG_PAGE_SIZE } from "../../features/command-security/securityLogModel.js";
import { buildCommandHandler, composeSecurityOverviewDeps, runSecurityOverview } from "../../features/command-handlers/securityOverviewHandler.js";
import { MODERATION_GUARD_TYPES } from "../../features/command-security/moderationGuardDecision.js";
import { moduleContext } from "../moduleContextStub.js";
import { adStore } from "./adStore.js";
import { permissionRequestStore } from "./permissionRequestStore.js";
import { protectedResourceStore } from "./protectedResourceStore.js";
import { raidIncidentStore } from "./raidIncidentStore.js";
import type { SecurityLogEntry } from "../../features/command-security/securityLogModel.js";
import type { SecurityStatusInput } from "../../features/command-security/securityStatusModel.js";
import type { GuildSettingsLike } from "../../features/command-security/securitySettingsContracts.js";
import type { SecurityOverviewContext } from "../../features/command-handlers/securityOverviewHandler.js";

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

function overviewContext(overrides: Partial<SecurityOverviewContext> = {}): SecurityOverviewContext {
  return moduleContext<SecurityOverviewContext>({
    GuildAuditLogModel: {
      create: async () => undefined,
      find: () => ({
        sort: () => ({
          skip: () => ({
            limit: () => ({ lean: async () => [] })
          })
        })
      })
    },
    RaidIncidentModel: raidIncidentStore(),
    PermissionRequestModel: permissionRequestStore(),
    ProtectedResourceModel: protectedResourceStore(),
    RaidSnapshotModel: {
      findOne: () => ({ lean: async () => null }),
      updateOne: async () => ({ matchedCount: 0, modifiedCount: 0 })
    },
    AdRequestModel: adStore(),
    AdAttemptModel: adStore(),
    getGuildSettings: async () => moduleContext<GuildSettingsLike>({}),
    ...overrides
  });
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

test("pagina de securitate ramane in limita de 2.000 de caractere Discord", () => {
  const entries = Array.from({ length: SECURITY_LOG_PAGE_SIZE }, (_unused, index) => entry({
    action: `incident-${index}`,
    summary: "detaliu ".repeat(500)
  }));

  assert.ok(renderSecurityLog(entries, 1).length <= SECURITY_LOG_MAX_LENGTH);
});

test("cronologia compusa include aprobarile si tentativele de reclama", async () => {
  const future = new Date(NOW + 60_000);
  const permissionRequests = permissionRequestStore([{
    _id: "permission-1", guildId: "g1", type: "bot-add", requesterId: "user-1", reason: "bot nou",
    status: "pending", target: "bot-1", action: "add", requestedAt: new Date(NOW), expiresAt: future
  }]);
  const adRequests = adStore([{
    _id: "ad-1", guildId: "g1", requesterId: "user-2", adText: "mesaj", fingerprint: "fp",
    link: null, invite: null, attachmentUrl: null, target: "canal", status: "pending", ownerId: null,
    requestedAt: new Date(NOW), respondedAt: null, usedAt: null, expiresAt: future
  }]);
  const adAttempts = adStore([{
    _id: "g1:user-3", guildId: "g1", userId: "user-3", strikes: 1, totalDeleted: 1, totalWarns: 0,
    lastAttemptAt: new Date(NOW), lastChannelId: "channel-1",
    history: [{ at: new Date(NOW), channelId: "channel-1", summary: "reclama blocata", warned: false }]
  }]);
  const deps = composeSecurityOverviewDeps(overviewContext({
    PermissionRequestModel: permissionRequests,
    AdRequestModel: adRequests,
    AdAttemptModel: adAttempts
  }));

  const log = await deps.readLog("g1");
  assert.ok(log.some(item => item.source === "approval" && item.action.includes("bot-add")));
  assert.ok(log.some(item => item.source === "approval" && item.action.includes("reclama")));
  assert.ok(log.some(item => item.source === "ad" && item.summary.includes("reclama blocata")));
});

test("statusul numara operatiunile de recovery care cer interventia ownerului", async () => {
  const incidents = raidIncidentStore([{
    _id: "raid-1", guildId: "g1", stage: "containment", startedAt: new Date(NOW),
    triggerReason: "test", participants: [], lockedChannels: [], pendingActions: [], errors: []
  }]);
  const snapshots = moduleContext<SecurityOverviewContext["RaidSnapshotModel"]>({
    findOne: () => ({ lean: async () => ({
      _id: "raid-1", guildId: "g1", snapshot: {}, operations: [
        { kind: "recreate-role", resourceId: "role-1", label: "rol", status: "owner-intervention-required", attempts: 1, detail: "ierarhie" },
        { kind: "recreate-channel", resourceId: "channel-1", label: "canal", status: "done", attempts: 1, detail: null }
      ]
    }) }),
    updateOne: async () => ({ matchedCount: 0, modifiedCount: 0 })
  });
  const deps = composeSecurityOverviewDeps(overviewContext({ RaidIncidentModel: incidents, RaidSnapshotModel: snapshots }));

  const status = await deps.readStatus("g1");
  assert.equal(status.ownerInterventionOperations, 1);
  assert.equal(status.raidStage, "containment");
});

test("statusul foloseste permisiunile Discord live pentru a marca protectia degradata", async () => {
  const deps = composeSecurityOverviewDeps(overviewContext({
    getGuildSettings: async () => moduleContext<GuildSettingsLike>({ antiRaidEnabled: true, antiRaidAlertChannelId: "channel-1" })
  }));
  const guild = moduleContext<NonNullable<Parameters<typeof deps.readStatus>[1]>>({
    id: "g1",
    members: { me: { permissions: { has: () => false }, roles: { highest: { position: 0 } } } },
    channels: {
      fetch: async () => ({ permissionsFor: () => ({ has: () => true }) })
    }
  });

  const status = await deps.readStatus("g1", guild);
  assert.ok(status.readinessGaps["anti-raid"]?.includes("Ban Members"));
  assert.ok(status.readinessGaps["anti-raid"]?.some(gap => gap.includes("@everyone")));
});

test("o eroare de citire Mongo este raportata ca indisponibilitate", async () => {
  const replies: Array<{ content: string; ephemeral: boolean }> = [];
  const handler = buildCommandHandler(overviewContext({
    getGuildSettings: async () => { throw new Error("mongo indisponibil"); }
  }));
  await handler.handle(moduleContext({
    commandName: "security-status",
    guild: { id: "g1" },
    options: {},
    isChatInputCommand: () => true,
    reply: async (payload: { content: string; ephemeral: boolean }) => { replies.push(payload); }
  }));

  assert.equal(replies.length, 1);
  assert.match(replies[0]?.content ?? "", /nu poate fi citita acum/);
  assert.equal(replies[0]?.ephemeral, true);
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
