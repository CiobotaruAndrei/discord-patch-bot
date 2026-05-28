"use strict";

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
      } catch {  }
      return undefined;
    }
  }

  Object.assign(ctx, handlers, { handleInteraction });
}

Object.assign(installLatestInteractionHandler, { createLatestInteractionHandler });

export = installLatestInteractionHandler;
