"use strict";

import { clearCommandSnooze, setCommandSnooze } from "../guild-config/guildConfigRepository";
import type { CommandHandler } from "../command-registry/commandHandler";

import { handledCommandError } from "../command-security/commandOutcome";
const { errorDetail } = require("../../shared/errors");
const {
  commandCanBeSnoozed,
  commandPathToSnoozeKey,
  displayCommandPath,
  parseSnoozeDuration
} = require("../command-snooze/commandSnoozeState") as typeof import("../command-snooze/commandSnoozeState");
const { findCommandHelpEntry } = require("../command-help/commandHelpCatalog") as typeof import("../command-help/commandHelpCatalog");

type MaybePromise<T> = T | Promise<T>;
type GameConfig = { key: string; name: string } & Record<string, unknown>;
type InteractionPayload = string | { content: string; flags?: number };
type MongoWriteResult = { matchedCount?: number; modifiedCount?: number };
type SnoozeSetUpdate = { $set: Record<string, Date> };
type SnoozeUnsetUpdate = { $unset: Record<string, string> };
type SnoozeUpdate = SnoozeSetUpdate | SnoozeUnsetUpdate;
type Logger = (level: string, context: string, message: string, meta?: unknown) => void;

type DiscordInteraction = {
  commandName?: string;
  guild?: { id?: string } | null;
  deferred?: boolean;
  replied?: boolean;
  isChatInputCommand?: () => boolean;
  options: {
    getString(name: string, required?: boolean): string | null;
  };
  reply: (payload: InteractionPayload) => Promise<unknown>;
  followUp?: (payload: InteractionPayload) => Promise<unknown>;
};

type NextInteractionHandler = (interaction: DiscordInteraction, games: GameConfig[]) => MaybePromise<unknown>;

type SnoozeInteractionDeps = {
  GuildModel: {
    updateOne(filter: Record<string, string>, update: SnoozeUpdate, options?: { upsert: boolean }): Promise<MongoWriteResult>;
  };
  invalidateGuildCache: (guildId: string) => void;
  safeDefer: (interaction: DiscordInteraction, ephemeral?: boolean) => Promise<void>;
  safeEdit: (interaction: DiscordInteraction, payload: InteractionPayload) => Promise<unknown>;
  MessageFlags: { Ephemeral: number };
};

type SnoozeContext = SnoozeInteractionDeps & {
  logger?: Logger;
  handleInteraction?: NextInteractionHandler;
};

function commandError(message: string, MessageFlags: { Ephemeral: number }): InteractionPayload {
  return { content: `Eroare: ${message}`, flags: MessageFlags.Ephemeral };
}

function resolveCatalogCommand(raw: string): string | null {
  const entry = findCommandHelpEntry(raw);
  return entry ? entry.command : null;
}

function formatDiscordTimestamp(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}

function createSnoozeInteractionHandler(deps: SnoozeInteractionDeps) {
  const { GuildModel, invalidateGuildCache, safeDefer, safeEdit, MessageFlags } = deps;

  async function handleSnoozeInteraction(interaction: DiscordInteraction): Promise<unknown> {
    const guildId = interaction.guild?.id;
    if (!guildId) {
      return interaction.reply(commandError("comanda merge doar pe un server.", MessageFlags));
    }

    const requested = String(interaction.options.getString("command", true) || "").trim();
    const catalogCommand = resolveCatalogCommand(requested);
    if (!catalogCommand) {
      return interaction.reply(commandError("alege o comanda existenta din autocomplete.", MessageFlags));
    }
    if (!commandCanBeSnoozed(catalogCommand)) {
      return interaction.reply(commandError("nu poti pune pe pauza comenzile de snooze sau unsnooze.", MessageFlags));
    }

    const commandLabel = displayCommandPath(catalogCommand);
    const key = commandPathToSnoozeKey(catalogCommand);

    if (interaction.commandName === "unsnooze") {
      await safeDefer(interaction, true);
      await clearCommandSnooze(GuildModel, guildId, key);
      invalidateGuildCache(guildId);
      return safeEdit(interaction, `OK: ${commandLabel} nu mai este in pauza.`);
    }

    const duration = parseSnoozeDuration(String(interaction.options.getString("durata", true) || ""));
    if (!duration.ok) {
      return interaction.reply(commandError(duration.message, MessageFlags));
    }

    await safeDefer(interaction, true);
    await setCommandSnooze(GuildModel, guildId, key, duration.until);
    invalidateGuildCache(guildId);
    return safeEdit(interaction, `OK: ${commandLabel} este in pauza pana ${formatDiscordTimestamp(duration.until)}.`);
  }

  return { handleSnoozeInteraction };
}

function isSnoozeCommand(interaction: DiscordInteraction): boolean {
  return interaction?.isChatInputCommand?.() === true
    && Boolean(interaction.guild)
    && (interaction.commandName === "snooze" || interaction.commandName === "unsnooze");
}

function createInteractionErrorPayload(MessageFlags: { Ephemeral: number }): InteractionPayload {
  return { content: "Eroare: Eroare neasteptata la procesarea comenzii.", flags: MessageFlags.Ephemeral };
}

function buildSnoozeCommandHandler(target: SnoozeContext) {
  const handlers = createSnoozeInteractionHandler({
    GuildModel: target.GuildModel,
    invalidateGuildCache: target.invalidateGuildCache,
    safeDefer: target.safeDefer,
    safeEdit: target.safeEdit,
    MessageFlags: target.MessageFlags
  });

  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => isSnoozeCommand(interaction as DiscordInteraction),
    handle: async (interaction) => {
      const di = interaction;
      try {
        return await handlers.handleSnoozeInteraction(di);
      } catch (err: unknown) {
        target.logger?.("ERROR", "SNOOZE_INTERACTION", "Eroare in handler-ul /snooze", errorDetail(err));
        const payload = createInteractionErrorPayload(target.MessageFlags);
        try {
          if ((di.deferred || di.replied) && typeof di.followUp === "function") {
            await di.followUp(payload);
          } else {
            await di.reply(payload);
          }
        } catch {
        }
        return handledCommandError(errorDetail(err));
      }
    }
  };
  return { handlers, ...command };
}

export = {
  createSnoozeInteractionHandler,
  buildCommandHandler: buildSnoozeCommandHandler
};
