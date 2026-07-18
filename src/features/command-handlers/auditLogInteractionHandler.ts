"use strict";

import type { BotAuditLogEntry, DiscordReplyPayload, GameConfig, GuildSettings, ServerAuditLogEntry } from "../../types.js";
import type { CommandHandler } from "../command-registry/commandHandler.js";
import { matchesCommand } from "../command-registry/commandMatch.js";
import { clampJoinedList } from "../command-presentation/discordListLimit.js";
import {
  listBotAuditEntries,
  listBotAuditEntriesInRange,
  listServerAuditEntries,
  listServerAuditEntriesInRange,
  type GuildAuditLogModelLike
} from "../admin-records/auditLogRepository.js";
import { handledCommandError } from "../command-security/commandOutcome.js";
import { escapeInlineText, NO_MENTIONS } from "../../shared/discordText.js";

import { errorDetail } from "../../shared/errors.js";

type InteractionPayload = DiscordReplyPayload;
type Logger = (level: string, context: string, message: string, meta?: unknown) => void;

interface DiscordInteraction {
  id?: string;
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
  scheduleAuditBatch?: AuditBatchScheduler;
  auditBatchIntervalMs?: number;
}

interface ScheduledAuditBatch {
  cancel(): void;
}

type AuditBatchScheduler = (task: () => Promise<void>, delayMs: number) => ScheduledAuditBatch;

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
    `- ${formatDate(entry.at)} actor: ${formatUserReference(entry.actorId || entry.userId || "")}`,
    entry.targetId ? `tinta: ${formatUserReference(entry.targetId)}` : "",
    `actiune: \`${entry.action}\``,
    entry.details ? `detalii: ${escapeInlineText(entry.details, 400)}` : ""
  ].filter(Boolean).join(" | "));
  return `Server log (${entries.length}):\n${clampJoinedList(lines, 1900)}`;
}

function defaultAuditBatchScheduler(task: () => Promise<void>, delayMs: number): ScheduledAuditBatch {
  const timer = setTimeout(() => { void task(); }, delayMs);
  timer.unref?.();
  return { cancel: () => clearTimeout(timer) };
}

function createAuditLogInteractionHandler(deps: AuditLogDeps) {
  const { GuildAuditLogModel, safeDefer, safeEdit } = deps;
  const scheduleAuditBatch = deps.scheduleAuditBatch ?? defaultAuditBatchScheduler;
  const configuredBatchInterval = typeof deps.auditBatchIntervalMs === "number"
    ? deps.auditBatchIntervalMs
    : 120000;
  const batchIntervalMs = Math.max(1, configuredBatchInterval);
  const activeDeliveries = new Map<string | DiscordInteraction, ScheduledAuditBatch>();
  const batchSize = 25;
  const maxBatches = 7;

  function deliveryKey(interaction: DiscordInteraction): string | DiscordInteraction {
    return interaction.id || interaction;
  }

  function cancelAuditDelivery(interaction: DiscordInteraction): boolean {
    const key = deliveryKey(interaction);
    const scheduled = activeDeliveries.get(key);
    if (!scheduled) return false;
    scheduled.cancel();
    activeDeliveries.delete(key);
    return true;
  }

  function fitDeliveryMessage(header: string, rendered: string, status: string): string {
    const fixed = `${header}\n${status}\n`;
    const room = Math.max(0, 1990 - fixed.length);
    return `${fixed}${rendered.slice(0, room)}`;
  }

  async function deliverOlderBatches(
    interaction: DiscordInteraction,
    guildId: string,
    range: { start: Date; end: Date; label: string },
    initialOffset: number
  ): Promise<void> {
    const key = deliveryKey(interaction);
    cancelAuditDelivery(interaction);
    const isBotLog = interaction.commandName === "bot-log";

    async function deliver(batchNumber: number, offset: number, initial: boolean): Promise<void> {
      let rendered = "";
      let visibleCount = 0;
      let hasMore = false;
      if (isBotLog) {
        const fetched = await listBotAuditEntriesInRange(GuildAuditLogModel, guildId, range.start, range.end, batchSize + 1, offset);
        const visible = fetched.slice(0, batchSize);
        rendered = renderBotLog(visible);
        visibleCount = visible.length;
        hasMore = fetched.length > batchSize;
      } else {
        const fetched = await listServerAuditEntriesInRange(GuildAuditLogModel, guildId, range.start, range.end, batchSize + 1, offset);
        const visible = fetched.slice(0, batchSize);
        rendered = renderServerLog(visible);
        visibleCount = visible.length;
        hasMore = fetched.length > batchSize;
      }
      const reachedTokenBudget = hasMore && batchNumber >= maxBatches;
      const status = reachedTokenBudget
        ? `Livrare oprita dupa ${batchNumber * batchSize} intrari: intervalul depaseste fereastra sigura a tokenului Discord. Alege un interval mai mic.`
        : hasMore
          ? `Lot ${batchNumber}: ${visibleCount} intrari. Urmatorul lot va fi trimis automat.`
          : `Livrare finalizata: lot ${batchNumber}, ${visibleCount} intrari.`;
      const payload = {
        content: fitDeliveryMessage(`Interval ${range.label}`, rendered, status),
        flags: deps.MessageFlags.Ephemeral,
        allowedMentions: NO_MENTIONS
      };
      if (initial) {
        await safeEdit(interaction, payload);
      } else {
        if (typeof interaction.followUp !== "function") {
          deps.logger("WARN", "AUDIT_LOG_BATCH", "Livrarea audit-log s-a oprit: follow-up indisponibil", { guildId, batchNumber });
          activeDeliveries.delete(key);
          return;
        }
        try {
          await interaction.followUp(payload);
        } catch (error) {
          deps.logger("WARN", "AUDIT_LOG_BATCH", "Livrarea audit-log s-a oprit: interactiunea a expirat", { guildId, batchNumber, error: errorDetail(error) });
          activeDeliveries.delete(key);
          return;
        }
      }
      if (!hasMore || reachedTokenBudget) {
        activeDeliveries.delete(key);
        return;
      }
      const scheduled = scheduleAuditBatch(async () => {
        activeDeliveries.delete(key);
        try {
          await deliver(batchNumber + 1, offset + batchSize, false);
        } catch (error) {
          deps.logger("WARN", "AUDIT_LOG_BATCH", "Livrarea audit-log s-a oprit dupa o eroare", { guildId, batchNumber: batchNumber + 1, error: errorDetail(error) });
        }
      }, batchIntervalMs);
      activeDeliveries.set(key, scheduled);
    }

    await deliver(1, initialOffset, true);
  }

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
      return deliverOlderBatches(interaction, guildId, range, offset);
    }
    const limit = limitFromInteraction(interaction);
    if (interaction.commandName === "bot-log") return respond(renderBotLog(await listBotAuditEntries(GuildAuditLogModel, guildId, limit)));
    return respond(renderServerLog(await listServerAuditEntries(GuildAuditLogModel, guildId, limit)));
  }

  return { handleAuditLogInteraction, cancelAuditDelivery };
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
