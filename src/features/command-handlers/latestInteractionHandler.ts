"use strict";

import type { CommandHandler } from "../command-registry/commandHandler";
import { matchesCommand } from "../command-registry/commandMatch";
import type { LatestUpdatesHandlerDeps } from "./latest/latestUpdatesHandler";
import type { LatestDealsHandlerDeps } from "./latest/latestDealsHandler";
import type { LatestSingleHandlerDeps } from "./latest/latestSingleHandler";
import type { PriceSearchHandlerDeps } from "./latest/priceSearchHandler";

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

type LatestContextDeps = LatestUpdatesHandlerDeps
  & LatestDealsHandlerDeps
  & LatestSingleHandlerDeps
  & PriceSearchHandlerDeps;

type LatestContext = LatestContextDeps;

function createLatestInteractionHandler(deps: LatestContextDeps) {
  const latestUpdates = createLatestUpdatesHandler(deps);
  const latestDeals = createLatestDealsHandler(deps);
  const latestSingle = createLatestSingleHandler(deps);
  const priceSearch = createPriceSearchHandler(deps);

  async function handleLatestInteraction(interaction: DiscordInteraction, games: GameConfig[]): Promise<unknown> {
    const sub = interaction.options.getSubcommand();
    if (sub === "updates") return latestUpdates.handleLatestUpdates(interaction, games);
    if (sub === "reduceri") return latestDeals.handleLatestDeals(interaction);
    if (sub === "update") return latestSingle.handleLatestSingle(interaction, games);
    if (sub === "pret") return priceSearch.handlePriceSearch(interaction);
    deps.logger("WARN", "LATEST_COMMAND", `Subcomanda /latest necunoscuta: ${sub}`);
    return interaction.reply({
      content: `Eroare: Subcomanda \`/latest ${sub}\` nu este recunoscuta.`,
      flags: deps.MessageFlags.Ephemeral
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
  return matchesCommand(interaction, { commandNames: ["latest"] });
}

function createInteractionErrorPayload(MessageFlags: { Ephemeral: number }) {
  return {
    content: "Eroare: Eroare neasteptata la procesarea comenzii.",
    flags: MessageFlags.Ephemeral
  };
}

function buildLatestCommandHandler(target: LatestContext) {
  const handlers = createLatestInteractionHandler({
    logger: target.logger,
    enforceCooldown: target.enforceCooldown,
    startCommandLog: target.startCommandLog,
    safeDefer: target.safeDefer,
    safeEdit: target.safeEdit,
    getUpdatesCacheData: target.getUpdatesCacheData,
    setUpdatesCache: target.setUpdatesCache,
    getLatestForAllGames: target.getLatestForAllGames,
    getSystemTimes: target.getSystemTimes,
    saveSystemTime: target.saveSystemTime,
    smoothTime: target.smoothTime,
    getGuildSettings: target.getGuildSettings,
    formatUserError: target.formatUserError,
    buildUpdateEmbed: target.buildUpdateEmbed,
    handlePagination: target.handlePagination,
    ITEMS_PER_PAGE: target.ITEMS_PER_PAGE,
    getDealsCacheData: target.getDealsCacheData,
    setDealsCache: target.setDealsCache,
    fetchDeals: target.fetchDeals,
    loadFetchSnapshot: target.loadFetchSnapshot,
    validatePendingDiscountSnapshot: target.validatePendingDiscountSnapshot,
    validateUpdateFetchSnapshot: target.validateUpdateFetchSnapshot,
    enrichDealData: target.enrichDealData,
    dealPassesFilters: target.dealPassesFilters,
    buildDealEmbed: target.buildDealEmbed,
    DEFAULT_CURRENCY: target.DEFAULT_CURRENCY,
    MAX_DEALS: target.MAX_DEALS,
    findGameAndSuggestion: target.findGameAndSuggestion,
    executeFetchWithCircuitBreaker: target.executeFetchWithCircuitBreaker,
    cache: target.cache,
    cacheGetLRU: target.cacheGetLRU,
    cacheSetLRU: target.cacheSetLRU,
    CACHE_TTL_MS: target.CACHE_TTL_MS,
    SINGLE_CACHE_MAX_SIZE: target.SINGLE_CACHE_MAX_SIZE,
    MessageFlags: target.MessageFlags,
    searchSteamGameByName: target.searchSteamGameByName,
    chooseBestSteamMatch: target.chooseBestSteamMatch,
    fetchSteamPriceDetails: target.fetchSteamPriceDetails,
    extractSteamOfferEndDate: target.extractSteamOfferEndDate,
    buildSteamPriceEmbed: target.buildSteamPriceEmbed
  });

  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => isLatestCommand(interaction as DiscordInteraction),
    handle: async (interaction, games) => {
      const di = interaction;
      try {
        return await handlers.handleLatestInteraction(di, games);
      } catch (err: unknown) {
        target.logger?.("ERROR", "LATEST_INTERACTION", "Eroare in handler-ul /latest", errorDetail(err));
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

export = { createLatestInteractionHandler, buildCommandHandler: buildLatestCommandHandler };
