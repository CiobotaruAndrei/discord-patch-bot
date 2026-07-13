"use strict";

import type { BotAuditLogEntry, DiscordReplyPayload, GameConfig, GuildSettings, ServerAuditLogEntry } from "../../types";
import type { CommandHandler } from "../command-registry/commandHandler";
import { matchesCommand } from "../command-registry/commandMatch";
import { clampJoinedList } from "../command-presentation/discordListLimit";
import {
  listBotAuditEntries,
  listBotAuditEntriesInRange,
  listServerAuditEntries,
  listServerAuditEntriesInRange,
  type GuildAuditLogModelLike
} from "../admin-records/auditLogRepository";
import { handledCommandError } from "../command-security/commandOutcome";
import { escapeInlineText, NO_MENTIONS } from "../../shared/discordText";

import { errorDetail } from "../../shared/errors";

type InteractionPayload = DiscordReplyPayload;
type Logger = (level: string, context: string, message: string, meta?: unknown) => void;

interface DiscordInteraction {
  commandName?: string;
  guild?: { id: string } | null;
  deferred?: boolean;
  replied?: boolean;
  options: {
    getSubcommand(required?: boolean): string;
    getInteger(name: string, required?: boolean): number | null;
    getString(name: string, required?: boolean): string | null;
  };
  isChatInputCommand?: () => boolean;
  reply?: (payload: unknown) => Promise<unknown>;
  followUp?: (payload: unknown) => Promise<unknown>;
}

interface AuditLogDeps {
  GuildAuditLogModel: GuildAuditLogModelLike;
  safeDefer(interaction: DiscordInteraction, ephemeral?: boolean): Promise<void>;
  safeEdit(interaction: DiscordInteraction, payload: InteractionPayload): Promise<unknown>;
  logger: Logger;
  MessageFlags: { Ephemeral: number };
}

type AuditLogContext = AuditLogDeps;

function limitFromInteraction(interaction: DiscordInteraction): number {
  const raw = interaction.options.getInteger("numar") ?? 10;
  return Math.max(1, Math.min(25, raw));
}

function offsetFromInteraction(interaction: DiscordInteraction): number {
  const raw = interaction.options.getInteger("offset") ?? 0;
  return Math.max(0, raw);
}

function parseDateRange(period: string | null, start: string | null): { start: Date; end: Date; label: string } | null {
  const p = String(period || "").trim().toLowerCase();
  const raw = String(start || "").trim();
  if (p === "luna") {
    const match = /^(\d{4})-(\d{2})$/.exec(raw);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12) return null;
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 1));
    return { start: from, end: to, label: raw };
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const from = new Date(Date.UTC(year, month - 1, day));
  if (from.getUTCFullYear() !== year || from.getUTCMonth() !== month - 1 || from.getUTCDate() !== day) return null;
  const days = p === "zi" ? 1 : p === "saptamana" ? 7 : 0;
  if (days === 0) return null;
  const to = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
  return { start: from, end: to, label: p === "zi" ? raw : `${raw} + 7 zile` };
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
    `rezultat: ${escapeInlineText(entry.result, 200)}`,
    entry.details ? `detalii: ${escapeInlineText(entry.details, 400)}` : ""
  ].filter(Boolean).join(" | "));
  return `Bot log (${entries.length}):\n${clampJoinedList(lines, 1900)}`;
}

function renderServerLog(entries: ServerAuditLogEntry[]): string {
  if (!entries.length) return "Nu exista schimbari importante salvate pentru acest server.";
  const lines = entries.map(entry => [
    `- ${formatDate(entry.at)} ${formatUserReference(entry.userId || "")}`,
    `actiune: \`${entry.action}\``,
    entry.details ? `detalii: ${escapeInlineText(entry.details, 400)}` : ""
  ].filter(Boolean).join(" | "));
  return `Server log (${entries.length}):\n${clampJoinedList(lines, 1900)}`;
}

function withMoreHint(text: string, count: number, offset: number): string {
  if (count < 25) return text;
  return `${text}\n\nMai pot exista intrari mai vechi. Ruleaza aceeasi comanda cu \`offset:${offset + 25}\` ca sa vezi urmatorul lot de 25.`;
}

function createAuditLogInteractionHandler(deps: AuditLogDeps) {
  const { GuildAuditLogModel, safeDefer, safeEdit } = deps;

  async function handleAuditLogInteraction(interaction: DiscordInteraction): Promise<unknown> {
    const guildId = interaction.guild?.id;
    if (!guildId) return undefined;
    await safeDefer(interaction, true);
    const respond = (content: string): Promise<unknown> => safeEdit(interaction, { content, allowedMentions: NO_MENTIONS });
    const subcommand = typeof interaction.options.getSubcommand === "function" ? interaction.options.getSubcommand(false) : "recent";
    if (subcommand === "older") {
      const range = parseDateRange(interaction.options.getString("period", true), interaction.options.getString("start", true));
      if (!range) {
        return respond("Eroare: foloseste `period:zi` sau `period:saptamana` cu `start:YYYY-MM-DD`, ori `period:luna` cu `start:YYYY-MM`.");
      }
      const offset = offsetFromInteraction(interaction);
      if (interaction.commandName === "bot-log") {
        const entries = await listBotAuditEntriesInRange(GuildAuditLogModel, guildId, range.start, range.end, 25, offset);
        return respond(withMoreHint(`Interval ${range.label}\n${renderBotLog(entries)}`, entries.length, offset));
      }
      const entries = await listServerAuditEntriesInRange(GuildAuditLogModel, guildId, range.start, range.end, 25, offset);
      return respond(withMoreHint(`Interval ${range.label}\n${renderServerLog(entries)}`, entries.length, offset));
    }
    const limit = limitFromInteraction(interaction);
    if (interaction.commandName === "bot-log") return respond(renderBotLog(await listBotAuditEntries(GuildAuditLogModel, guildId, limit)));
    return respond(renderServerLog(await listServerAuditEntries(GuildAuditLogModel, guildId, limit)));
  }

  return { handleAuditLogInteraction };
}

function isAuditLogCommand(interaction: DiscordInteraction): boolean {
  return matchesCommand(interaction, { commandNames: ["bot-log", "server-log"] });
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
        return handledCommandError(errorDetail(err));
      }
    }
  };
  return { handlers, ...command };
}

export default {
  createAuditLogInteractionHandler,
  renderBotLog,
  renderServerLog,
  buildCommandHandler: buildAuditLogCommandHandler
};
