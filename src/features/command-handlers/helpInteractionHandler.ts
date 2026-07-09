"use strict";

import type { LoggerFunction } from "../../types";
import type { CommandHandler } from "../command-registry/commandHandler";
import { matchesCommand } from "../command-registry/commandMatch";

const { errorDetail } = require("../../shared/errors");
const {
  findCommandHelpEntry,
  renderCommandHelpEntry
} = require("../command-help/commandHelpCatalog") as typeof import("../command-help/commandHelpCatalog");

type MaybePromise<T> = T | Promise<T>;
type GameConfig = { key: string; name: string } & Record<string, unknown>;
type DiscordInteraction = {
  commandName?: string;
  guild?: unknown;
  deferred?: boolean;
  replied?: boolean;
  isChatInputCommand?: () => boolean;
  options?: {
    getString(name: string, required?: boolean): string | null;
  };
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
  MessageFlags?: { Ephemeral: number };
  findCommandHelpEntry?: typeof findCommandHelpEntry;
  renderCommandHelpEntry?: typeof renderCommandHelpEntry;
};

type HelpContext = {
  buildHelpEmbed?: () => unknown;
  EmbedBuilder?: EmbedBuilderCtor;
  COLORS?: { DARK: number } & Record<string, number>;
  MessageFlags: { Ephemeral: number };
  logger?: LoggerFunction;
  handleInteraction?: NextInteractionHandler;
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
          "`/set outbox-recovery-verify <on|off>`"
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
          "`/youtube status` - `/youtube errors` - `/youtube permissions` - `/youtube clear-errors`"
      },
      {
        name: "Filtru per-joc (admin)",
        value:
          "`/watchlist show` - `/watchlist reset`\n" +
          "`/add watchlist <joc>` - `/remove watchlist <joc>`\n" +
          "`/set add games <joc>` - `/set remove games <joc>`"
      },
      {
        name: "Ping-uri rol (admin)",
        value:
          "`/set role updates <rol>` *(gol = oprit)*\n" +
          "`/set role discounts <rol>` *(gol = oprit)*"
      },
      {
        name: "Operare outbox (admin)",
        value:
          "`/outbox status` - `/outbox deadletters`\n" +
          "`/outbox clear-deadletters` - `/outbox replay-deadletters`\n" +
          "`/outbox retry` - `/outbox drain-now`\n" +
          "`/outbox pause` - `/outbox resume`\n" +
          "`/outbox permissions` - `/outbox recovery-verify status`"
      },
      {
        name: "Comenzi Manuale",
        value: "`/latest updates` - `/latest reduceri`\n`/latest update <joc>` - `/latest pret <joc>`\n`/dlc <joc>` - `/status <joc>`\n`/sources status`"
      },
      {
        name: "Raportare",
        value: "`/report submit` - trimite o problema\n`/report list` - `/report resolve` *(admin)*"
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

function resolveHelpEmbedBuilder(target: HelpContext): () => unknown {
  if (typeof target.buildHelpEmbed === "function") return target.buildHelpEmbed;
  if (!target.EmbedBuilder || !target.COLORS) {
    throw new Error("helpInteractionHandler: needs either buildHelpEmbed or EmbedBuilder plus COLORS");
  }
  const EmbedBuilder = target.EmbedBuilder;
  const COLORS = target.COLORS;
  return () => buildHelpEmbedFromDeps(EmbedBuilder, COLORS);
}

function buildHelpCommandHandler(target: HelpContext): CommandHandler<DiscordInteraction> & { buildHelpEmbed: () => unknown } {
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

export = { createHelpHandler, buildHelpEmbed: buildHelpEmbedFromDeps, buildCommandHandler: buildHelpCommandHandler };
