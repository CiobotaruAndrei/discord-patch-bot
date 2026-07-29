"use strict";

import type {
  BaseChatInputInteraction
} from "./discordInteractionPorts.js";
import type { ConfigBackupRecord, GameConfig, GuildConfigurationSettings, GuildOperationalSettings, GuildSettings } from "../../types.js";
type MongoFilter = Record<string, unknown>;
import type { CommandHandler } from "../command-registry/commandHandler.js";
import { matchesCommand } from "../command-registry/commandMatch.js";
import { findNewestConfigBackup, type ConfigBackupModelLike } from "../admin-records/configBackupRepository.js";
import { countYoutubeErrors, type YoutubeErrorModelLike } from "../youtube/youtubeErrorsRepository.js";
import { countDeadLetters, type DeadLetterModelLike } from "../notifications/deadLetterRepository.js";
import { countUnresolvedNewAccountSends, type NewAccountAlertDeliveryModelLike } from "../command-security/newAccountAlertDedup.js";
import { countChannelLockRecoveries, type ChannelLockRecoveryModelLike } from "../command-security/channelLockRecoveryRepository.js";

import { errorDetail } from "../../shared/errors.js";

type Logger = (level: string, context: string, message: string, meta?: unknown) => void;
type CommandLogEnd = (status?: string, extra?: Record<string, unknown>) => void;

type DiscordInteraction = BaseChatInputInteraction;

interface CountModel {
  countDocuments(filter?: MongoFilter): Promise<number>;
}

interface MaintenanceDeps {
  logger: Logger;
  enforceCooldown(interaction: DiscordInteraction, command: string): Promise<boolean>;
  startCommandLog(interaction: DiscordInteraction, command: string, extra?: Record<string, unknown>): CommandLogEnd;
  safeDefer(interaction: DiscordInteraction, ephemeral?: boolean): Promise<void>;
  safeEdit(interaction: DiscordInteraction, payload: unknown): Promise<unknown>;
  getGuildSettings(guildId: string): Promise<GuildSettings | null>;
  getOutboxPaused(): Promise<boolean>;
  NotificationOutboxModel: CountModel;
  GuildConfigBackupModel: Pick<ConfigBackupModelLike, "find">;
  GuildYoutubeErrorModel: Pick<YoutubeErrorModelLike, "countDocuments">;
  GuildDeadLetterModel: Pick<DeadLetterModelLike, "countDocuments">;
  NewAccountAlertDeliveryModel?: Pick<NewAccountAlertDeliveryModelLike, "countDocuments">;
  ChannelLockRecoveryModel?: Pick<ChannelLockRecoveryModelLike, "countDocuments">;
  MessageFlags: { Ephemeral: number };
}

type MaintenanceContext = MaintenanceDeps;

interface MaintenanceModule {
  label: string;
  enabledField: keyof GuildConfigurationSettings;
  channelField: keyof GuildConfigurationSettings;
  lastErrorField?: keyof GuildOperationalSettings;
}

const MAINTENANCE_MODULES: readonly MaintenanceModule[] = [
  { label: "update-uri", enabledField: "subscribed", channelField: "notificationChannelId", lastErrorField: "updatesLastError" },
  { label: "reduceri", enabledField: "discountsSubscribed", channelField: "discountChannelId", lastErrorField: "discountsLastError" },
  { label: "YouTube", enabledField: "youtubeNotificationsEnabled", channelField: "youtubeNotificationChannelId" },
  { label: "future-release", enabledField: "futureReleaseSubscribed", channelField: "futureReleaseChannelId" },
  { label: "DLC", enabledField: "dlcSubscribed", channelField: "dlcChannelId", lastErrorField: "dlcLastError" },
  { label: "player-count", enabledField: "playerCountSubscribed", channelField: "playerCountChannelId" },
  { label: "alerte cont nou", enabledField: "newAccountAlertsEnabled", channelField: "newAccountAlertChannelId" },
  { label: "protectie amenintari", enabledField: "threatProtectionEnabled", channelField: "threatAlertChannelId" },
  { label: "protectie adaugare boti", enabledField: "botAddProtectionEnabled", channelField: "botAddAlertChannelId" }
];

function isOldBackup(newestBackup: ConfigBackupRecord | null, now: number): boolean {
  if (!newestBackup) return true;
  const newest = new Date(newestBackup.createdAt).getTime();
  if (!Number.isFinite(newest)) return true;
  return now - newest > 30 * 24 * 60 * 60 * 1000;
}

function issueLine(ok: boolean, label: string, detail: string): string {
  return `${ok ? "OK" : "ATENTIE"}: ${label} - ${detail}`;
}

function isModuleEnabled(settings: GuildSettings | null, module: MaintenanceModule): boolean {
  return Boolean(settings?.[module.enabledField]);
}

function isModuleChannelConfigured(settings: GuildSettings | null, module: MaintenanceModule): boolean {
  return Boolean(settings?.[module.channelField]);
}

function readLastErrorMessage(value: unknown): string {
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

async function buildMaintenanceReport(deps: MaintenanceDeps, guildId: string): Promise<string> {
  const [settings, queued, paused, newestBackup, youtubeErrors, deadLetters, unresolvedAlertSends, lockRecoveries] = await Promise.all([
    deps.getGuildSettings(guildId),
    deps.NotificationOutboxModel.countDocuments({ guildId }).catch(() => -1),
    deps.getOutboxPaused().catch(() => null),
    findNewestConfigBackup(deps.GuildConfigBackupModel, guildId).catch(() => null),
    countYoutubeErrors(deps.GuildYoutubeErrorModel, guildId),
    countDeadLetters(deps.GuildDeadLetterModel, guildId),
    deps.NewAccountAlertDeliveryModel ? countUnresolvedNewAccountSends(deps.NewAccountAlertDeliveryModel, guildId) : Promise.resolve(0),
    deps.ChannelLockRecoveryModel ? countChannelLockRecoveries(deps.ChannelLockRecoveryModel, guildId) : Promise.resolve(0)
  ]);
  const now = Date.now();
  const backupsOld = isOldBackup(newestBackup, now);
  const missingChannels = MAINTENANCE_MODULES
    .filter(module => isModuleEnabled(settings, module) && !isModuleChannelConfigured(settings, module))
    .map(module => module.label);
  const channelsDetail = missingChannels.length === 0
    ? "toate modulele active au canalul configurat"
    : `lipseste canalul pentru: ${missingChannels.join(", ")}`;
  const anyModuleActive = MAINTENANCE_MODULES.some(module => isModuleEnabled(settings, module));
  const moduleErrorLines = MAINTENANCE_MODULES.flatMap(module => {
    const field = module.lastErrorField;
    if (!field) return [];
    const message = readLastErrorMessage(settings?.[field]);
    return [issueLine(!message, module.label, message || "fara ultima eroare salvata")];
  });
  const lines = [
    "**Maintenance check**",
    issueLine(youtubeErrors === 0, "surse YouTube", youtubeErrors === 0 ? "fara erori recente salvate" : `${youtubeErrors} erori recente`),
    ...moduleErrorLines,
    issueLine(queued === 0, "outbox", queued < 0 ? "nu am putut citi coada" : `${queued} joburi in coada`),
    issueLine(deadLetters === 0, "dead-letter", deadLetters === 0 ? "gol" : `${deadLetters} livrari esuate definitiv`),
    issueLine(
      unresolvedAlertSends === 0,
      "alerte cont nou nefinalizate",
      unresolvedAlertSends < 0
        ? "nu am putut citi starea"
        : unresolvedAlertSends === 0
          ? "fara trimiteri cu stare nedeterminata"
          : `${unresolvedAlertSends} trimise cu stare nedeterminata (nu se retrimit; se inchid automat la urmatoarea pornire)`
    ),
    issueLine(
      lockRecoveries === 0,
      "recovery lock/unlock",
      lockRecoveries < 0
        ? "nu am putut citi inregistrarile"
        : lockRecoveries === 0
          ? "fara divergente in asteptare"
          : `${lockRecoveries} canale cu divergenta Discord/persistenta, reincercate automat pana la convergenta`
    ),
    issueLine(paused !== true, "drenare outbox", paused === null ? "stare necunoscuta" : paused ? "pe pauza" : "activa"),
    issueLine(!backupsOld, "backup configuratie", backupsOld ? "lipseste sau e mai vechi de 30 zile" : "recent"),
    issueLine(missingChannels.length === 0, "canale notificari", channelsDetail),
    issueLine(anyModuleActive, "notificari", "cel putin un modul de notificare este activ")
  ];
  return lines.join("\n");
}

function createMaintenanceInteractionHandler(deps: MaintenanceDeps) {
  async function handleMaintenance(interaction: DiscordInteraction): Promise<unknown> {
    const guildId = interaction.guild?.id;
    if (!guildId) return undefined;
    if (!(await deps.enforceCooldown(interaction, "maintenance"))) return undefined;
    const endLog = deps.startCommandLog(interaction, "maintenance");
    await deps.safeDefer(interaction, true);
    const report = await buildMaintenanceReport(deps, guildId);
    endLog("ok");
    return deps.safeEdit(interaction, report);
  }

  return { handleMaintenance };
}

function isMaintenanceCommand(interaction: DiscordInteraction): boolean {
  return matchesCommand(interaction, { commandNames: ["maintenance"] });
}

function buildMaintenanceCommandHandler(target: MaintenanceContext) {
  const handlers = createMaintenanceInteractionHandler(target);
  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => isMaintenanceCommand(interaction as DiscordInteraction),
    handle: async (interaction) => {
      try {
        return await handlers.handleMaintenance(interaction);
      } catch (err: unknown) {
        target.logger("ERROR", "MAINTENANCE", "Eroare in /maintenance", errorDetail(err));
        const payload = { content: "Eroare: nu am putut genera sumarul de mentenanta.", flags: target.MessageFlags.Ephemeral };
        try {
          if ((interaction.deferred || interaction.replied) && typeof interaction.followUp === "function") await interaction.followUp(payload);
          else if (typeof interaction.reply === "function") await interaction.reply(payload);
        } catch {}
        return undefined;
      }
    }
  };
  return { handlers, ...command };
}

export default {
  createMaintenanceInteractionHandler,
  buildMaintenanceReport,
  MAINTENANCE_MODULES,
  buildCommandHandler: buildMaintenanceCommandHandler
};
