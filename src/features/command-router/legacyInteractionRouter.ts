"use strict";

/**
 * V12: bottom-of-chain fallback pentru `handleInteraction`.
 *
 * Inainte: fisierul asta avea ~950 linii cu intregul dispatch /ping, /games,
 * /help, /start, /stop, /set, /latest, /dlc, /status + autocomplete +
 * buildHelpEmbed + ~30 deps destructurate din ctx. Toate cele 11 handlers
 * substantiale au fost extrase in module dedicate cu deps tipate explicit
 * (vezi `src/features/command-handlers/*`).
 *
 * Ce ramane aici: doar bottom-of-chain pentru handleInteraction — wrappers-ii
 * de mai sus (helpInteractionHandler, subscriptionNotificationHandlers,
 * gameFilterHandlers, rolePingHandlers, setInteractionHandler,
 * latestInteractionHandler, statusInteractionHandler, dlcInteractionHandler,
 * autocompleteInteractionHandler, simpleCommandsHandler, adminCommandRouterGuard)
 * intercepteaza fiecare comanda cunoscuta inainte sa ajunga aici. Ce ramane in
 * acest fisier ruleaza DOAR pentru:
 * - comenzi necunoscute (typo in slash schema, drift intre client si server)
 * - non-chat-input fara handler (rar, mostly defense in depth)
 * - lipsa contextului de guild (DM nu este suportat)
 *
 * Filename retinut pentru continuitate git history. Daca scoatem si dispatcher-ul
 * intr-un viitor PR, fisierul devine 0 linii si se poate sterge.
 */

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

type Logger = (level: string, ctx: string, msg: string, meta?: unknown) => void;

interface RouterContext {
  MessageFlags: { Ephemeral: number };
  logger: Logger;
  handleInteraction?: (interaction: DiscordInteraction, games: unknown[]) => Promise<unknown>;
}

module.exports = (ctx: RouterContext) => {
  const { MessageFlags, logger } = ctx;

  async function handleInteraction(interaction: DiscordInteraction, _games: unknown[]) {
    try {
      // V12: defense in depth — autocomplete-ul ar trebui interceptat de
      // `autocompleteInteractionHandler` inainte sa ajunga aici. Daca totusi
      // ajunge (e.g. handler dezactivat in testing), raspundem cu array gol ca
      // Discord sa nu astepte 3s.
      if (typeof interaction.isAutocomplete === "function" && interaction.isAutocomplete()) {
        if (typeof interaction.respond === "function") {
          await interaction.respond([]).catch(() => null);
        }
        return;
      }
      // Non-chat-input (e.g. context menus pe care nu le suportam): ignoram
      // silentios — Discord va arata "interaction failed" dupa 3s daca
      // utilizatorul a invocat ceva nesuportat, dar nu polluam logs.
      if (typeof interaction.isChatInputCommand !== "function" || !interaction.isChatInputCommand()) {
        return;
      }
      if (!interaction.guild) {
        return interaction.reply({
          content: "Comenzile sunt disponibile doar pe servere.",
          flags: MessageFlags.Ephemeral
        }).catch(() => null);
      }
      // Ajungem aici doar pentru comenzi NECUNOSCUTE — toate cele live (ping,
      // games, help, start, stop, set, latest, dlc, status) au handler dedicat
      // care intercepteaza in chain inainte sa cada pe noi.
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
      } catch { /* ignore */ }
    }
  }

  Object.assign(ctx, { handleInteraction });
};
