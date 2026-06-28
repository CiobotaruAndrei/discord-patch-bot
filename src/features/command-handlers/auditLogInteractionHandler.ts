"use strict";

import type { BotAuditLogEntry, GameConfig, GuildSettings, ServerAuditLogEntry } from "../../types";
import type { CommandHandler } from "../command-registry/commandHandler";
import { clampJoinedList } from "../command-presentation/discordListLimit";
import { listBotAuditEntries, listServerAuditEntries } from "../admin-records/adminRecordsRepository";

const { errorDetail } = require("../../shared/errors") as typeof import("../../shared/errors");

type InteractionPayload = string | Record<string, unknown>;
type Logger = (level: string, context: string, message: string, meta?: unknown) => void;

interface DiscordInteraction {
  commandName?: string;
  guild?: { id: string } | null;
  deferred?: boolean;
  replied?: boolean;
  options: {
    getInteger(name: string, required?: boolean): number | null;
  };
  isChatInputCommand?: () => boolean;
  reply?: (payload: unknown) => Promise<unknown>;
  followUp?: (payload: unknown) => Promise<unknown>;
}

interface AuditLogDeps {
  getGuildSettings(guildId: string): Promise<GuildSettings | null>;
  safeDefer(interaction: DiscordInteraction, ephemeral?: boolean): Promise<void>;
  safeEdit(interaction: DiscordInteraction, payload: InteractionPayload): Promise<unknown>;
  logger: Logger;
  MessageFlags: { Ephemeral: number };
}

type AuditLogContext = AuditLogDeps & {
  handleInteraction?: (interaction: DiscordInteraction, games: GameConfig[]) => Promise<unknown> | unknown;
};

function limitFromInteraction(interaction: DiscordInteraction): number {
  const raw = interaction.options.getInteger("numar") ?? 10;
  return Math.max(1, Math.min(25, raw));
}

function formatDate(value: Date | string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "data necunoscuta";
  return `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}

function formatUserReference(userId: string): string {
  return userId ? `<@${userId}>` : "user necunoscut";
}

function renderBotLog(entries: BotAuditLogEntry[]): string {
  if (!entries.length) return "Nu exista actiuni admin salvate pentru acest server.";
  const lines = entries.map(entry => [
    `- ${formatDate(entry.at)} ${formatUserReference(entry.userId || "")}`,
    `comanda: \`${entry.command}\``,
    `rezultat: ${entry.result}`,
    entry.details ? `detalii: ${entry.details}` : ""
  ].filter(Boolean).join(" | "));
  return `Bot log (${entries.length}):\n${clampJoinedList(lines, 1900)}`;
}

function renderServerLog(entries: ServerAuditLogEntry[]): string {
  if (!entries.length) return "Nu exista schimbari importante salvate pentru acest server.";
  const lines = entries.map(entry => [
    `- ${formatDate(entry.at)} ${formatUserReference(entry.userId || "")}`,
    `actiune: \`${entry.action}\``,
    entry.details ? `detalii: ${entry.details}` : ""
  ].filter(Boolean).join(" | "));
  return `Server log (${entries.length}):\n${clampJoinedList(lines, 1900)}`;
}

function createAuditLogInteractionHandler(deps: AuditLogDeps) {
  const { getGuildSettings, safeDefer, safeEdit } = deps;

  async function handleAuditLogInteraction(interaction: DiscordInteraction): Promise<unknown> {
    const guildId = interaction.guild?.id;
    if (!guildId) return undefined;
    await safeDefer(interaction, true);
    const limit = limitFromInteraction(interaction);
    const settings = await getGuildSettings(guildId);
    if (interaction.commandName === "bot-log") {
      return safeEdit(interaction, renderBotLog(listBotAuditEntries(settings, limit)));
    }
    return safeEdit(interaction, renderServerLog(listServerAuditEntries(settings, limit)));
  }

  return { handleAuditLogInteraction };
}

function isAuditLogCommand(interaction: DiscordInteraction): boolean {
  return interaction?.isChatInputCommand?.() === true
    && Boolean(interaction.guild)
    && (interaction.commandName === "bot-log" || interaction.commandName === "server-log");
}

function buildAuditLogCommandHandler(target: AuditLogContext) {
  const handlers = createAuditLogInteractionHandler(target);
  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => isAuditLogCommand(interaction as DiscordInteraction),
    handle: async (interaction) => {
      try {
        return await handlers.handleAuditLogInteraction(interaction);
      } catch (err: unknown) {
        target.logger("ERROR", "AUDIT_LOG_COMMAND", "Eroare in comenzile de log", errorDetail(err));
        const payload = { content: "Eroare: nu am putut afisa logurile.", flags: target.MessageFlags.Ephemeral };
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

const installAuditLogInteractionHandler = ((target: AuditLogContext): void => {
  const previousHandleInteraction = target.handleInteraction;
  const { handlers, canHandle, handle } = buildAuditLogCommandHandler(target);
  async function handleInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    if (!canHandle(interaction)) {
      if (typeof previousHandleInteraction === "function") return previousHandleInteraction(interaction, games);
      return undefined;
    }
    return handle(interaction, games);
  }
  Object.assign(target, handlers, { handleInteraction });
}) as ((target: AuditLogContext) => void) & {
  createAuditLogInteractionHandler: typeof createAuditLogInteractionHandler;
  renderBotLog: typeof renderBotLog;
  renderServerLog: typeof renderServerLog;
  buildCommandHandler: typeof buildAuditLogCommandHandler;
};

installAuditLogInteractionHandler.createAuditLogInteractionHandler = createAuditLogInteractionHandler;
installAuditLogInteractionHandler.renderBotLog = renderBotLog;
installAuditLogInteractionHandler.renderServerLog = renderServerLog;
installAuditLogInteractionHandler.buildCommandHandler = buildAuditLogCommandHandler;

export = installAuditLogInteractionHandler;
