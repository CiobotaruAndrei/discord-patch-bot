"use strict";

import type {
  AlwaysFollowsUp,
  AlwaysReplies,
  BaseChatInputInteraction
} from "./discordInteractionPorts.js";
import type { LoggerFunction } from "../../types.js";
import type { CommandHandler } from "../command-registry/commandHandler.js";

import { errorDetail } from "../../shared/errors.js";

type MaybePromise<T> = T | Promise<T>;
type GameConfig = { key: string; name: string; aliases?: string[] } & Record<string, unknown>;
type DiscordInteraction = BaseChatInputInteraction & AlwaysReplies & AlwaysFollowsUp;
type NextInteractionHandler = (interaction: DiscordInteraction, games: GameConfig[]) => MaybePromise<unknown>;

type SimpleCommandsDeps = {
  COMMAND_OUTPUT_MAX_CHARS: number;
};

type SimpleCommandsContext = SimpleCommandsDeps & {
  MessageFlags: { Ephemeral: number };
  logger?: LoggerFunction;
};

function createSimpleCommandsHandler(deps: SimpleCommandsDeps) {
  const { COMMAND_OUTPUT_MAX_CHARS } = deps;

  async function handlePingInteraction(interaction: DiscordInteraction) {
    return interaction.reply("Pong!");
  }

  async function handleGamesInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    if (!games.length) return interaction.reply("Nu sunt jocuri configurate.");
    const maxLineLength = Math.max(1, COMMAND_OUTPUT_MAX_CHARS - 40);
    const segmentLine = (line: string): string[] => {
      if (line.length <= maxLineLength) return [line];
      const segments: string[] = [];
      for (let offset = 0; offset < line.length; offset += maxLineLength) segments.push(line.slice(offset, offset + maxLineLength));
      return segments;
    };
    const lines = games.flatMap(g => {
      let item = `- **${g.name}** (\`${g.key}\`)`;
      if (g.aliases && g.aliases.length > 0) item += ` *[Alias: ${g.aliases.join(", ")}]*`;
      return segmentLine(item);
    });
    let currentMsg = "**Jocuri urmarite:**\n";
    const messages: string[] = [];
    for (const line of lines) {
      if (currentMsg.length + line.length > COMMAND_OUTPUT_MAX_CHARS) {
        messages.push(currentMsg);
        currentMsg = "";
      }
      currentMsg += line + "\n";
    }
    if (currentMsg.trim()) messages.push(currentMsg);
    if (!messages.length) return interaction.reply("Nu sunt jocuri configurate.");
    await interaction.reply(messages[0]);
    for (let i = 1; i < messages.length; i++) await interaction.followUp(messages[i]).catch(() => null);
  }

  return { handlePingInteraction, handleGamesInteraction };
}

function isSimpleCommand(interaction: DiscordInteraction): boolean {
  if (interaction?.isChatInputCommand?.() !== true) return false;
  if (!interaction.guild) return false;
  return interaction.commandName === "ping" || interaction.commandName === "games";
}

function createInteractionErrorPayload(MessageFlags: { Ephemeral: number }) {
  return {
    content: "Eroare: Eroare neasteptata la procesarea comenzii.",
    flags: MessageFlags.Ephemeral
  };
}

function buildSimpleCommandsCommandHandler(target: SimpleCommandsContext) {
  const handlers = createSimpleCommandsHandler({
    COMMAND_OUTPUT_MAX_CHARS: target.COMMAND_OUTPUT_MAX_CHARS
  });
  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => isSimpleCommand(interaction as DiscordInteraction),
    handle: async (interaction, games) => {
      const di = interaction;
      try {
        if (di.commandName === "ping") return await handlers.handlePingInteraction(di);
        return await handlers.handleGamesInteraction(di, games);
      } catch (err: unknown) {
        target.logger?.("ERROR", "SIMPLE_COMMAND", "Eroare in /ping sau /games", errorDetail(err));
        const payload = createInteractionErrorPayload(target.MessageFlags);
        try {
          if ((di.deferred || di.replied) && typeof di.followUp === "function") {
            await di.followUp(payload);
          } else {
            await di.reply(payload);
          }
        } catch {  }
        return undefined;
      }
    }
  };
  return { handlers, ...command };
}

export default { createSimpleCommandsHandler, buildCommandHandler: buildSimpleCommandsCommandHandler };
