"use strict";

import type { DiscordReplyPayload, GameConfig, GuildSettings } from "../../types";
import type { CommandHandler } from "../command-registry/commandHandler";
import {
  deleteConfigBackupWithAudit,
  findBackup,
  listBackups,
  loadConfigBackupWithAudit,
  saveConfigBackup
} from "../admin-records/configBackupRepository";
import { recordServerAuditEntry } from "../admin-records/auditLogRepository";
import { handledCommandError } from "../command-security/commandOutcome";
import { renderBackupList, renderBackupPreview } from "./backupViews";

const { errorDetail } = require("../../shared/errors") as typeof import("../../shared/errors");

type InteractionPayload = DiscordReplyPayload;
type Logger = (level: string, context: string, message: string, meta?: unknown) => void;

interface DiscordInteraction {
  commandName?: string;
  guild?: { id: string } | null;
  user?: { id?: string } | null;
  deferred?: boolean;
  replied?: boolean;
  options: {
    getSubcommand(): string;
    getString(name: string, required?: boolean): string | null;
    getBoolean(name: string, required?: boolean): boolean | null;
  };
  isChatInputCommand?: () => boolean;
  reply?: (payload: unknown) => Promise<unknown>;
  followUp?: (payload: unknown) => Promise<unknown>;
}

interface BackupInteractionDeps {
  GuildModel: Parameters<typeof saveConfigBackup>[0];
  getGuildSettings(guildId: string): Promise<GuildSettings | null>;
  invalidateGuildCache(guildId: string): void;
  safeDefer(interaction: DiscordInteraction, ephemeral?: boolean): Promise<void>;
  safeEdit(interaction: DiscordInteraction, payload: InteractionPayload): Promise<unknown>;
  formatUserError(err: unknown, fallback: string): string;
  logger: Logger;
  MessageFlags: { Ephemeral: number };
}

type BackupContext = BackupInteractionDeps & {
  handleInteraction?: (interaction: DiscordInteraction, games: GameConfig[]) => Promise<unknown> | unknown;
};

function backupName(interaction: DiscordInteraction): string {
  return String(interaction.options.getString("name", true) || "").trim();
}

function requireConfirm(interaction: DiscordInteraction): boolean {
  return interaction.options.getBoolean("confirm", true) === true;
}

function createBackupInteractionHandler(deps: BackupInteractionDeps) {
  const { GuildModel, getGuildSettings, invalidateGuildCache, safeDefer, safeEdit, formatUserError } = deps;

  async function auditBestEffort(guildId: string, userId: string, action: string, details: string): Promise<boolean> {
    try {
      await recordServerAuditEntry(GuildModel, guildId, { userId, action, details });
      return true;
    } catch (err: unknown) {
      deps.logger("WARN", "BACKUP_COMMAND", `Jurnalul server-log a esuat pentru ${action}; operatia a reusit, dar /server-log poate fi incomplet`, errorDetail(err));
      return false;
    }
  }

  async function handleAdd(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    const name = backupName(interaction);
    if (!name) return safeEdit(interaction, "Eroare: trebuie sa dai un nume pentru backup.");
    const settings = await getGuildSettings(guildId);
    const record = await saveConfigBackup(GuildModel, guildId, name, interaction.user?.id || "", settings);
    invalidateGuildCache(guildId);
    const audited = await auditBestEffort(guildId, interaction.user?.id || "", "backup_add", `Saved backup ${record.name}`);
    return safeEdit(interaction, audited
      ? `OK: backup-ul \`${record.name}\` a fost salvat.`
      : `OK: backup-ul \`${record.name}\` a fost salvat (dar nu am putut scrie in /server-log - vezi log-urile botului).`);
  }

  async function handleList(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    const settings = await getGuildSettings(guildId);
    return safeEdit(interaction, renderBackupList(listBackups(settings)));
  }

  async function handlePreview(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    const name = backupName(interaction);
    const settings = await getGuildSettings(guildId);
    const backup = findBackup(settings, name);
    if (!backup) return safeEdit(interaction, `Nu exista backup-ul \`${name}\`.`);
    return safeEdit(interaction, renderBackupPreview(backup, settings));
  }

  async function handleLoad(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    if (!requireConfirm(interaction)) {
      return safeEdit(interaction, "Load-ul a fost anulat. Ruleaza comanda cu `confirm:true` dupa ce verifici `/backup preview`.");
    }
    const name = backupName(interaction);
    const settings = await getGuildSettings(guildId);
    const backup = findBackup(settings, name);
    if (!backup) return safeEdit(interaction, `Nu exista backup-ul \`${name}\`.`);
    await loadConfigBackupWithAudit(GuildModel, guildId, backup, {
      userId: interaction.user?.id || "",
      action: "backup_load",
      details: `Loaded backup ${backup.name}`
    });
    invalidateGuildCache(guildId);
    return safeEdit(interaction, `OK: backup-ul \`${backup.name}\` a fost incarcat.`);
  }

  async function handleDelete(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    if (!requireConfirm(interaction)) {
      return safeEdit(interaction, "Stergerea a fost anulata. Ruleaza comanda cu `confirm:true` daca vrei sa stergi backup-ul.");
    }
    const name = backupName(interaction);
    const deleted = await deleteConfigBackupWithAudit(GuildModel, guildId, name, {
      userId: interaction.user?.id || "",
      action: "backup_delete",
      details: `Deleted backup ${name}`
    });
    invalidateGuildCache(guildId);
    if (!deleted) return safeEdit(interaction, `Nu exista backup-ul \`${name}\`.`);
    return safeEdit(interaction, `OK: backup-ul \`${name}\` a fost sters.`);
  }

  async function handleBackupInteraction(interaction: DiscordInteraction): Promise<unknown> {
    const guildId = interaction.guild?.id;
    if (!guildId) return undefined;
    await safeDefer(interaction, true);
    const subcommand = interaction.commandName === "add" ? "add" : interaction.options.getSubcommand();
    try {
      if (subcommand === "add") return await handleAdd(interaction, guildId);
      if (subcommand === "list") return await handleList(interaction, guildId);
      if (subcommand === "preview") return await handlePreview(interaction, guildId);
      if (subcommand === "load") return await handleLoad(interaction, guildId);
      if (subcommand === "delete") return await handleDelete(interaction, guildId);
      return safeEdit(interaction, `Eroare: subcomanda \`/backup ${subcommand}\` nu este recunoscuta.`);
    } catch (err: unknown) {
      deps.logger("WARN", "BACKUP_COMMAND", "Nu am putut procesa /backup", errorDetail(err));
      await safeEdit(interaction, formatUserError(err, "Eroare la procesarea backup-ului."));
      return handledCommandError(errorDetail(err));
    }
  }

  return { handleBackupInteraction };
}

function isBackupCommand(interaction: DiscordInteraction): boolean {
  if (!(interaction?.isChatInputCommand?.() === true && Boolean(interaction.guild))) return false;
  if (interaction.commandName === "backup") return true;
  if (interaction.commandName !== "add") return false;
  try {
    return interaction.options.getSubcommand() === "backup";
  } catch {
    return false;
  }
}

function buildBackupCommandHandler(target: BackupContext) {
  const handlers = createBackupInteractionHandler(target);
  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => isBackupCommand(interaction as DiscordInteraction),
    handle: async (interaction) => {
      try {
        return await handlers.handleBackupInteraction(interaction);
      } catch (err: unknown) {
        target.logger("ERROR", "BACKUP_COMMAND", "Eroare neasteptata in /backup", errorDetail(err));
        const payload = { content: "Eroare: nu am putut procesa comanda /backup.", flags: target.MessageFlags.Ephemeral };
        try {
          if ((interaction.deferred || interaction.replied) && typeof interaction.followUp === "function") {
            await interaction.followUp(payload);
          } else if (typeof interaction.reply === "function") {
            await interaction.reply(payload);
          }
        } catch {}
        return handledCommandError(errorDetail(err));
      }
    }
  };
  return { handlers, ...command };
}

export = {
  createBackupInteractionHandler,
  renderBackupPreview,
  buildCommandHandler: buildBackupCommandHandler
};
