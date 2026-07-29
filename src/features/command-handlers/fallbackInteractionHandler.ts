"use strict";

import type {
  AlwaysReplies,
  BaseChatInputInteraction
} from "./discordInteractionPorts.js";
import type { GameConfig } from "../../types.js";
import type { CommandHandler } from "../command-registry/commandHandler.js";

import { errorDetail } from "../../shared/errors.js";

type DiscordInteraction = BaseChatInputInteraction & AlwaysReplies & {
  isAutocomplete?: () => boolean;
  respond?: (choices: unknown[]) => Promise<unknown>;
};

type Logger = (level: string, context: string, msg: string, meta?: unknown) => void;

interface RouterContext {
  MessageFlags: { Ephemeral: number };
  logger: Logger;
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

function buildFallbackCommandHandler(target: RouterContext): CommandHandler<DiscordInteraction> {
  const { handleInteraction } = createFallbackInteractionHandler({
    MessageFlags: target.MessageFlags,
    logger: target.logger
  });
  return {
    canHandle: (_interaction): _interaction is DiscordInteraction => true,
    handle: (interaction, games) => handleInteraction(interaction, games)
  };
}

export default { createFallbackInteractionHandler, buildCommandHandler: buildFallbackCommandHandler };
