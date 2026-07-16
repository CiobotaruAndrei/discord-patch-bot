"use strict";

import { applyGuildConfigUpdate } from "../guild-config/guildConfigRepository.js";
type MongoFilter = Record<string, unknown>;
type MongoUpdate = Record<string, unknown>;
type MongoQueryOptions = Record<string, unknown>;
import { buildSetUpdatePlan } from "./setUpdatePlan.js";
import type { CommandHandler } from "../command-registry/commandHandler.js";

import { handledCommandError } from "../command-security/commandOutcome.js";
import { errorDetail, errorMessage } from "../../shared/errors.js";

type MaybePromise<T> = T | Promise<T>;
type GameConfig = { key: string; name: string } & Record<string, unknown>;
type DiscordInteraction = {
  commandName?: string;
  guild?: { id: string } | null;
  deferred?: boolean;
  replied?: boolean;
  options: {
    getSubcommandGroup(required: false): string | null;
    getSubcommand(): string;
    getString(name: string): string | null;
    getInteger(name: string): number | null;
  };
  isChatInputCommand?: () => boolean;
  reply: (payload: unknown) => Promise<unknown>;
  followUp?: (payload: unknown) => Promise<unknown>;
};
type NextInteractionHandler = (interaction: DiscordInteraction, games: GameConfig[]) => MaybePromise<unknown>;

type GuildModelLike = {
  updateOne(filter: MongoFilter, update: MongoUpdate, opts?: MongoQueryOptions): Promise<{ matchedCount?: number; modifiedCount?: number }>;
};

type Logger = (level: string, context: string, msg: string, meta?: unknown) => void;

type GuildChannelSettings = { notificationChannelId?: string | null; discountChannelId?: string | null } | null;

type SetInteractionDeps = {
  GuildModel: GuildModelLike;
  formatUserError: (err: unknown, fallback: string, code?: string) => string;
  safeDefer: (interaction: DiscordInteraction, ephemeral?: boolean) => Promise<void>;
  safeEdit: (interaction: DiscordInteraction, content: string) => Promise<unknown>;
  logger: Logger;
  SUPPORTED_CURRENCIES: Record<string, unknown>;
  getGuildSettings?: (guildId: string) => Promise<GuildChannelSettings>;
  checkReadMessageHistory?: (interaction: DiscordInteraction, channelId: string) => Promise<boolean | null>;
};

type SetContext = SetInteractionDeps & {
  MessageFlags: { Ephemeral: number };
};

function createSetInteractionHandler(deps: SetInteractionDeps) {
  const {
    GuildModel, formatUserError, safeDefer, safeEdit, logger,
    SUPPORTED_CURRENCIES, getGuildSettings, checkReadMessageHistory
  } = deps;

  async function readHistoryWarning(interaction: DiscordInteraction, guildId: string): Promise<string> {
    if (!getGuildSettings || !checkReadMessageHistory) return "";
    const settings = await getGuildSettings(guildId).catch(() => null);
    const channelIds = Array.from(new Set([settings?.notificationChannelId, settings?.discountChannelId]
      .filter((id): id is string => typeof id === "string" && id.length > 0)));
    if (!channelIds.length) return "";
    const missing: string[] = [];
    for (const channelId of channelIds) {
      const allowed = await checkReadMessageHistory(interaction, channelId).catch(() => null);
      if (allowed === false) missing.push(channelId);
    }
    if (!missing.length) return "";
    return `\n:warning: Botul nu are permisiunea **Read Message History** pe ${missing.map(id => `<#${id}>`).join(", ")}; recovery-verify nu poate citi istoricul si va trata fiecare reluare ca duplicat nedetectat.`;
  }

  async function handleSetInteraction(interaction: DiscordInteraction): Promise<unknown> {
    if (!interaction.guild) return undefined;
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();
    await safeDefer(interaction, true);

    const plan = buildSetUpdatePlan(sub, interaction, SUPPORTED_CURRENCIES);

    if (plan.earlyReply) {
      return safeEdit(interaction, plan.earlyReply);
    }
    if (!plan.confirmMsg || Object.keys(plan.updateDoc).length === 0) {

      const group = interaction.options.getSubcommandGroup(false);
      logger("WARN", "SET_COMMAND", `Subcomanda /set necunoscuta: ${sub} (group=${group || "none"})`);
      return safeEdit(interaction, `Eroare: Subcomanda \`/set ${sub}\` nu este recunoscuta. Foloseste \`/help\` pentru lista.`);
    }

    const updateDoc: Record<string, unknown> = { ...plan.updateDoc };
    if (plan.isFilterChange) updateDoc.pendingDiscounts = [];

    try {
      await applyGuildConfigUpdate(GuildModel, guildId, updateDoc);
      const tail = plan.isFilterChange ? " *(coada de pending a fost resetata)*" : "";
      const warning = updateDoc.outboxRecoveryVerify === true ? await readHistoryWarning(interaction, guildId) : "";
      return safeEdit(interaction, plan.confirmMsg + tail + warning);
    } catch (err: unknown) {
      logger("WARN", "SET_COMMAND", `Eroare la salvarea preferintelor pentru ${guildId}`, errorMessage(err));
      await safeEdit(interaction, formatUserError(err, "Eroare la salvarea preferintelor."));
      return handledCommandError(errorDetail(err));
    }
  }

  return { handleSetInteraction };
}

function isDirectSetCommand(interaction: DiscordInteraction): boolean {
  if (interaction?.isChatInputCommand?.() !== true) return false;
  if (!interaction.guild) return false;
  if (interaction.commandName !== "set") return false;
  const group = interaction.options?.getSubcommandGroup?.(false);
  const subcommand = interaction.options?.getSubcommand?.();
  return group !== "games" && group !== "role"
    && !((group === "add" || group === "remove") && subcommand === "games")
    && subcommand !== "admin-command-access"
    && !["new-account-alert-channel", "threat-alert-channel", "bot-add-alert-channel", "warn-channel"].includes(subcommand);
}

function buildSetCommandHandler(target: SetContext) {
  const handlers = createSetInteractionHandler({
    GuildModel: target.GuildModel,
    formatUserError: target.formatUserError,
    safeDefer: target.safeDefer,
    safeEdit: target.safeEdit,
    logger: target.logger,
    SUPPORTED_CURRENCIES: target.SUPPORTED_CURRENCIES,
    getGuildSettings: target.getGuildSettings,
    checkReadMessageHistory: target.checkReadMessageHistory
  });

  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => Boolean(isDirectSetCommand(interaction as DiscordInteraction)),
    handle: async (interaction) => {
      const di = interaction;
      try {
        return await handlers.handleSetInteraction(di);
      } catch (err: unknown) {
        target.logger?.("ERROR", "SET_INTERACTION", "Eroare in handler-ul /set", errorDetail(err));
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

export default { createSetInteractionHandler, buildSetUpdatePlan, buildCommandHandler: buildSetCommandHandler };
