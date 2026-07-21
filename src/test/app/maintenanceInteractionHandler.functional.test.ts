import test from "node:test";
import assert from "node:assert/strict";

import type { GuildSettings } from "../../types.js";
import type { GuildConfigBackupRecord } from "../../features/admin-records/configBackupRepository.js";

import installMaintenance from "../../features/command-handlers/maintenanceInteractionHandler.js";

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

function makeDeps(settings: GuildSettings | null, outboxCount: number, paused: boolean, backups: GuildConfigBackupRecord[] = [], youtubeErrorCount = 0, deadLetterCount = 0, unresolvedAlertSends = 0, lockRecoveries = 0) {
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
    GuildYoutubeErrorModel: { countDocuments: async () => youtubeErrorCount },
    GuildDeadLetterModel: { countDocuments: async () => deadLetterCount },
    NewAccountAlertDeliveryModel: { countDocuments: async () => unresolvedAlertSends },
    ChannelLockRecoveryModel: { countDocuments: async () => lockRecoveries },
    MessageFlags: { Ephemeral: 64 }
  };
}

test("buildMaintenanceReport semnaleaza outbox, dead-letter, backup vechi si canal lipsa", async () => {
  const settings: GuildSettings = {
    _id: "guild-1",
    subscribed: true,
    notificationChannelId: null
  };
  const backups: GuildConfigBackupRecord[] = [{
    guildId: "guild-1",
    name: "old",
    createdBy: "admin",
    createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
    snapshot: {}
  }];

  const report = await installMaintenance.buildMaintenanceReport(makeDeps(settings, 3, true, backups, 1, 1), "guild-1");

  assert.match(report, /ATENTIE: surse YouTube - 1 erori recente/, "numaratoarea vine din colectia guildYoutubeErrors, nu din setari");
  assert.match(report, /ATENTIE: outbox - 3 joburi/);
  assert.match(report, /ATENTIE: dead-letter - 1/, "numaratoarea dead-letter vine din colectia guildDeadLetters, nu din setari");
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

test("buildMaintenanceReport acopera player-count, alerte cont nou, amenintari si adaugare boti (audit 154 #9)", async () => {
  const settings: GuildSettings = {
    _id: "guild-1",
    playerCountSubscribed: true,
    playerCountChannelId: null,
    newAccountAlertsEnabled: true,
    newAccountAlertChannelId: null,
    threatProtectionEnabled: true,
    threatAlertChannelId: null,
    botAddProtectionEnabled: true,
    botAddAlertChannelId: null
  };

  const report = await installMaintenance.buildMaintenanceReport(makeDeps(settings, 0, false), "guild-1");

  assert.match(
    report,
    /lipseste canalul pentru: player-count, alerte cont nou, protectie amenintari, protectie adaugare boti/,
    "modulele de protectie/monitorizare fara canal trebuie semnalate, nu doar cele clasice de notificare"
  );
  assert.match(
    report,
    /OK: notificari - cel putin un modul de notificare este activ/,
    "un modul de protectie activ (fara vreun modul clasic) conteaza ca modul activ"
  );
});

test("MAINTENANCE_MODULES include modulele de protectie ca sa nu poata fi uitate la extindere (audit 154 #9)", () => {
  const enabledFields = installMaintenance.MAINTENANCE_MODULES.map(module => module.enabledField);
  for (const field of ["playerCountSubscribed", "newAccountAlertsEnabled", "threatProtectionEnabled", "botAddProtectionEnabled"]) {
    assert.ok(enabledFields.includes(field as (typeof enabledFields)[number]), `inventarul de mentenanta trebuie sa contina ${field}`);
  }
});

test("buildMaintenanceReport raporteaza ultima eroare DLC din inventarul declarativ (audit 154 #9)", async () => {
  const settings: GuildSettings = {
    _id: "guild-1",
    dlcSubscribed: true,
    dlcChannelId: "dlc-ok",
    dlcLastError: { message: "steam dlc feed 503" }
  };

  const report = await installMaintenance.buildMaintenanceReport(makeDeps(settings, 0, false), "guild-1");

  assert.match(report, /ATENTIE: DLC - steam dlc feed 503/, "linia de ultima-eroare acopera si DLC, nu doar update-uri/reduceri");
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

test("buildMaintenanceReport expune alertele de cont nou ramase cu stare nedeterminata (audit 154c #2)", async () => {
  const settings = { _id: "guild-1", subscribed: true, notificationChannelId: "chan-1" } as GuildSettings;

  const clean = await installMaintenance.buildMaintenanceReport(makeDeps(settings, 0, false, [], 0, 0, 0), "guild-1");
  assert.match(clean, /OK: alerte cont nou nefinalizate - fara trimiteri cu stare nedeterminata/);

  const stuck = await installMaintenance.buildMaintenanceReport(makeDeps(settings, 0, false, [], 0, 0, 2), "guild-1");
  assert.match(stuck, /ATENTIE: alerte cont nou nefinalizate - 2 trimise cu stare nedeterminata/);
  assert.match(stuck, /nu se retrimit/, "raportul spune explicit ca nu exista risc de duplicat");
});

test("buildMaintenanceReport expune divergentele lock/unlock ramase in asteptare (audit 154c #3)", async () => {
  const settings = { _id: "guild-1", subscribed: true, notificationChannelId: "chan-1" } as GuildSettings;

  const clean = await installMaintenance.buildMaintenanceReport(makeDeps(settings, 0, false, [], 0, 0, 0, 0), "guild-1");
  assert.match(clean, /OK: recovery lock\/unlock - fara divergente in asteptare/);

  const pending = await installMaintenance.buildMaintenanceReport(makeDeps(settings, 0, false, [], 0, 0, 0, 3), "guild-1");
  assert.match(pending, /ATENTIE: recovery lock\/unlock - 3 canale cu divergenta/);
  assert.match(pending, /reincercate automat pana la convergenta/, "raportul spune ca recuperarea e automata, nu manuala");
});
