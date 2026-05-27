"use strict";

/**
 * V12: dispatcher pentru `/latest *` — REDUS la 80 linii dupa splitting.
 *
 * Inainte (V12 generatia 1): un singur fisier de ~390 linii cu cele 4
 * sub-handlers in interior si o interfata gigantica `LatestHandlerDeps` cu
 * ~40 deps. Plangerea explicita din review (punctul 2 din screenshot recent):
 * "latestInteractionHandler are multe dependinte; l-as sparge in
 * latestUpdatesHandler, latestDealsHandler, latestSingleHandler,
 * priceSearchHandler".
 *
 * Acum: cele 4 sub-handlers traiesc in `./latest/` cu deps tipate per sub
 * (~12-14 deps fiecare in loc de 40 partajate). Acest fisier doar:
 * 1. Construieste 4 sub-handlers prin factory-uri.
 * 2. Routeaza pe sub-comanda cu guard pentru sub necunoscut.
 * 3. Installer wraps `ctx.handleInteraction` pentru chain pattern.
 */

const { errorDetail } = require("../../shared/errors");
const { createLatestUpdatesHandler } = require("./latest/latestUpdatesHandler");
const { createLatestDealsHandler } = require("./latest/latestDealsHandler");
const { createLatestSingleHandler } = require("./latest/latestSingleHandler");
const { createPriceSearchHandler } = require("./latest/priceSearchHandler");

type MaybePromise<T> = T | Promise<T>;
type GameConfig = { key: string; name: string } & Record<string, unknown>;
type DiscordInteraction = {
  commandName?: string;
  guild?: { id: string } | null;
  deferred?: boolean;
  replied?: boolean;
  isChatInputCommand?: () => boolean;
  reply: (payload: unknown) => Promise<unknown>;
  followUp?: (payload: unknown) => Promise<unknown>;
  options: { getSubcommand(): string };
};
type NextInteractionHandler = (interaction: DiscordInteraction, games: GameConfig[]) => MaybePromise<unknown>;

type Logger = (level: string, ctx: string, msg: string, meta?: unknown) => void;

// Interfata uniunii — install layer-ul accepta deps-urile combinate ale celor 4
// sub-handlers si distribuie. Userii care vor sa construiasca DOAR un sub-handler
// pot importa direct factory-ul lui din `./latest/*`.
type LatestContextDeps = Record<string, unknown> & {
  logger: Logger;
  MessageFlags: { Ephemeral: number };
};

type LatestContext = LatestContextDeps & { handleInteraction?: NextInteractionHandler };

function createLatestInteractionHandler(ctx: LatestContextDeps) {
  const latestUpdates = createLatestUpdatesHandler(ctx);
  const latestDeals = createLatestDealsHandler(ctx);
  const latestSingle = createLatestSingleHandler(ctx);
  const priceSearch = createPriceSearchHandler(ctx);

  async function handleLatestInteraction(interaction: DiscordInteraction, games: GameConfig[]): Promise<unknown> {
    const sub = interaction.options.getSubcommand();
    if (sub === "updates") return latestUpdates.handleLatestUpdates(interaction, games);
    if (sub === "reduceri") return latestDeals.handleLatestDeals(interaction);
    if (sub === "update") return latestSingle.handleLatestSingle(interaction, games);
    if (sub === "pret") return priceSearch.handlePriceSearch(interaction);
    // V11: defensive guard pentru sub necunoscut. Daca un nou sub e adaugat in
    // slashCommandDefinitions.ts fara dispatch aici, user-ul vedea "interaction
    // failed" dupa 3s. Acum reply explicit.
    ctx.logger("WARN", "LATEST_COMMAND", `Subcomanda /latest necunoscuta: ${sub}`);
    return interaction.reply({
      content: `Eroare: Subcomanda \`/latest ${sub}\` nu este recunoscuta.`,
      flags: ctx.MessageFlags.Ephemeral
    }).catch(() => null);
  }

  return {
    handleLatestInteraction,
    handleLatestUpdatesInteraction: latestUpdates.handleLatestUpdates,
    handleLatestDealsInteraction: latestDeals.handleLatestDeals,
    handleLatestSingleInteraction: latestSingle.handleLatestSingle,
    handleLatestPriceInteraction: priceSearch.handlePriceSearch
  };
}

function isLatestCommand(interaction: DiscordInteraction): boolean {
  return interaction?.isChatInputCommand?.() === true
    && Boolean(interaction.guild)
    && interaction.commandName === "latest";
}

function createInteractionErrorPayload(MessageFlags: { Ephemeral: number }) {
  return {
    content: "Eroare: Eroare neasteptata la procesarea comenzii.",
    flags: MessageFlags.Ephemeral
  };
}

function installLatestInteractionHandler(ctx: LatestContext) {
  const previousHandleInteraction = ctx.handleInteraction;
  const handlers = createLatestInteractionHandler(ctx);

  async function handleInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    if (!isLatestCommand(interaction)) {
      if (typeof previousHandleInteraction === "function") return previousHandleInteraction(interaction, games);
      return undefined;
    }
    try {
      return await handlers.handleLatestInteraction(interaction, games);
    } catch (err: unknown) {
      ctx.logger?.("ERROR", "LATEST_INTERACTION", "Eroare in handler-ul /latest", errorDetail(err));
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

Object.assign(installLatestInteractionHandler, { createLatestInteractionHandler });

export = installLatestInteractionHandler;
