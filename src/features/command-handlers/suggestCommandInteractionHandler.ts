"use strict";

import type { DiscordReplyPayload, GameConfig, SuggestedCommandEntry } from "../../types.js";
import type { CommandHandler } from "../command-registry/commandHandler.js";
import { paginateTextLines } from "../command-presentation/textPagination.js";
import { deleteSuggestedCommand, listSuggestedCommands, saveSuggestedCommand, MAX_SUGGESTED_COMMANDS, type SuggestedCommandModelLike } from "../admin-records/suggestedCommandsRepository.js";
import { recordBotAuditEntry } from "../admin-records/auditLogRepository.js";
import { requireGuildAdminAudited } from "../command-security/runtimeAdminAudit.js";
import { escapeInlineText, NO_MENTIONS } from "../../shared/discordText.js";
import { validateUserText } from "../command-security/userTextPolicy.js";

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

export function renderSuggestedCommandLines(entries: SuggestedCommandEntry[]): string[] {
  if (!entries.length) return ["Nu exista comenzi sugerate pentru acest server."];
  return [
    `Comenzi sugerate (${entries.length}):`,
    ...entries.map(entry => `- \`/${escapeInlineText(entry.commandName, 80)}\` propusa de ${formatUserReference(entry.createdBy || "")}: ${escapeInlineText(entry.description, 500)}`)
  ];
}

function createSuggestCommandInteractionHandler(deps: SuggestCommandDeps) {
  const { GuildSuggestedCommandModel, GuildAuditLogModel, safeDefer, safeEdit, enforceCooldown, requireGuildAdmin } = deps;

  async function handleAdd(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    if (!(await enforceCooldown(interaction, "suggest-command:add"))) return undefined;
    let commandName = "";
    let description = "";
    try {
      commandName = normalizeCommandName(validateUserText("suggest-command.name", String(interaction.options.getString("name", true) || "")));
      description = validateUserText("suggest-command.description", String(interaction.options.getString("description", true) || "")).slice(0, 500);
    } catch {
      return safeEdit(interaction, "Eroare: numele si descrierea sugestiei nu pot contine linkuri.");
    }
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
    if (!(await requireGuildAdminAudited(requireGuildAdmin, GuildAuditLogModel, interaction, guildId, "/list suggest-command"))) return undefined;
    const limit = Math.max(1, Math.min(MAX_SUGGESTED_COMMANDS, interaction.options.getInteger("numar") ?? 10));
    const entries = await listSuggestedCommands(GuildSuggestedCommandModel, guildId, limit);
    await recordBotAuditEntry(GuildAuditLogModel, guildId, { userId: interaction.user?.id || "", command: "/list suggest-command", result: "Access granted." }).catch(() => undefined);
    const pages = paginateTextLines(renderSuggestedCommandLines(entries));
    const first = await safeEdit(interaction, { content: pages[0], allowedMentions: NO_MENTIONS });
    for (const page of pages.slice(1)) {
      if (interaction.followUp) await interaction.followUp({ content: page, ephemeral: true, allowedMentions: NO_MENTIONS });
    }
    return first;
  }

  async function handleDelete(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    if (!(await requireGuildAdminAudited(requireGuildAdmin, GuildAuditLogModel, interaction, guildId, "/delete suggest-command"))) return undefined;
    const commandName = normalizeCommandName(String(interaction.options.getString("name", true) || ""));
    if (!commandName) return safeEdit(interaction, "Eroare: trebuie sa alegi numele comenzii sugerate.");
    const deleted = await deleteSuggestedCommand(GuildSuggestedCommandModel, GuildAuditLogModel, guildId, commandName, {
      userId: interaction.user?.id || "",
      action: "suggest_command_delete",
      details: commandName
    });
    await recordBotAuditEntry(GuildAuditLogModel, guildId, {
      userId: interaction.user?.id || "",
      command: "/delete suggest-command",
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
    if (interaction.commandName === "suggest-command") return handleAdd(interaction, guildId);
    const resource = interaction.options.getSubcommand();
    if (interaction.commandName === "add" && resource === "suggestion") return handleAdd(interaction, guildId);
    if (interaction.commandName === "list" && resource === "suggest-command") return handleList(interaction, guildId);
    if (interaction.commandName === "delete" && resource === "suggest-command") return handleDelete(interaction, guildId);
    return safeEdit(interaction, "Eroare: ruta pentru sugestii nu este recunoscuta.");
  }

  return { handleSuggestCommandInteraction };
}

function isSuggestCommand(interaction: DiscordInteraction): boolean {
  if (!(interaction?.isChatInputCommand?.() === true && Boolean(interaction.guild))) return false;
  if (interaction.commandName === "suggest-command") return true;
  if (!["add", "list", "delete"].includes(String(interaction.commandName || ""))) return false;
  try {
    const resource = interaction.options.getSubcommand();
    return (interaction.commandName === "add" && resource === "suggestion")
      || (interaction.commandName === "list" && resource === "suggest-command")
      || (interaction.commandName === "delete" && resource === "suggest-command");
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
  renderSuggestedCommandLines,
  buildCommandHandler: buildSuggestCommandHandler
};
