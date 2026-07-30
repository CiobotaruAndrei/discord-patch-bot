"use strict";

import type { LoggerFunction } from "../../types.js";
import type { GameConfig } from "../../config/configTypes.js";
import type { GuildSettings } from "../guild-config/guildSettingsTypes.js";

import {
  buildInteractionCommandPath,
  commandCanBeSnoozed,
  displayCommandPath,
  readCommandSnoozeUntil
} from "../command-snooze/commandSnoozeState.js";

type MaybePromise<T> = T | Promise<T>;
type InteractionPayload = { content: string; flags: number };
type DiscordInteraction = {
  commandName?: string;
  guild?: { id?: string } | null;
  isChatInputCommand?: () => boolean;
  options?: {
    getSubcommandGroup?(required: false): string | null;
    getSubcommand?(required?: false): string | null;
  };
  reply?: (payload: InteractionPayload) => Promise<unknown>;
};
type NextInteractionHandler = (interaction: DiscordInteraction, games: GameConfig[]) => MaybePromise<unknown>;

type CommandSnoozeGuardDeps = {
  getGuildSettings: (guildId: string) => Promise<GuildSettings | null>;
  MessageFlags: { Ephemeral: number };
  logger?: LoggerFunction;
};

function formatDiscordTimestamp(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}

function isSnoozeEligibleInteraction(interaction: DiscordInteraction): boolean {
  return interaction?.isChatInputCommand?.() === true
    && Boolean(interaction.guild?.id)
    && commandCanBeSnoozed(interaction.commandName || "");
}

function createCommandSnoozeGuard(deps: CommandSnoozeGuardDeps) {
  async function handleSnoozedCommand(
    interaction: DiscordInteraction,
    games: GameConfig[],
    next?: NextInteractionHandler
  ): Promise<unknown> {
    if (!isSnoozeEligibleInteraction(interaction)) {
      if (typeof next === "function") return next(interaction, games);
      return undefined;
    }

    const guildId = String(interaction.guild?.id || "");
    const commandPath = buildInteractionCommandPath(interaction);
    const guild = await deps.getGuildSettings(guildId).catch((err) => {
      deps.logger?.("WARN", "COMMAND_SNOOZE", "Nu am putut citi starea de snooze", err);
      return null;
    });
    const until = readCommandSnoozeUntil(guild?.commandSnoozes, commandPath);
    if (!until || until.getTime() <= Date.now()) {
      if (typeof next === "function") return next(interaction, games);
      return undefined;
    }

    await interaction.reply?.({
      content: `Comanda ${displayCommandPath(commandPath)} este in pauza pana ${formatDiscordTimestamp(until)}. Un admin o poate reporni cu /unsnooze.`,
      flags: deps.MessageFlags.Ephemeral
    }).catch(() => null);
    return undefined;
  }

  return { handleSnoozedCommand };
}

const commandSnoozeGuardModule = {
  createCommandSnoozeGuard,
  isSnoozeEligibleInteraction
};

export default commandSnoozeGuardModule;
