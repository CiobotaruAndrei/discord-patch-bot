"use strict";

const { errorDetail } = require("../../../shared/errors");

type MaybePromise<T> = T | Promise<T>;
type GameConfig = { key: string } & Record<string, unknown>;
type DiscordInteraction = {
  commandName?: string;
  guild?: unknown;
  deferred?: boolean;
  replied?: boolean;
  isChatInputCommand?: () => boolean;
  reply: (payload: unknown) => Promise<unknown>;
  followUp?: (payload: unknown) => Promise<unknown>;
};
type NextInteractionHandler = (interaction: DiscordInteraction, games: GameConfig[]) => MaybePromise<unknown>;

type HelpHandlerDeps = {
  buildHelpEmbed: () => unknown;
};

type HelpContext = HelpHandlerDeps & {
  MessageFlags: { Ephemeral: number };
  logger?: (...args: unknown[]) => void;
  handleInteraction?: NextInteractionHandler;
};

function createHelpHandler(deps: HelpHandlerDeps) {
  async function handleHelpInteraction(interaction: DiscordInteraction) {
    return interaction.reply({ embeds: [deps.buildHelpEmbed()] });
  }

  return { handleHelpInteraction };
}

function isHelpCommand(interaction: DiscordInteraction): boolean {
  return interaction?.isChatInputCommand?.() === true
    && Boolean(interaction.guild)
    && interaction.commandName === "help";
}

function createInteractionErrorPayload(MessageFlags: { Ephemeral: number }) {
  return {
    content: "Eroare: Eroare neasteptata la procesarea comenzii.",
    flags: MessageFlags.Ephemeral
  };
}

function installHelpHandler(ctx: HelpContext) {
  const previousHandleInteraction = ctx.handleInteraction;
  const handlers = createHelpHandler(ctx);

  async function handleInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    if (!isHelpCommand(interaction)) {
      if (typeof previousHandleInteraction === "function") return previousHandleInteraction(interaction, games);
      return undefined;
    }

    try {
      return handlers.handleHelpInteraction(interaction);
    } catch (err: unknown) {
      ctx.logger?.("ERROR", "HELP_INTERACTION", "Eroare in handler-ul /help", errorDetail(err));
      const payload = createInteractionErrorPayload(ctx.MessageFlags);
      try {
        if ((interaction.deferred || interaction.replied) && typeof interaction.followUp === "function") {
          await interaction.followUp(payload);
        } else {
          await interaction.reply(payload);
        }
      } catch { /* ignore */ }
      return undefined;
    }
  }

  Object.assign(ctx, handlers, { handleInteraction });
}

Object.assign(installHelpHandler, { createHelpHandler });

export = installHelpHandler;
