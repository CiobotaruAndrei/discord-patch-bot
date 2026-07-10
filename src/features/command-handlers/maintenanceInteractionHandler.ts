"use strict";

import type { ConfigBackupRecord, GameConfig, GuildSettings } from "../../types";
import type { CommandHandler } from "../command-registry/commandHandler";
import { matchesCommand } from "../command-registry/commandMatch";
import { findNewestConfigBackup, type ConfigBackupModelLike } from "../admin-records/configBackupRepository";
import { countYoutubeErrors, type YoutubeErrorModelLike } from "../youtube/youtubeErrorsRepository";

const { errorDetail } = require("../../shared/errors") as typeof import("../../shared/errors");

type Logger = (level: string, context: string, message: string, meta?: unknown) => void;
type CommandLogEnd = (status?: string, extra?: Record<string, unknown>) => void;

interface DiscordInteraction {
  commandName?: string;
  guild?: { id: string } | null;
  deferred?: boolean;
  replied?: boolean;
  isChatInputCommand?: () => boolean;
  reply?: (payload: unknown) => Promise<unknown>;
  followUp?: (payload: unknown) => Promise<unknown>;
}

interface CountModel {
  countDocuments(filter?: unknown): Promise<number>;
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
  MessageFlags: { Ephemeral: number };
}

type MaintenanceContext = MaintenanceDeps & {
  handleInteraction?: (interaction: DiscordInteraction, games: GameConfig[]) => Promise<unknown> | unknown;
};

function isOldBackup(newestBackup: ConfigBackupRecord | null, now: number): boolean {
  if (!newestBackup) return true;
  const newest = new Date(newestBackup.createdAt).getTime();
  if (!Number.isFinite(newest)) return true;
  return now - newest > 30 * 24 * 60 * 60 * 1000;
}

function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function issueLine(ok: boolean, label: string, detail: string): string {
  return `${ok ? "OK" : "ATENTIE"}: ${label} - ${detail}`;
}

async function buildMaintenanceReport(deps: MaintenanceDeps, guildId: string): Promise<string> {
  const [settings, queued, paused, newestBackup, youtubeErrors] = await Promise.all([
    deps.getGuildSettings(guildId),
    deps.NotificationOutboxModel.countDocuments({ guildId }).catch(() => -1),
    deps.getOutboxPaused().catch(() => null),
    findNewestConfigBackup(deps.GuildConfigBackupModel, guildId).catch(() => null),
    countYoutubeErrors(deps.GuildYoutubeErrorModel, guildId)
  ]);
  const now = Date.now();
  const deadLetters = countArray(settings?.notificationDeadLetter);
  const backupsOld = isOldBackup(newestBackup, now);
  const updateChannelOk = settings?.subscribed ? Boolean(settings.notificationChannelId) : true;
  const discountChannelOk = settings?.discountsSubscribed ? Boolean(settings.discountChannelId) : true;
  const youtubeChannelOk = settings?.youtubeNotificationsEnabled ? Boolean(settings.youtubeNotificationChannelId) : true;
  const futureReleaseOk = settings?.futureReleaseSubscribed ? Boolean(settings.futureReleaseChannelId) : true;
  const dlcOk = settings?.dlcSubscribed ? Boolean(settings.dlcChannelId) : true;
  const missingChannels = [
    updateChannelOk ? null : "update-uri",
    discountChannelOk ? null : "reduceri",
    youtubeChannelOk ? null : "YouTube",
    futureReleaseOk ? null : "future-release",
    dlcOk ? null : "DLC"
  ].filter((name): name is string => name !== null);
  const channelsDetail = missingChannels.length === 0
    ? "toate modulele active au canalul configurat"
    : `lipseste canalul pentru: ${missingChannels.join(", ")}`;
  const lines = [
    "**Maintenance check**",
    issueLine(youtubeErrors === 0, "surse YouTube", youtubeErrors === 0 ? "fara erori recente salvate" : `${youtubeErrors} erori recente`),
    issueLine(!settings?.updatesLastError?.message, "update-uri", settings?.updatesLastError?.message || "fara ultima eroare salvata"),
    issueLine(!settings?.discountsLastError?.message, "reduceri", settings?.discountsLastError?.message || "fara ultima eroare salvata"),
    issueLine(queued === 0, "outbox", queued < 0 ? "nu am putut citi coada" : `${queued} joburi in coada`),
    issueLine(deadLetters === 0, "dead-letter", deadLetters === 0 ? "gol" : `${deadLetters} livrari esuate definitiv`),
    issueLine(paused !== true, "drenare outbox", paused === null ? "stare necunoscuta" : paused ? "pe pauza" : "activa"),
    issueLine(!backupsOld, "backup configuratie", backupsOld ? "lipseste sau e mai vechi de 30 zile" : "recent"),
    issueLine(missingChannels.length === 0, "canale notificari", channelsDetail),
    issueLine(settings?.subscribed === true || settings?.discountsSubscribed === true || settings?.youtubeNotificationsEnabled === true || settings?.futureReleaseSubscribed === true || settings?.dlcSubscribed === true, "notificari", "cel putin un modul de notificare este activ")
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

export = {
  createMaintenanceInteractionHandler,
  buildMaintenanceReport,
  buildCommandHandler: buildMaintenanceCommandHandler
};
