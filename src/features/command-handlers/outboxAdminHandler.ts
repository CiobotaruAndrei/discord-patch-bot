"use strict";

import type { OutboxDiscordClient } from "../notifications/outboundChannel";
import type { RuntimeEnv } from "../../types";
import type { CommandHandler } from "../command-registry/commandHandler";
import type {
  ChannelPermissions,
  DrainResultLike,
  EnqueueOutbox,
  GuildSettingsLike,
  OutboxAdminInteraction,
  OutboxAdminLogger,
  OutboxModelLike,
  ReplayDeadLetterDoc
} from "./outboxAdminContracts";
import { createOutboxAdminViews } from "./outboxAdminViews";
import { createOutboxAdminOperations } from "./outboxAdminOperations";

import { handledCommandError } from "../command-security/commandOutcome";
const { errorDetail, errorMessage } = require("../../shared/errors");

type MaybePromise<T> = T | Promise<T>;
type GameConfig = { key: string; name: string } & Record<string, unknown>;
type DiscordInteraction = OutboxAdminInteraction;
type NextInteractionHandler = (interaction: DiscordInteraction, games: GameConfig[]) => MaybePromise<unknown>;

type OutboxAdminDeps = {
  NotificationOutboxModel: OutboxModelLike;
  GuildModel: { updateOne(filter: unknown, update: unknown): Promise<{ modifiedCount?: number; matchedCount?: number }> };
  invalidateGuildCache: (guildId: string) => void;
  enqueueOutbox?: EnqueueOutbox;
  listReplayableDeadLetters: (guildId: string) => Promise<ReplayDeadLetterDoc[]>;
  deleteReplayedDeadLetters: (guildId: string, ids: unknown[]) => Promise<void>;
  deleteAllReplayPayloads: (guildId: string) => Promise<void>;
  getGuildSettings: (guildId: string) => Promise<GuildSettingsLike | null>;
  getOutboxPaused: () => Promise<boolean>;
  setOutboxPaused: (paused: boolean) => Promise<void>;
  checkChannelPermissions: (interaction: DiscordInteraction, channelId: string) => Promise<ChannelPermissions | null>;
  acquireDbLock: (jobName: string, ttlMs: number) => Promise<string | null>;
  releaseDbLock: (jobName: string, token: string) => Promise<unknown>;
  drainOutbox: (client: OutboxDiscordClient) => Promise<DrainResultLike | unknown>;
  safeDefer: (interaction: DiscordInteraction, ephemeral?: boolean) => Promise<void>;
  safeEdit: (interaction: DiscordInteraction, content: string) => Promise<unknown>;
  formatUserError: (err: unknown, fallback: string, code?: string) => string;
  logger: OutboxAdminLogger;
  outboxEnabled: boolean;
  recoveryVerifyGlobal: boolean;
  recoveryStrict: boolean;
  outboxGlobalAdminIds: string[];
  deadLetterPreviewLimit?: number;
};

type OutboxAdminContext = Omit<OutboxAdminDeps, "outboxEnabled" | "recoveryVerifyGlobal" | "recoveryStrict" | "outboxGlobalAdminIds"> & {
  MessageFlags: { Ephemeral: number };
  handleInteraction?: NextInteractionHandler;
  env: RuntimeEnv;
};

function createOutboxAdminHandler(deps: OutboxAdminDeps) {
  const { setOutboxPaused, safeDefer, safeEdit, formatUserError, logger } = deps;

  const views = createOutboxAdminViews({
    NotificationOutboxModel: deps.NotificationOutboxModel,
    getGuildSettings: deps.getGuildSettings,
    getOutboxPaused: deps.getOutboxPaused,
    checkChannelPermissions: deps.checkChannelPermissions,
    outboxEnabled: deps.outboxEnabled,
    recoveryVerifyGlobal: deps.recoveryVerifyGlobal,
    recoveryStrict: deps.recoveryStrict,
    deadLetterPreviewLimit: deps.deadLetterPreviewLimit
  });

  const operations = createOutboxAdminOperations({
    NotificationOutboxModel: deps.NotificationOutboxModel,
    GuildModel: deps.GuildModel,
    invalidateGuildCache: deps.invalidateGuildCache,
    enqueueOutbox: deps.enqueueOutbox,
    listReplayableDeadLetters: deps.listReplayableDeadLetters,
    deleteReplayedDeadLetters: deps.deleteReplayedDeadLetters,
    deleteAllReplayPayloads: deps.deleteAllReplayPayloads,
    getGuildSettings: deps.getGuildSettings,
    getOutboxPaused: deps.getOutboxPaused,
    acquireDbLock: deps.acquireDbLock,
    releaseDbLock: deps.releaseDbLock,
    drainOutbox: deps.drainOutbox,
    logger: deps.logger,
    outboxEnabled: deps.outboxEnabled,
    outboxGlobalAdminIds: deps.outboxGlobalAdminIds
  });

  async function handleOutboxInteraction(interaction: DiscordInteraction): Promise<unknown> {
    if (!interaction.guild) return undefined;
    const guildId = interaction.guild.id;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    await safeDefer(interaction, true);

    try {
      if (group === "recovery-verify" && sub === "status") {
        return safeEdit(interaction, await views.renderRecoveryVerifyStatus(guildId));
      }
      if (!group) {
        if (sub === "status") return safeEdit(interaction, await views.renderStatus(guildId));
        if (sub === "deadletters") return safeEdit(interaction, await views.renderDeadLetters(guildId));
        if (sub === "clear-deadletters") return safeEdit(interaction, await operations.clearDeadLetters(guildId));
        if (sub === "replay-deadletters") return safeEdit(interaction, await operations.replayDeadLetters(guildId));
        if (sub === "retry") return safeEdit(interaction, await operations.retryQueued(guildId));
        if (sub === "pause") {
          const refusal = operations.globalOperationRefusal(interaction, "pause");
          if (refusal) return safeEdit(interaction, refusal);
          await setOutboxPaused(true);
          return safeEdit(interaction, "OK: Drenarea outbox-ului a fost pusa pe pauza (global). Joburile raman in coada pana la `/outbox resume`.");
        }
        if (sub === "resume") {
          const refusal = operations.globalOperationRefusal(interaction, "resume");
          if (refusal) return safeEdit(interaction, refusal);
          await setOutboxPaused(false);
          return safeEdit(interaction, "OK: Drenarea outbox-ului a fost reluata (global).");
        }
        if (sub === "permissions") return safeEdit(interaction, await views.renderPermissions(interaction, guildId));
        if (sub === "drain-now") return safeEdit(interaction, await operations.drainNow(interaction));
      }
      logger("WARN", "OUTBOX_COMMAND", `Subcomanda /outbox necunoscuta: ${group ? `${group} ` : ""}${sub}`);
      return safeEdit(interaction, `Eroare: Subcomanda \`/outbox ${group ? `${group} ` : ""}${sub}\` nu este recunoscuta.`);
    } catch (err: unknown) {
      logger("WARN", "OUTBOX_COMMAND", `Eroare la /outbox ${sub}`, errorMessage(err));
      await safeEdit(interaction, formatUserError(err, "Eroare la procesarea comenzii /outbox."));
      return handledCommandError(errorDetail(err));
    }
  }

  return { handleOutboxInteraction };
}

function isDirectOutboxCommand(interaction: DiscordInteraction): boolean {
  return interaction?.isChatInputCommand?.() === true
    && Boolean(interaction.guild)
    && interaction.commandName === "outbox";
}

function buildOutboxAdminCommandHandler(target: OutboxAdminContext) {
  const handlers = createOutboxAdminHandler({
    NotificationOutboxModel: target.NotificationOutboxModel,
    GuildModel: target.GuildModel,
    invalidateGuildCache: target.invalidateGuildCache,
    enqueueOutbox: target.enqueueOutbox as EnqueueOutbox | undefined,
    listReplayableDeadLetters: target.listReplayableDeadLetters as (guildId: string) => Promise<ReplayDeadLetterDoc[]>,
    deleteReplayedDeadLetters: target.deleteReplayedDeadLetters as (guildId: string, ids: unknown[]) => Promise<void>,
    deleteAllReplayPayloads: target.deleteAllReplayPayloads as (guildId: string) => Promise<void>,
    getGuildSettings: target.getGuildSettings,
    getOutboxPaused: target.getOutboxPaused,
    setOutboxPaused: target.setOutboxPaused,
    checkChannelPermissions: target.checkChannelPermissions,
    acquireDbLock: target.acquireDbLock,
    releaseDbLock: target.releaseDbLock,
    drainOutbox: target.drainOutbox,
    safeDefer: target.safeDefer,
    safeEdit: target.safeEdit,
    formatUserError: target.formatUserError,
    logger: target.logger,
    outboxEnabled: target.env.NOTIFICATION_OUTBOX_ENABLED,
    recoveryVerifyGlobal: target.env.NOTIFICATION_OUTBOX_RECOVERY_VERIFY,
    recoveryStrict: target.env.NOTIFICATION_OUTBOX_RECOVERY_STRICT,
    outboxGlobalAdminIds: target.env.NOTIFICATION_OUTBOX_GLOBAL_ADMIN_IDS
  });

  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => Boolean(isDirectOutboxCommand(interaction as DiscordInteraction)),
    handle: async (interaction) => {
      const di = interaction;
      try {
        return await handlers.handleOutboxInteraction(di);
      } catch (err: unknown) {
        target.logger?.("ERROR", "OUTBOX_INTERACTION", "Eroare in handler-ul /outbox", errorDetail(err));
        const payload = { content: "Eroare: Eroare neasteptata la procesarea comenzii.", flags: target.MessageFlags.Ephemeral };
        try {
          if ((di.deferred || di.replied) && typeof di.followUp === "function") {
            await di.followUp(payload);
          } else {
            await di.reply(payload);
          }
        } catch {  }
        return handledCommandError(errorDetail(err));
      }
    }
  };
  return { handlers, ...command };
}

export = { createOutboxAdminHandler, isDirectOutboxCommand, buildCommandHandler: buildOutboxAdminCommandHandler };
