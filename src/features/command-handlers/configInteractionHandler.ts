"use strict";

import type { CommandHandler } from "../command-registry/commandHandler";
import type { CurrencyCode, GameConfig, GuildSettings } from "../../types";
import { buildConfigEmbed, type ConfigEmbed } from "./configView";

import { handledCommandError } from "../command-security/commandOutcome";
const { errorDetail } = require("../../shared/errors");

type MaybePromise<T> = T | Promise<T>;
type DiscordInteraction = {
  commandName?: string;
  guild?: { id?: string } | null;
  deferred?: boolean;
  replied?: boolean;
  isChatInputCommand?: () => boolean;
  reply: (payload: InteractionPayload) => Promise<unknown>;
  followUp?: (payload: InteractionPayload) => Promise<unknown>;
};
type NextInteractionHandler = (interaction: DiscordInteraction, games: GameConfig[]) => MaybePromise<unknown>;
type Logger = (level: string, context: string, message: string, meta?: unknown) => void;
type CommandLogEnd = (status?: string, endExtra?: Record<string, unknown>) => void;
type InteractionPayload = string | { content?: string; embeds?: ConfigEmbed[]; flags?: number };

interface ConfigHandlerDeps {
  logger: Logger;
  enforceCooldown: (interaction: DiscordInteraction, command: string) => Promise<boolean>;
  startCommandLog: (interaction: DiscordInteraction, command: string, extra?: Record<string, unknown>) => CommandLogEnd;
  safeDefer: (interaction: DiscordInteraction, ephemeral?: boolean) => Promise<void>;
  safeEdit: (interaction: DiscordInteraction, payload: InteractionPayload) => Promise<unknown>;
  getGuildSettings: (guildId: string) => Promise<GuildSettings | null>;
  DEFAULT_CURRENCY: CurrencyCode;
  MessageFlags: { Ephemeral: number };
}

type ConfigContext = ConfigHandlerDeps & { handleInteraction?: NextInteractionHandler };

function createConfigInteractionHandler(deps: ConfigHandlerDeps) {
  const { enforceCooldown, startCommandLog, safeDefer, safeEdit, getGuildSettings, DEFAULT_CURRENCY, MessageFlags } = deps;

  async function handleConfigInteraction(interaction: DiscordInteraction, games: GameConfig[]): Promise<unknown> {
    const guildId = interaction.guild?.id;
    if (!guildId) {
      return interaction.reply({ content: "Eroare: comanda /config merge doar pe un server.", flags: MessageFlags.Ephemeral });
    }
    if (!(await enforceCooldown(interaction, "config"))) return undefined;
    const endLog = startCommandLog(interaction, "config");
    await safeDefer(interaction, true);
    const settings = await getGuildSettings(guildId);
    const embed = buildConfigEmbed(settings, games, DEFAULT_CURRENCY);
    endLog("ok");
    return safeEdit(interaction, { embeds: [embed] });
  }

  return { handleConfigInteraction };
}

function isConfigCommand(interaction: DiscordInteraction): boolean {
  return interaction?.isChatInputCommand?.() === true
    && Boolean(interaction.guild)
    && interaction.commandName === "config";
}

function createInteractionErrorPayload(MessageFlags: { Ephemeral: number }): InteractionPayload {
  return { content: "Eroare: Eroare neasteptata la procesarea comenzii.", flags: MessageFlags.Ephemeral };
}

type ConfigInstaller = ((target: ConfigContext) => void) & {
  createConfigInteractionHandler: typeof createConfigInteractionHandler;
  buildConfigEmbed: typeof buildConfigEmbed;
  buildCommandHandler: typeof buildConfigCommandHandler;
};

function buildConfigCommandHandler(target: ConfigContext) {
  const handlers = createConfigInteractionHandler({
    logger: target.logger,
    enforceCooldown: target.enforceCooldown,
    startCommandLog: target.startCommandLog,
    safeDefer: target.safeDefer,
    safeEdit: target.safeEdit,
    getGuildSettings: target.getGuildSettings,
    DEFAULT_CURRENCY: target.DEFAULT_CURRENCY,
    MessageFlags: target.MessageFlags
  });
  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => isConfigCommand(interaction as DiscordInteraction),
    handle: async (interaction, games) => {
      const di = interaction;
      try {
        return await handlers.handleConfigInteraction(di, games);
      } catch (err: unknown) {
        target.logger?.("ERROR", "CONFIG_INTERACTION", "Eroare in handler-ul /config", errorDetail(err));
        const payload = createInteractionErrorPayload(target.MessageFlags);
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

export = {
  buildCommandHandler: buildConfigCommandHandler,
  createConfigInteractionHandler,
  buildConfigEmbed
};
