"use strict";

import type { GameConfig } from "../../types";
import type { CommandHandler } from "../command-registry/commandHandler";

const { errorDetail } = require("../../shared/errors");

type DiscordInteraction = {
  commandName?: string;
  guild?: unknown;
  deferred?: boolean;
  replied?: boolean;
  isChatInputCommand?: () => boolean;
  isAutocomplete?: () => boolean;
  reply: (payload: unknown) => Promise<unknown>;
  followUp?: (payload: unknown) => Promise<unknown>;
  respond?: (choices: unknown[]) => Promise<unknown>;
};

type Logger = (level: string, context: string, msg: string, meta?: unknown) => void;

interface RouterContext {
  MessageFlags: { Ephemeral: number };
  logger: Logger;
  handleInteraction?: (interaction: DiscordInteraction, games: GameConfig[]) => Promise<unknown>;
}

function createFallbackInteractionHandler(deps: RouterContext) {
  const { MessageFlags, logger } = deps;

  async function handleInteraction(interaction: DiscordInteraction, _games: GameConfig[]) {
    try {
      if (typeof interaction.isAutocomplete === "function" && interaction.isAutocomplete()) {
        if (typeof interaction.respond === "function") {
          await interaction.respond([]).catch(() => null);
        }
        return;
      }

      if (typeof interaction.isChatInputCommand !== "function" || !interaction.isChatInputCommand()) {
        return;
      }
      if (!interaction.guild) {
        return interaction.reply({
          content: "Comenzile sunt disponibile doar pe servere.",
          flags: MessageFlags.Ephemeral
        }).catch(() => null);
      }

      const cmd = interaction.commandName || "<undefined>";
      logger("WARN", "INTERACTION", `Comanda necunoscuta: /${cmd} — niciun handler in chain nu a interceptat-o`);
      return interaction.reply({
        content: `Eroare: Comanda \`/${cmd}\` nu este recunoscuta. Foloseste \`/help\` pentru lista.`,
        flags: MessageFlags.Ephemeral
      }).catch(() => null);
    } catch (err: unknown) {
      logger("ERROR", "INTERACTION", "Eroare in bottom-of-chain handler", errorDetail(err));
      const payload = { content: "Eroare: Eroare neasteptata la procesarea comenzii.", flags: MessageFlags.Ephemeral };
      try {
        if ((interaction.deferred || interaction.replied) && typeof interaction.followUp === "function") {
          await interaction.followUp(payload);
        } else {
          await interaction.reply(payload);
        }
      } catch {  }
    }
  }

  return { handleInteraction };
}

function buildFallbackCommandHandler(target: RouterContext): CommandHandler {
  const { handleInteraction } = createFallbackInteractionHandler({
    MessageFlags: target.MessageFlags,
    logger: target.logger
  });
  return {
    canHandle: () => true,
    handle: (interaction, games) => handleInteraction(interaction as DiscordInteraction, games as GameConfig[])
  };
}

type FallbackInteractionInstaller = ((target: RouterContext) => void) & {
  createFallbackInteractionHandler: typeof createFallbackInteractionHandler;
  buildCommandHandler: typeof buildFallbackCommandHandler;
};

const installFallbackInteractionHandler = ((target: RouterContext): void => {
  Object.assign(target, createFallbackInteractionHandler({
    MessageFlags: target.MessageFlags,
    logger: target.logger
  }));
}) as FallbackInteractionInstaller;

installFallbackInteractionHandler.createFallbackInteractionHandler = createFallbackInteractionHandler;
installFallbackInteractionHandler.buildCommandHandler = buildFallbackCommandHandler;

export = installFallbackInteractionHandler;
