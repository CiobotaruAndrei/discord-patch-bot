"use strict";

import type { DiscordReplyPayload, GameConfig, SuggestedCommandEntry } from "../../types.js";
import type { CommandHandler } from "../command-registry/commandHandler.js";
import { clampJoinedList } from "../command-presentation/discordListLimit.js";
import { deleteSuggestedCommand, listSuggestedCommands, saveSuggestedCommand, type SuggestedCommandModelLike } from "../admin-records/suggestedCommandsRepository.js";
import { recordBotAuditEntry } from "../admin-records/auditLogRepository.js";
import { requireGuildAdminAudited } from "../command-security/runtimeAdminAudit.js";
import { escapeInlineText, NO_MENTIONS } from "../../shared/discordText.js";

import { errorDetail } from "../../shared/errors.js";
import defaultRequireGuildAdminModule from "../command-security/adminPermissionGuard.js";
const defaultRequireGuildAdmin = defaultRequireGuildAdminModule as RequireGuildAdmin;

type InteractionPayload = DiscordReplyPayload;
type Logger = (level: string, context: string, message: string, meta?: unknown) => void;
type RequireGuildAdmin = (interaction: DiscordInteraction) => Promise<boolean>;

interface DiscordInteraction {
  commandName?: string;
  guild?: { id: string } | null;
  user?: { id?: string } | null;
  deferred?: boolean;
  replied?: boolean;
  options: {
    getSubcommand(): string;
    getString(name: string, required?: boolean): string | null;
    getInteger(name: string, required?: boolean): number | null;
  };
  isChatInputCommand?: () => boolean;
  reply?: (payload: unknown) => Promise<unknown>;
  followUp?: (payload: unknown) => Promise<unknown>;
}

interface SuggestCommandDeps {
  GuildSuggestedCommandModel: SuggestedCommandModelLike;
  GuildAuditLogModel: Parameters<typeof recordBotAuditEntry>[0];
  safeDefer(interaction: DiscordInteraction, ephemeral?: boolean): Promise<void>;
  safeEdit(interaction: DiscordInteraction, payload: InteractionPayload): Promise<unknown>;
  enforceCooldown(interaction: DiscordInteraction, command: string): Promise<boolean>;
  requireGuildAdmin: RequireGuildAdmin;
  logger: Logger;
  MessageFlags: { Ephemeral: number };
}

type SuggestCommandContext = Omit<SuggestCommandDeps, "requireGuildAdmin"> & {
  requireGuildAdmin?: RequireGuildAdmin;
};

function normalizeCommandName(value: string): string {
  return value.trim().replace(/^\/+/, "").trim().replace(/\s+/g, " ").toLowerCase().slice(0, 80);
}

function formatUserReference(userId: string): string {
  return userId ? `<@${userId}>` : "user necunoscut";
}

function renderSuggestedCommands(entries: SuggestedCommandEntry[]): string {
  if (!entries.length) return "Nu exista comenzi sugerate pentru acest server.";
  const lines = entries.map(entry => `- \`/${escapeInlineText(entry.commandName, 80)}\` propusa de ${formatUserReference(entry.createdBy || "")}: ${escapeInlineText(entry.description, 500)}`);
  return `Comenzi sugerate (${entries.length}):\n${clampJoinedList(lines, 1900)}`;
}

function createSuggestCommandInteractionHandler(deps: SuggestCommandDeps) {
  const { GuildSuggestedCommandModel, GuildAuditLogModel, safeDefer, safeEdit, enforceCooldown, requireGuildAdmin } = deps;

  async function handleAdd(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    if (!(await enforceCooldown(interaction, "suggest-command:add"))) return undefined;
    const commandName = normalizeCommandName(String(interaction.options.getString("name", true) || ""));
    const description = String(interaction.options.getString("description", true) || "").trim().slice(0, 500);
    if (!commandName || !description) {
      return safeEdit(interaction, "Eroare: trebuie sa completezi numele comenzii si ce ar trebui sa faca.");
    }
    const { record, added } = await saveSuggestedCommand(GuildSuggestedCommandModel, guildId, {
      commandName,
      description,
      createdBy: interaction.user?.id || ""
    });
    return added
      ? safeEdit(interaction, `OK: sugestia \`/${record.commandName}\` a fost salvata.`)
      : safeEdit(interaction, `Info: comanda \`/${record.commandName}\` e deja in lista de sugestii a serverului.`);
  }

  async function handleList(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    if (!(await requireGuildAdminAudited(requireGuildAdmin, GuildAuditLogModel, interaction, guildId, "/suggest-command list"))) return undefined;
    const limit = Math.max(1, Math.min(25, interaction.options.getInteger("numar") ?? 10));
    const entries = await listSuggestedCommands(GuildSuggestedCommandModel, guildId, limit);
    await recordBotAuditEntry(GuildAuditLogModel, guildId, { userId: interaction.user?.id || "", command: "/suggest-command list", result: "Access granted." }).catch(() => undefined);
    return safeEdit(interaction, { content: renderSuggestedCommands(entries), allowedMentions: NO_MENTIONS });
  }

  async function handleDelete(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    if (!(await requireGuildAdminAudited(requireGuildAdmin, GuildAuditLogModel, interaction, guildId, "/suggest-command delete"))) return undefined;
    const commandName = normalizeCommandName(String(interaction.options.getString("name", true) || ""));
    if (!commandName) return safeEdit(interaction, "Eroare: trebuie sa alegi numele comenzii sugerate.");
    const deleted = await deleteSuggestedCommand(GuildSuggestedCommandModel, GuildAuditLogModel, guildId, commandName, {
      userId: interaction.user?.id || "",
      action: "suggest_command_delete",
      details: commandName
    });
    await recordBotAuditEntry(GuildAuditLogModel, guildId, {
      userId: interaction.user?.id || "",
      command: "/suggest-command delete",
      result: "Access granted.",
      details: deleted ? `stearsa: ${commandName}` : `negasita: ${commandName}`
    }).catch(() => undefined);
    return deleted
      ? safeEdit(interaction, `OK: sugestia \`/${commandName}\` a fost stearsa.`)
      : safeEdit(interaction, `Nu am gasit sugestia \`/${commandName}\`.`);
  }

  async function handleSuggestCommandInteraction(interaction: DiscordInteraction): Promise<unknown> {
    const guildId = interaction.guild?.id;
    if (!guildId) return undefined;
    await safeDefer(interaction, true);
    const subcommand = interaction.commandName === "add" ? "add" : interaction.options.getSubcommand();
    if (subcommand === "add") return handleAdd(interaction, guildId);
    if (subcommand === "list") return handleList(interaction, guildId);
    if (subcommand === "delete") return handleDelete(interaction, guildId);
    return safeEdit(interaction, `Eroare: subcomanda \`/suggest-command ${subcommand}\` nu este recunoscuta.`);
  }

  return { handleSuggestCommandInteraction };
}

function isSuggestCommand(interaction: DiscordInteraction): boolean {
  if (!(interaction?.isChatInputCommand?.() === true && Boolean(interaction.guild))) return false;
  if (interaction.commandName === "suggest-command") return true;
  if (interaction.commandName !== "add") return false;
  try {
    return interaction.options.getSubcommand() === "suggestion";
  } catch {
    return false;
  }
}

function buildSuggestCommandHandler(target: SuggestCommandContext) {
  const handlers = createSuggestCommandInteractionHandler({
    GuildSuggestedCommandModel: target.GuildSuggestedCommandModel,
    GuildAuditLogModel: target.GuildAuditLogModel,
    safeDefer: target.safeDefer,
    safeEdit: target.safeEdit,
    enforceCooldown: target.enforceCooldown,
    requireGuildAdmin: target.requireGuildAdmin || defaultRequireGuildAdmin,
    logger: target.logger,
    MessageFlags: target.MessageFlags
  });
  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => isSuggestCommand(interaction as DiscordInteraction),
    handle: async (interaction) => {
      try {
        return await handlers.handleSuggestCommandInteraction(interaction);
      } catch (err: unknown) {
        target.logger("ERROR", "SUGGEST_COMMAND", "Eroare in /suggest-command", errorDetail(err));
        const payload = { content: "Eroare: nu am putut procesa sugestia.", flags: target.MessageFlags.Ephemeral };
        try {
          if ((interaction.deferred || interaction.replied) && typeof interaction.followUp === "function") {
            await interaction.followUp(payload);
          } else if (typeof interaction.reply === "function") {
            await interaction.reply(payload);
          }
        } catch {}
        return undefined;
      }
    }
  };
  return { handlers, ...command };
}

export default {
  createSuggestCommandInteractionHandler,
  renderSuggestedCommands,
  buildCommandHandler: buildSuggestCommandHandler
};
