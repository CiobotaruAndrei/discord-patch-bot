"use strict";

import type { ConfigBackupRecord, GameConfig, GuildSettings } from "../../types";
import type { CommandHandler } from "../command-registry/commandHandler";
import { clampJoinedList } from "../command-presentation/discordListLimit";
import {
  CONFIG_BACKUP_KEYS,
  deleteConfigBackup,
  findBackup,
  listBackups,
  loadConfigBackup,
  saveConfigBackup,
  recordServerAuditEntry
} from "../admin-records/adminRecordsRepository";
import { handledCommandError } from "../command-security/commandOutcome";

const { errorDetail } = require("../../shared/errors") as typeof import("../../shared/errors");

type InteractionPayload = string | Record<string, unknown>;
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

const RESOURCE_FIELDS: Array<{ key: string; label: string; kind: "canal" | "rol" }> = [
  { key: "notificationChannelId", label: "canal update-uri", kind: "canal" },
  { key: "discountChannelId", label: "canal reduceri", kind: "canal" },
  { key: "youtubeNotificationChannelId", label: "canal YouTube", kind: "canal" },
  { key: "adminAlertChannelId", label: "canal alerte admin", kind: "canal" },
  { key: "notificationRoleId", label: "rol update-uri", kind: "rol" },
  { key: "discountRoleId", label: "rol reduceri", kind: "rol" }
];

function backupName(interaction: DiscordInteraction): string {
  return String(interaction.options.getString("name", true) || "").trim();
}

function requireConfirm(interaction: DiscordInteraction): boolean {
  return interaction.options.getBoolean("confirm", true) === true;
}

function formatDate(value: Date | string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "data necunoscuta";
  return `<t:${Math.floor(date.getTime() / 1000)}:f>`;
}

function formatUserReference(userId: string): string {
  return userId ? `<@${userId}>` : "user necunoscut";
}

function renderBackupList(backups: ConfigBackupRecord[]): string {
  if (!backups.length) return "Nu exista backup-uri salvate pentru acest server.";
  const lines = backups.map(backup => `- \`${backup.name}\` creat de ${formatUserReference(backup.createdBy || "")} la ${formatDate(backup.createdAt)}`);
  return clampJoinedList(lines, 1900);
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (value instanceof Map) return value.size > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function renderBackupPreview(backup: ConfigBackupRecord, current: GuildSettings | null): string {
  const snapshot = backup.snapshot;
  const changed: string[] = [];
  for (const [key, value] of Object.entries(snapshot)) {
    const currentValue = current?.[key];
    if (JSON.stringify(currentValue ?? null) !== JSON.stringify(value ?? null)) changed.push(key);
  }
  const cleared: string[] = [];
  for (const key of CONFIG_BACKUP_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, key) && hasMeaningfulValue(current?.[key])) cleared.push(key);
  }
  const resourceLines = RESOURCE_FIELDS.flatMap(field => {
    const value = snapshot[field.key];
    if (typeof value !== "string" || !value) return [];
    const mention = field.kind === "canal" ? `<#${value}>` : `<@&${value}>`;
    return [`${field.label}: ${mention}`];
  });
  const changedText = changed.length ? clampJoinedList(changed.map(key => `\`${key}\``), 1000, { separator: ", " }) : "nicio diferenta detectata fata de configuratia curenta";
  const clearedText = cleared.length ? clampJoinedList(cleared.map(key => `\`${key}\``), 1000, { separator: ", " }) : "niciuna";
  const resources = resourceLines.length ? resourceLines.join("\n") : "backup-ul nu contine canale sau roluri configurate";
  return [
    `Preview backup \`${backup.name}\`:`,
    `Setari care se vor restaura: ${changedText}`,
    `Setari care se vor STERGE (exista acum, dar lipsesc din backup): ${clearedText}`,
    "",
    "Canale si roluri referite de backup:",
    resources,
    "",
    "Load-ul inlocuieste configuratia botului cu cea din backup: cheile prezente se seteaza, iar cele lipsa din backup se curata (revin la implicit). Daca un canal sau rol a fost sters din Discord, adminul trebuie sa-l recreeze sau sa refaca setarea dupa load."
  ].join("\n");
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
    await loadConfigBackup(GuildModel, guildId, backup);
    invalidateGuildCache(guildId);
    const audited = await auditBestEffort(guildId, interaction.user?.id || "", "backup_load", `Loaded backup ${backup.name}`);
    return safeEdit(interaction, audited
      ? `OK: backup-ul \`${backup.name}\` a fost incarcat.`
      : `OK: backup-ul \`${backup.name}\` a fost incarcat (dar nu am putut scrie in /server-log - vezi log-urile botului).`);
  }

  async function handleDelete(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    if (!requireConfirm(interaction)) {
      return safeEdit(interaction, "Stergerea a fost anulata. Ruleaza comanda cu `confirm:true` daca vrei sa stergi backup-ul.");
    }
    const name = backupName(interaction);
    const deleted = await deleteConfigBackup(GuildModel, guildId, name);
    invalidateGuildCache(guildId);
    if (!deleted) return safeEdit(interaction, `Nu exista backup-ul \`${name}\`.`);
    const audited = await auditBestEffort(guildId, interaction.user?.id || "", "backup_delete", `Deleted backup ${name}`);
    return safeEdit(interaction, audited
      ? `OK: backup-ul \`${name}\` a fost sters.`
      : `OK: backup-ul \`${name}\` a fost sters (dar nu am putut scrie in /server-log - vezi log-urile botului).`);
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

const installBackupInteractionHandler = ((target: BackupContext): void => {
  const previousHandleInteraction = target.handleInteraction;
  const { handlers, canHandle, handle } = buildBackupCommandHandler(target);
  async function handleInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    if (!canHandle(interaction)) {
      if (typeof previousHandleInteraction === "function") return previousHandleInteraction(interaction, games);
      return undefined;
    }
    return handle(interaction, games);
  }
  Object.assign(target, handlers, { handleInteraction });
}) as ((target: BackupContext) => void) & {
  createBackupInteractionHandler: typeof createBackupInteractionHandler;
  renderBackupPreview: typeof renderBackupPreview;
  buildCommandHandler: typeof buildBackupCommandHandler;
};

installBackupInteractionHandler.createBackupInteractionHandler = createBackupInteractionHandler;
installBackupInteractionHandler.renderBackupPreview = renderBackupPreview;
installBackupInteractionHandler.buildCommandHandler = buildBackupCommandHandler;

export = installBackupInteractionHandler;
