"use strict";

import type {
  BooleanOption,
  ChatInputInteraction,
  PartialInteractionUserRef,
  StringOption,
  SubcommandOption
} from "./discordInteractionPorts.js";
import type { DiscordReplyPayload } from "../../types.js";
import type { GameConfig } from "../../config/configTypes.js";
import type { GuildSettings } from "../guild-config/guildSettingsTypes.js";
import type { CommandHandler } from "../command-registry/commandHandler.js";
import {
  buildConfigSnapshot,
  findConfigBackup,
  listConfigBackups,
  normalizeBackupName,
  type ConfigBackupModelLike
} from "../admin-records/configBackupRepository.js";
import type { GuildAuditLogModelLike } from "../admin-records/auditLogRepository.js";
import { composeGuildSliceWriteModel } from "../guild-config/guildSliceWriteComposition.js";

import type { OperationJournalModelLike } from "../../shared/operationJournalEngine.js";
import type { GuildSliceWriteCompositionDeps } from "../guild-config/guildSliceWriteComposition.js";
import type { GuildConfigWriteModelLike } from "../guild-config/guildConfigRepository.js";
import {
  BACKUP_DELETE_KIND,
  BACKUP_LOAD_KIND,
  BACKUP_SAVE_KIND,
  createOperationJournalRuntime,
  journalResourceVersion,
  OPERATION_PAYLOAD_SCHEMA_VERSION
} from "../admin-records/operationJournalRuntime.js";
import { handledCommandError } from "../command-security/commandOutcome.js";
import { renderBackupList, renderBackupPreview } from "./backupViews.js";
import { sendPaginatedEdit } from "../command-presentation/textPagination.js";
import {
  applyResourceIdRemap,
  planBackupResourceRestore,
  validateBackupResourceReferences
} from "../admin-records/backupResourceRestorePlan.js";
import {
  materializeBackupResources,
  rollbackMaterializedResources,
  type BackupDiscordGuild,
  type BackupDiscordResourceManager
} from "../admin-records/backupResourceRestoreRuntime.js";

import { errorDetail } from "../../shared/errors.js";

type InteractionPayload = DiscordReplyPayload;
type Logger = (level: string, context: string, message: string, meta?: unknown) => void;

type DiscordInteraction = ChatInputInteraction<SubcommandOption & StringOption & BooleanOption, BackupDiscordGuild> & { user?: PartialInteractionUserRef | null };

interface BackupInteractionDeps {
  GuildModel: GuildConfigWriteModelLike;
  GuildAuditLogModel: GuildAuditLogModelLike;
  GuildConfigBackupModel: ConfigBackupModelLike;
  OperationJournalModel: OperationJournalModelLike;
  GuildModerationModel?: GuildSliceWriteCompositionDeps["GuildModerationModel"];
  GuildSecurityModel?: GuildSliceWriteCompositionDeps["GuildSecurityModel"];
  GuildYoutubeStateModel?: GuildSliceWriteCompositionDeps["GuildYoutubeStateModel"];
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

function resourceIds(manager: BackupDiscordResourceManager): string[] {
  return [...manager.cache.values()].map(resource => resource.id);
}

function resourcePlan(interaction: DiscordInteraction, snapshot: Record<string, unknown>) {
  const guild = interaction.guild;
  if (!guild) throw new Error("Serverul Discord nu este disponibil pentru restaurarea resurselor.");
  return planBackupResourceRestore(snapshot, resourceIds(guild.channels), resourceIds(guild.roles));
}

function createBackupInteractionHandler(deps: BackupInteractionDeps) {
  const { GuildModel, GuildAuditLogModel, GuildConfigBackupModel, getGuildSettings, safeDefer, safeEdit, formatUserError } = deps;
  const sliceWriteModel = composeGuildSliceWriteModel({
    GuildModel,
    GuildModerationModel: deps.GuildModerationModel,
    GuildSecurityModel: deps.GuildSecurityModel,
    GuildYoutubeStateModel: deps.GuildYoutubeStateModel,
    OperationJournalModel: deps.OperationJournalModel,
    logger: deps.logger
  });

  const operationJournal = createOperationJournalRuntime({
    OperationJournalModel: deps.OperationJournalModel,
    GuildModel: sliceWriteModel,
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
    }, {
      schemaVersion: OPERATION_PAYLOAD_SCHEMA_VERSION,
      resourceKey: `guild-backup:${guildId}:${backup.name}`,
      resourceVersion: journalResourceVersion(interaction.id)
    });
    return safeEdit(interaction, `OK: backup-ul \`${backup.name}\` a fost salvat.`);
  }

  async function handleList(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    const text = renderBackupList(await listConfigBackups(GuildConfigBackupModel, guildId));
    return sendPaginatedEdit(interaction, payload => safeEdit(interaction, payload), text.split("\n"), { ephemeral: true });
  }

  async function handlePreview(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    const name = backupName(interaction);
    const backup = await findConfigBackup(GuildConfigBackupModel, guildId, name);
    if (!backup) return safeEdit(interaction, `Nu exista backup-ul \`${name}\`.`);
    const settings = await getGuildSettings(guildId);
    const text = renderBackupPreview(backup, settings, resourcePlan(interaction, backup.snapshot));
    return sendPaginatedEdit(interaction, payload => safeEdit(interaction, payload), text.split("\n"), { ephemeral: true });
  }

  async function handleLoad(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    if (!requireConfirm(interaction)) {
      return safeEdit(interaction, "Load-ul a fost anulat. Ruleaza comanda cu `confirm:true` dupa ce verifici `/backup preview`.");
    }
    const name = backupName(interaction);
    const backup = await findConfigBackup(GuildConfigBackupModel, guildId, name);
    if (!backup) return safeEdit(interaction, `Nu exista backup-ul \`${name}\`.`);
    const guild = interaction.guild;
    if (!guild) throw new Error("Serverul Discord nu este disponibil pentru restaurarea resurselor.");
    const materialized = await materializeBackupResources(guild, resourcePlan(interaction, backup.snapshot));
    const remappedBackup = { ...backup, snapshot: applyResourceIdRemap(backup.snapshot, materialized.remap) };
    const validation = validateBackupResourceReferences(remappedBackup.snapshot, materialized.channelIds, materialized.roleIds);
    if (validation.invalid.length > 0 || validation.missing.length > 0) {
      const compensation = await rollbackMaterializedResources(materialized.created);
      const cleanup = compensation.failed > 0
        ? ` Resursele nou-create au fost sterse partial (${compensation.deleted} sterse, ${compensation.failed} necesita curatare manuala).`
        : materialized.created.length > 0 ? ` Cele ${compensation.deleted} resurse nou-create au fost sterse.` : "";
      throw new Error(`Backup-ul nu poate fi incarcat deoarece au ramas referinte Discord invalide sau inexistente.${cleanup}`);
    }
    await operationJournal.runJournaled(operationKey(interaction, BACKUP_LOAD_KIND, backup.name), BACKUP_LOAD_KIND, {
      guildId,
      backup: remappedBackup,
      audit: { userId: interaction.user?.id || "", action: "backup_load", details: `Loaded backup ${backup.name}` }
    }, {
      schemaVersion: OPERATION_PAYLOAD_SCHEMA_VERSION,
      resourceKey: `guild-config:${guildId}`,
      resourceVersion: journalResourceVersion(interaction.id)
    });
    return safeEdit(interaction, `OK: backup-ul \`${backup.name}\` a fost incarcat. Resurse Discord create: ${materialized.created.length}.`);
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
    }, {
      schemaVersion: OPERATION_PAYLOAD_SCHEMA_VERSION,
      resourceKey: `guild-backup:${guildId}:${backup.name}`,
      resourceVersion: journalResourceVersion(interaction.id)
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
