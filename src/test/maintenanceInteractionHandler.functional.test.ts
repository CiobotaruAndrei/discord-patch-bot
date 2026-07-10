import test from "node:test";
import assert from "node:assert/strict";

import type { GuildSettings } from "../types";
import type { GuildConfigBackupRecord } from "../features/admin-records/configBackupRepository";

const installMaintenance = require("../features/command-handlers/maintenanceInteractionHandler") as typeof import("../features/command-handlers/maintenanceInteractionHandler");

function makeBackupModel(docs: GuildConfigBackupRecord[]) {
  return {
    find: (filter: Record<string, unknown>) => {
      let sorted = docs.filter(doc => doc.guildId === filter.guildId);
      let skipped = 0;
      let limited = Number.POSITIVE_INFINITY;
      const chain = {
        sort: () => {
          sorted = [...sorted].sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
          return chain;
        },
        skip: (count: number) => { skipped = count; return chain; },
        limit: (count: number) => { limited = count; return chain; },
        lean: async () => sorted.slice(skipped, skipped + limited)
      };
      return chain;
    }
  };
}

function makeDeps(settings: GuildSettings | null, outboxCount: number, paused: boolean, backups: GuildConfigBackupRecord[] = []) {
  return {
    logger: () => undefined,
    enforceCooldown: async () => true,
    startCommandLog: () => () => undefined,
    safeDefer: async () => undefined,
    safeEdit: async (_interaction: unknown, payload: unknown) => payload,
    getGuildSettings: async () => settings,
    getOutboxPaused: async () => paused,
    NotificationOutboxModel: {
      countDocuments: async () => outboxCount
    },
    GuildConfigBackupModel: makeBackupModel(backups),
    MessageFlags: { Ephemeral: 64 }
  };
}

test("buildMaintenanceReport semnaleaza outbox, dead-letter, backup vechi si canal lipsa", async () => {
  const settings: GuildSettings = {
    _id: "guild-1",
    subscribed: true,
    notificationChannelId: null,
    notificationDeadLetter: [{ kind: "update", itemId: "u1", reason: "missing channel" }],
    youtubeErrors: [{ channelId: "yt1", channelName: "YT", message: "feed error", at: new Date() }]
  };
  const backups: GuildConfigBackupRecord[] = [{
    guildId: "guild-1",
    name: "old",
    createdBy: "admin",
    createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
    snapshot: {}
  }];

  const report = await installMaintenance.buildMaintenanceReport(makeDeps(settings, 3, true, backups), "guild-1");

  assert.match(report, /ATENTIE: surse YouTube/);
  assert.match(report, /ATENTIE: outbox - 3 joburi/);
  assert.match(report, /ATENTIE: dead-letter - 1/);
  assert.match(report, /ATENTIE: drenare outbox - pe pauza/);
  assert.match(report, /ATENTIE: backup configuratie/, "cel mai nou backup din colectia guildConfigBackups e mai vechi de 30 zile");
  assert.match(report, /ATENTIE: canale notificari/);
  assert.match(report, /lipseste canalul pentru: update-uri/, "raportul (P5) listeaza exact ce modul are canalul lipsa, nu generic");
});

test("buildMaintenanceReport raporteaza OK cand cel mai nou backup din colectie e recent (si ATENTIE cand nu exista deloc)", async () => {
  const settings: GuildSettings = { _id: "guild-1", discountsSubscribed: true, discountChannelId: "deals" };
  const backups: GuildConfigBackupRecord[] = [
    { guildId: "guild-1", name: "vechi", createdBy: "admin", createdAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), snapshot: {} },
    { guildId: "guild-1", name: "proaspat", createdBy: "admin", createdAt: new Date(), snapshot: {} }
  ];

  const freshReport = await installMaintenance.buildMaintenanceReport(makeDeps(settings, 0, false, backups), "guild-1");
  assert.match(freshReport, /OK: backup configuratie - recent/, "conteaza cel mai NOU backup, nu cel mai vechi");

  const emptyReport = await installMaintenance.buildMaintenanceReport(makeDeps(settings, 0, false, []), "guild-1");
  assert.match(emptyReport, /ATENTIE: backup configuratie - lipseste/);
});

test("buildMaintenanceReport enumera toate modulele cu canal lipsa", async () => {
  const settings: GuildSettings = {
    _id: "guild-1",
    subscribed: true,
    notificationChannelId: null,
    futureReleaseSubscribed: true,
    futureReleaseChannelId: null,
    dlcSubscribed: true,
    dlcChannelId: "dlc-ok"
  };
  const report = await installMaintenance.buildMaintenanceReport(makeDeps(settings, 0, false), "guild-1");
  assert.match(report, /lipseste canalul pentru: update-uri, future-release/);
  assert.doesNotMatch(report, /lipseste canalul pentru:[^\n]*DLC/, "DLC are canal configurat, deci nu apare ca lipsa");
});

test("/maintenance ruleaza cooldown, log si returneaza raport ephemeral", async () => {
  const replies: unknown[] = [];
  const statuses: string[] = [];
  const handler = installMaintenance.createMaintenanceInteractionHandler({
    ...makeDeps({ _id: "guild-1", discountsSubscribed: true, discountChannelId: "deals" }, 0, false),
    startCommandLog: () => (status?: string) => { if (status) statuses.push(status); },
    safeEdit: async (_interaction, payload) => { replies.push(payload); return payload; }
  });

  await handler.handleMaintenance({
    commandName: "maintenance",
    guild: { id: "guild-1" },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    reply: async payload => payload,
    followUp: async payload => payload
  });

  assert.deepEqual(statuses, ["ok"]);
  assert.match(String(replies[0]), /Maintenance check/);
});
