"use strict";

import type {
  AlwaysReplies,
  BaseChatInputInteraction,
  StringOption
} from "./discordInteractionPorts.js";
import type { LoggerFunction } from "../../types.js";
import type { CommandHandler } from "../command-registry/commandHandler.js";
import { matchesCommand } from "../command-registry/commandMatch.js";

import { errorDetail } from "../../shared/errors.js";
import {
  findCommandHelpEntry,
  renderCommandHelpEntry
} from "../command-help/commandHelpCatalog.js";

type MaybePromise<T> = T | Promise<T>;
type GameConfig = { key: string; name: string } & Record<string, unknown>;
type DiscordInteraction = BaseChatInputInteraction & AlwaysReplies & { options?: StringOption };
type NextInteractionHandler = (interaction: DiscordInteraction, games: GameConfig[]) => MaybePromise<unknown>;

export type HelpEmbed = object;

type EmbedBuilderInstance = {
  setColor(color: number): EmbedBuilderInstance;
  setTitle(title: string): EmbedBuilderInstance;
  setDescription(desc: string): EmbedBuilderInstance;
  addFields(...fields: Array<{ name: string; value: string }>): EmbedBuilderInstance;
};
type EmbedBuilderCtor = new () => EmbedBuilderInstance;

type HelpHandlerDeps = {
  buildHelpEmbed: () => HelpEmbed;
  MessageFlags?: { Ephemeral: number };
  findCommandHelpEntry?: typeof findCommandHelpEntry;
  renderCommandHelpEntry?: typeof renderCommandHelpEntry;
};

type HelpContext = {
  buildHelpEmbed?: () => HelpEmbed;
  EmbedBuilder?: EmbedBuilderCtor;
  COLORS?: { DARK: number } & Record<string, number>;
  MessageFlags: { Ephemeral: number };
  logger?: LoggerFunction;
};

function buildHelpEmbedFromDeps(EmbedBuilder: EmbedBuilderCtor, COLORS: { DARK: number }) {
  return new EmbedBuilder()
    .setColor(COLORS.DARK)
    .setTitle("Meniul de Ajutor - Big Master")
    .setDescription("Toate comenzile sunt slash commands. Incepe cu `/` pentru autocomplete.")
    .addFields(
      { name: "Utilitare", value: "`/ping` - `/games` - `/help`" },
      { name: "Ajutor pe comanda", value: "`/help command:<comanda>` - explicatie detaliata pentru o comanda exacta" },
      { name: "Notificari Automate (admin)", value: "`/start updates` - `/stop updates`\n`/start reduceri` - `/stop reduceri`" },
      { name: "Pauza temporara (admin)", value: "`/snooze command:<comanda> durata:<timp>`\n`/unsnooze command:<comanda>`" },
      {
        name: "Preferinte Server (admin)",
        value:
          "`/set mode <compact|detailed>`\n" +
          "`/set mindiscount <0-100>`\n" +
          "`/set maxprice <0-10000>` *(0 = fara limita)*\n" +
          "`/set free <on|off>` - `/set paid <on|off>`\n" +
          "`/set currency <USD|EUR|GBP|RON>`\n" +
          "`/set stores <steam,epic | reset>`\n" +
          "`/config`\n" +
          "`/reset-config confirm:true`\n" +
          "`/template set|reset|status`"
      },
      {
        name: "Alerte dedicate (admin)",
        value:
          "`/add price-alert <joc> <price> <currency>`\n" +
          "`/remove price-alert <joc>` - `/price-alert list`\n" +
          "`/admin-alerts set <channel>` - `/admin-alerts off`"
      },
      {
        name: "YouTube (admin)",
        value:
          "`/youtube subscribe <canal>` - `/youtube unsubscribe <canal>`\n" +
          "`/youtube list` - `/youtube notify channel <canal>`\n" +
          "`/youtube notify on|off|status`\n" +
          "`/youtube filter shorts|lives|premieres <on|off>`\n" +
          "`/youtube filter min-duration <secunde>` - `/youtube filter status`\n" +
          "`/youtube status` - `/youtube clear-errors`"
      },
      {
        name: "Filtru per-joc (admin)",
        value:
          "`/watchlist show` - `/watchlist reset` - `/watchlist coverage`\n" +
          "`/add watchlist <joc>` - `/remove watchlist <joc>`\n" +
          "`/set add games <joc>` - `/set remove games <joc>`\n" +
          "`/game-alias add|remove|list`"
      },
      {
        name: "Ping-uri rol (admin)",
        value:
          "`/set role updates <rol>` *(gol = oprit)*\n" +
          "`/set role discounts <rol>` *(gol = oprit)*"
      },
      {
        name: "Comenzi Manuale",
        value: "`/latest updates` - `/latest reduceri`\n`/latest update <joc>` - `/latest pret <joc>`\n`/game overview <joc>` - `/status game <joc>` - `/status watchlist`\n`/player-count trend|milestone|gainers|peak-time`\n`/dlc <joc>` - `/sources status`"
      },
      {
        name: "Raportare",
        value: "`/report bug` - `/report complaint`\n`/report list bugs|users` - `/report remove bug|user` *(admin)*"
      }
    );
}

function commandHelpPayload(content: string, MessageFlags?: { Ephemeral: number }) {
  if (!MessageFlags) return { content };
  return { content, flags: MessageFlags.Ephemeral };
}

function readRequestedCommand(interaction: DiscordInteraction): string | null {
  const value = interaction.options?.getString("command", false);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function createHelpHandler(deps: HelpHandlerDeps) {
  async function handleHelpInteraction(interaction: DiscordInteraction) {
    const requestedCommand = readRequestedCommand(interaction);
    if (requestedCommand) {
      const findEntry = deps.findCommandHelpEntry || findCommandHelpEntry;
      const renderEntry = deps.renderCommandHelpEntry || renderCommandHelpEntry;
      const entry = findEntry(requestedCommand);
      if (!entry) {
        return interaction.reply(commandHelpPayload(`Eroare: Nu am gasit comanda \`${requestedCommand}\`. Alege o comanda din autocomplete la \`/help command:\`.`, deps.MessageFlags));
      }
      return interaction.reply(commandHelpPayload(renderEntry(entry), deps.MessageFlags));
    }
    return interaction.reply({ embeds: [deps.buildHelpEmbed()] });
  }

  return { handleHelpInteraction };
}

function isHelpCommand(interaction: DiscordInteraction): boolean {
  return matchesCommand(interaction, { commandNames: ["help"] });
}

function createInteractionErrorPayload(MessageFlags: { Ephemeral: number }) {
  return {
    content: "Eroare: Eroare neasteptata la procesarea comenzii.",
    flags: MessageFlags.Ephemeral
  };
}

function resolveHelpEmbedBuilder(target: HelpContext): () => HelpEmbed {
  if (typeof target.buildHelpEmbed === "function") return target.buildHelpEmbed;
  if (!target.EmbedBuilder || !target.COLORS) {
    throw new Error("helpInteractionHandler: needs either buildHelpEmbed or EmbedBuilder plus COLORS");
  }
  const EmbedBuilder = target.EmbedBuilder;
  const COLORS = target.COLORS;
  return () => buildHelpEmbedFromDeps(EmbedBuilder, COLORS);
}

function buildHelpCommandHandler(target: HelpContext): CommandHandler<DiscordInteraction> & { buildHelpEmbed: () => HelpEmbed } {
  const resolvedBuildHelpEmbed = resolveHelpEmbedBuilder(target);
  const handlers = createHelpHandler({ buildHelpEmbed: resolvedBuildHelpEmbed, MessageFlags: target.MessageFlags });
  return {
    canHandle: (interaction): interaction is DiscordInteraction => isHelpCommand(interaction as DiscordInteraction),
    handle: async (interaction) => {
      const di = interaction;
      try {
        return await handlers.handleHelpInteraction(di);
      } catch (err: unknown) {
        target.logger?.("ERROR", "HELP_INTERACTION", "Eroare in handler-ul /help", errorDetail(err));
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
    },
    buildHelpEmbed: resolvedBuildHelpEmbed
  };
}

export default { createHelpHandler, buildHelpEmbed: buildHelpEmbedFromDeps, buildCommandHandler: buildHelpCommandHandler };
