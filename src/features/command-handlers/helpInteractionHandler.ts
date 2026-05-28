"use strict";

const { errorDetail } = require("../../shared/errors");

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

type EmbedBuilderInstance = {
  setColor(color: number): EmbedBuilderInstance;
  setTitle(title: string): EmbedBuilderInstance;
  setDescription(desc: string): EmbedBuilderInstance;
  addFields(...fields: Array<{ name: string; value: string }>): EmbedBuilderInstance;
};
type EmbedBuilderCtor = new () => EmbedBuilderInstance;

type HelpHandlerDeps = {
  buildHelpEmbed: () => unknown;
};

type HelpContext = {
  buildHelpEmbed?: () => unknown;
  EmbedBuilder?: EmbedBuilderCtor;
  COLORS?: { DARK: number } & Record<string, number>;
  MessageFlags: { Ephemeral: number };
  logger?: (...args: unknown[]) => void;
  handleInteraction?: NextInteractionHandler;
};

function buildHelpEmbedFromDeps(EmbedBuilder: EmbedBuilderCtor, COLORS: { DARK: number }) {
  return new EmbedBuilder()
    .setColor(COLORS.DARK)
    .setTitle("Meniul de Ajutor - Big Master")
    .setDescription("Toate comenzile sunt slash commands. Incepe cu `/` pentru autocomplete.")
    .addFields(
      { name: "Utilitare", value: "`/ping` - `/games` - `/help`" },
      { name: "Notificari Automate (admin)", value: "`/start updates` - `/stop updates`\n`/start reduceri` - `/stop reduceri`" },
      {
        name: "Preferinte Server (admin)",
        value:
          "`/set mode <compact|detailed>`\n" +
          "`/set mindiscount <0-100>`\n" +
          "`/set maxprice <0-10000>` *(0 = fara limita)*\n" +
          "`/set free <on|off>` - `/set paid <on|off>`\n" +
          "`/set currency <USD|EUR|GBP|RON>`\n" +
          "`/set stores <steam,epic | reset>`"
      },
      {
        name: "Filtru per-joc (admin)",
        value:
          "`/set games add <joc>` - `/set games remove <joc>`\n" +
          "`/set games list` - `/set games reset`"
      },
      {
        name: "Ping-uri rol (admin)",
        value:
          "`/set role updates <rol>` *(gol = oprit)*\n" +
          "`/set role discounts <rol>` *(gol = oprit)*"
      },
      {
        name: "Comenzi Manuale",
        value: "`/latest updates` - `/latest reduceri`\n`/latest update <joc>` - `/latest pret <joc>`\n`/dlc <joc>` - `/status <joc>`"
      }
    );
}

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
  let resolvedBuildHelpEmbed = ctx.buildHelpEmbed;
  if (typeof resolvedBuildHelpEmbed !== "function") {
    if (!ctx.EmbedBuilder || !ctx.COLORS) {
      throw new Error("helpInteractionHandler: needs either ctx.buildHelpEmbed or (ctx.EmbedBuilder + ctx.COLORS)");
    }
    const EmbedBuilder = ctx.EmbedBuilder;
    const COLORS = ctx.COLORS;
    resolvedBuildHelpEmbed = () => buildHelpEmbedFromDeps(EmbedBuilder, COLORS);
  }
  const handlers = createHelpHandler({ buildHelpEmbed: resolvedBuildHelpEmbed });

  async function handleInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    if (!isHelpCommand(interaction)) {
      if (typeof previousHandleInteraction === "function") return previousHandleInteraction(interaction, games);
      return undefined;
    }

    try {
      return await handlers.handleHelpInteraction(interaction);
    } catch (err: unknown) {
      ctx.logger?.("ERROR", "HELP_INTERACTION", "Eroare in handler-ul /help", errorDetail(err));
      const payload = createInteractionErrorPayload(ctx.MessageFlags);
      try {
        if ((interaction.deferred || interaction.replied) && typeof interaction.followUp === "function") {
          await interaction.followUp(payload);
        } else {
          await interaction.reply(payload);
        }
      } catch {  }
      return undefined;
    }
  }

  Object.assign(ctx, handlers, { handleInteraction, buildHelpEmbed: resolvedBuildHelpEmbed });
}

Object.assign(installHelpHandler, { createHelpHandler, buildHelpEmbed: buildHelpEmbedFromDeps });

export = installHelpHandler;
