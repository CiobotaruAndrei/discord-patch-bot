"use strict";

import type { DiscordReplyPayload, GameConfig, GuildSettings } from "../../types.js";
import type { CommandHandler } from "../command-registry/commandHandler.js";
import {
  buildConfigSnapshot,
  findConfigBackup,
  listConfigBackups,
  normalizeBackupName,
  type ConfigBackupModelLike
} from "../admin-records/configBackupRepository.js";
import type { GuildAuditLogModelLike } from "../admin-records/auditLogRepository.js";
import type { OperationJournalModelLike } from "../../infra/mongo/operationJournal.js";
import type { GuildConfigWriteModelLike } from "../guild-config/guildConfigRepository.js";
import {
  BACKUP_DELETE_KIND,
  BACKUP_LOAD_KIND,
  BACKUP_SAVE_KIND,
  createOperationJournalRuntime
} from "../admin-records/operationJournalRuntime.js";
import { handledCommandError } from "../command-security/commandOutcome.js";
import { renderBackupList, renderBackupPreview } from "./backupViews.js";

import { errorDetail } from "../../shared/errors.js";

type InteractionPayload = DiscordReplyPayload;
type Logger = (level: string, context: string, message: string, meta?: unknown) => void;

interface DiscordInteraction {
  id?: string;
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
  GuildModel: GuildConfigWriteModelLike;
  GuildAuditLogModel: GuildAuditLogModelLike;
  GuildConfigBackupModel: ConfigBackupModelLike;
  OperationJournalModel: OperationJournalModelLike;
  getGuildSettings(guildId: string): Promise<GuildSettings | null>;
  safeDefer(interaction: DiscordInteraction, ephemeral?: boolean): Promise<void>;
  safeEdit(interaction: DiscordInteraction, payload: InteractionPayload): Promise<unknown>;
  formatUserError(err: unknown, fallback: string): string;
  logger: Logger;
  MessageFlags: { Ephemeral: number };
}

type BackupContext = BackupInteractionDeps;

function backupName(interaction: DiscordInteraction): string {
  return String(interaction.options.getString("name", true) || "").trim();
}

function requireConfirm(interaction: DiscordInteraction): boolean {
  return interaction.options.getBoolean("confirm", true) === true;
}

function createBackupInteractionHandler(deps: BackupInteractionDeps) {
  const { GuildModel, GuildAuditLogModel, GuildConfigBackupModel, getGuildSettings, safeDefer, safeEdit, formatUserError } = deps;
  const operationJournal = createOperationJournalRuntime({
    OperationJournalModel: deps.OperationJournalModel,
    GuildModel,
    GuildAuditLogModel,
    GuildConfigBackupModel,
    logger: deps.logger
  });

  function operationKey(interaction: DiscordInteraction, kind: string, subject: string): string {
    return `${kind}:${interaction.guild?.id || "unknown"}:${interaction.id || `${interaction.user?.id || "unknown"}:${Date.now()}`}:${subject}`;
  }

  async function handleAdd(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    const name = backupName(interaction);
    if (!name) return safeEdit(interaction, "Eroare: trebuie sa dai un nume pentru backup.");
    const settings = await getGuildSettings(guildId);
    const backup = {
      name: normalizeBackupName(name),
      createdBy: interaction.user?.id || "",
      createdAt: new Date(),
      snapshot: buildConfigSnapshot(settings)
    };
    await operationJournal.runJournaled(operationKey(interaction, BACKUP_SAVE_KIND, backup.name), BACKUP_SAVE_KIND, {
      guildId,
      backup,
      audit: { userId: interaction.user?.id || "", action: "backup_add", details: `Saved backup ${backup.name}` }
    });
    return safeEdit(interaction, `OK: backup-ul \`${backup.name}\` a fost salvat.`);
  }

  async function handleList(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    return safeEdit(interaction, renderBackupList(await listConfigBackups(GuildConfigBackupModel, guildId)));
  }

  async function handlePreview(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    const name = backupName(interaction);
    const backup = await findConfigBackup(GuildConfigBackupModel, guildId, name);
    if (!backup) return safeEdit(interaction, `Nu exista backup-ul \`${name}\`.`);
    const settings = await getGuildSettings(guildId);
    return safeEdit(interaction, renderBackupPreview(backup, settings));
  }

  async function handleLoad(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    if (!requireConfirm(interaction)) {
      return safeEdit(interaction, "Load-ul a fost anulat. Ruleaza comanda cu `confirm:true` dupa ce verifici `/backup preview`.");
    }
    const name = backupName(interaction);
    const backup = await findConfigBackup(GuildConfigBackupModel, guildId, name);
    if (!backup) return safeEdit(interaction, `Nu exista backup-ul \`${name}\`.`);
    await operationJournal.runJournaled(operationKey(interaction, BACKUP_LOAD_KIND, backup.name), BACKUP_LOAD_KIND, {
      guildId,
      backup,
      audit: { userId: interaction.user?.id || "", action: "backup_load", details: `Loaded backup ${backup.name}` }
    });
    return safeEdit(interaction, `OK: backup-ul \`${backup.name}\` a fost incarcat.`);
  }

  async function handleDelete(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    if (!requireConfirm(interaction)) {
      return safeEdit(interaction, "Stergerea a fost anulata. Ruleaza comanda cu `confirm:true` daca vrei sa stergi backup-ul.");
    }
    const name = backupName(interaction);
    const backup = await findConfigBackup(GuildConfigBackupModel, guildId, name);
    if (!backup) return safeEdit(interaction, `Nu exista backup-ul \`${name}\`.`);
    await operationJournal.runJournaled(operationKey(interaction, BACKUP_DELETE_KIND, backup.name), BACKUP_DELETE_KIND, {
      guildId,
      name: backup.name,
      audit: { userId: interaction.user?.id || "", action: "backup_delete", details: `Deleted backup ${backup.name}` }
    });
    return safeEdit(interaction, `OK: backup-ul \`${backup.name}\` a fost sters.`);
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

export default {
  createBackupInteractionHandler,
  renderBackupPreview,
  buildCommandHandler: buildBackupCommandHandler
};
