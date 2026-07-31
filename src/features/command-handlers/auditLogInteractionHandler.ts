"use strict";

import type {
  ChatInputInteraction,
  IntegerOption,
  StringOption,
  SubcommandOption
} from "./discordInteractionPorts.js";
import type { DiscordReplyPayload } from "../../types.js";
import type { CommandHandler } from "../command-registry/commandHandler.js";
import { matchesCommand } from "../command-registry/commandMatch.js";
import {
  listBotAuditEntries,
  listBotAuditEntriesInRange,
  listServerAuditEntries,
  listServerAuditEntriesInRange,
  type GuildAuditLogModelLike
} from "../admin-records/auditLogRepository.js";
import { handledCommandError } from "../command-security/commandOutcome.js";
import { NO_MENTIONS } from "../../shared/discordText.js";
import { errorDetail } from "../../shared/errors.js";
import { renderBotLog, renderServerLog } from "../admin-records/auditLogView.js";
import { parseAuditDateRange, type AuditDateRange } from "../admin-records/auditLogDateRange.js";
import {
  defaultAuditBatchScheduler,
  deliverAuditBatches,
  type AuditBatchDelivery,
  type AuditBatchPage,
  type AuditBatchScheduler
} from "../admin-records/auditLogBatchDelivery.js";

type InteractionPayload = DiscordReplyPayload;
type Logger = (level: string, context: string, message: string, meta?: unknown) => void;

type DiscordInteraction = ChatInputInteraction<SubcommandOption & IntegerOption & StringOption>;

interface AuditLogDeps {
  GuildAuditLogModel: GuildAuditLogModelLike;
  safeDefer(interaction: DiscordInteraction, ephemeral?: boolean): Promise<void>;
  safeEdit(interaction: DiscordInteraction, payload: InteractionPayload): Promise<unknown>;
  logger: Logger;
  MessageFlags: { Ephemeral: number };
  scheduleAuditBatch?: AuditBatchScheduler;
  auditBatchIntervalMs?: number;
}

type AuditLogContext = AuditLogDeps;

const BATCH_SIZE = 25;
const MAX_BATCHES = 7;
const DEFAULT_BATCH_INTERVAL_MS = 120000;

const STOP_MESSAGES = {
  "no-follow-up": "Livrarea audit-log s-a oprit: follow-up indisponibil",
  expired: "Livrarea audit-log s-a oprit: interactiunea a expirat",
  failed: "Livrarea audit-log s-a oprit dupa o eroare"
};

function limitFromInteraction(interaction: DiscordInteraction): number {
  const raw = interaction.options.getInteger("numar") ?? 10;
  return Math.max(1, Math.min(25, raw));
}

function offsetFromInteraction(interaction: DiscordInteraction): number {
  const raw = interaction.options.getInteger("offset") ?? 0;
  return Math.max(0, raw);
}

function createAuditLogInteractionHandler(deps: AuditLogDeps) {
  const { GuildAuditLogModel, safeDefer, safeEdit } = deps;
  const scheduleAuditBatch = deps.scheduleAuditBatch ?? defaultAuditBatchScheduler;
  const configuredBatchInterval = typeof deps.auditBatchIntervalMs === "number"
    ? deps.auditBatchIntervalMs
    : DEFAULT_BATCH_INTERVAL_MS;
  const batchIntervalMs = Math.max(1, configuredBatchInterval);
  const activeDeliveries = new Map<string | DiscordInteraction, AuditBatchDelivery>();

  function deliveryKey(interaction: DiscordInteraction): string | DiscordInteraction {
    return interaction.id || interaction;
  }

  function cancelAuditDelivery(interaction: DiscordInteraction): boolean {
    const key = deliveryKey(interaction);
    const delivery = activeDeliveries.get(key);
    if (!delivery) return false;
    activeDeliveries.delete(key);
    return delivery.cancel();
  }

  function pageLoader(guildId: string, range: AuditDateRange, isBotLog: boolean) {
    return async (offset: number, size: number): Promise<AuditBatchPage> => {
      if (isBotLog) {
        const fetched = await listBotAuditEntriesInRange(GuildAuditLogModel, guildId, range.start, range.end, size + 1, offset);
        const visible = fetched.slice(0, size);
        return { rendered: renderBotLog(visible), visibleCount: visible.length, hasMore: fetched.length > size };
      }
      const fetched = await listServerAuditEntriesInRange(GuildAuditLogModel, guildId, range.start, range.end, size + 1, offset);
      const visible = fetched.slice(0, size);
      return { rendered: renderServerLog(visible), visibleCount: visible.length, hasMore: fetched.length > size };
    };
  }

  async function deliverOlderBatches(
    interaction: DiscordInteraction,
    guildId: string,
    range: AuditDateRange,
    initialOffset: number
  ): Promise<void> {
    const key = deliveryKey(interaction);
    cancelAuditDelivery(interaction);
    const followUp = interaction.followUp;
    const payloadOf = (content: string): InteractionPayload => ({
      content,
      flags: deps.MessageFlags.Ephemeral,
      allowedMentions: NO_MENTIONS
    });

    const delivery = await deliverAuditBatches({
      header: `Interval ${range.label}`,
      batchSize: BATCH_SIZE,
      maxBatches: MAX_BATCHES,
      intervalMs: batchIntervalMs,
      fetchPage: pageLoader(guildId, range, interaction.commandName === "bot-log"),
      sendInitial: content => safeEdit(interaction, payloadOf(content)),
      sendFollowUp: typeof followUp === "function" ? content => followUp.call(interaction, payloadOf(content)) : null,
      schedule: scheduleAuditBatch,
      onStopped: (reason, batchNumber, error) => {
        activeDeliveries.delete(key);
        deps.logger("WARN", "AUDIT_LOG_BATCH", STOP_MESSAGES[reason], error === undefined
          ? { guildId, batchNumber }
          : { guildId, batchNumber, error: errorDetail(error) });
      }
    }, initialOffset);

    activeDeliveries.set(key, delivery);
  }

  async function handleAuditLogInteraction(interaction: DiscordInteraction): Promise<unknown> {
    const guildId = interaction.guild?.id;
    if (!guildId) return undefined;
    await safeDefer(interaction, true);
    const respond = (content: string): Promise<unknown> => safeEdit(interaction, { content, allowedMentions: NO_MENTIONS });
    const subcommand = typeof interaction.options.getSubcommand === "function" ? interaction.options.getSubcommand(false) : "recent";
    if (subcommand === "older") {
      const range = parseAuditDateRange(interaction.options.getString("period", true), interaction.options.getString("start", true));
      if (!range) {
        return respond("Eroare: foloseste `period:zi` sau `period:saptamana` cu `start:YYYY-MM-DD`, ori `period:luna` cu `start:YYYY-MM`.");
      }
      return deliverOlderBatches(interaction, guildId, range, offsetFromInteraction(interaction));
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
