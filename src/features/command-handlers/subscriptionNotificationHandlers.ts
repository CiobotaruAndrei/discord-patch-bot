"use strict";

import type { GameConfig } from "../../types";
import type { CommandHandler } from "../command-registry/commandHandler";
import type { SubscriptionContext, SubscriptionInteraction, SubscriptionInteractionDeps } from "./subscriptionCommandContracts";
import { createStartStopHandlers } from "./startStopCommandFactory";
import { createUpdatesSubscriptionFamily } from "./updatesSubscriptionFamily";
import { createDiscountsSubscriptionFamily } from "./discountsSubscriptionFamily";
import { createDlcSubscriptionFamily } from "./dlcSubscriptionFamily";
import { createPlayerCountSubscriptionFamily } from "./playerCountSubscriptionFamily";

const { errorDetail } = require("../../shared/errors");

function createSubscriptionInteractionHandlers(deps: SubscriptionInteractionDeps) {
  const families = {
    updates: createUpdatesSubscriptionFamily(deps),
    reduceri: createDiscountsSubscriptionFamily(deps),
    dlc: createDlcSubscriptionFamily(deps),
    "player-count": createPlayerCountSubscriptionFamily(deps)
  };
  return createStartStopHandlers(deps, families);
}

function isSubscriptionCommand(interaction: SubscriptionInteraction) {
  return interaction?.isChatInputCommand?.() === true
    && interaction.guild
    && (interaction.commandName === "start" || interaction.commandName === "stop");
}

function createInteractionErrorPayload(MessageFlags: { Ephemeral: number }) {
  return {
    content: "Eroare: Eroare neasteptata la procesarea comenzii.",
    flags: MessageFlags.Ephemeral
  };
}

function buildSubscriptionCommandHandler(target: SubscriptionContext) {
  const handlers = createSubscriptionInteractionHandlers({
    GuildModel: target.GuildModel,
    logger: target.logger,
    getGuildSettings: target.getGuildSettings,
    invalidateGuildCache: target.invalidateGuildCache,
    DEFAULT_CURRENCY: target.DEFAULT_CURRENCY,
    getLatestForAllGames: target.getLatestForAllGames,
    fetchDeals: target.fetchDeals,
    dealHash: target.dealHash,
    seedSeenUpdates: target.seedSeenUpdates,
    seedSeenDiscounts: target.seedSeenDiscounts,
    DEALS_HISTORY_LIMIT: target.DEALS_HISTORY_LIMIT,
    OP_UPDATE_OPTS: target.OP_UPDATE_OPTS,
    setDealsCache: target.setDealsCache,
    safeDefer: target.safeDefer,
    safeEdit: target.safeEdit,
    canSendEmbeds: target.canSendEmbeds,
    listMissingChannelPerms: target.listMissingChannelPerms,
    missingChannelPermsMessage: target.missingChannelPermsMessage,
    makeActivationId: target.makeActivationId,
    formatUserError: target.formatUserError
  });

  const command: CommandHandler<SubscriptionInteraction> = {
    canHandle: (interaction): interaction is SubscriptionInteraction => Boolean(isSubscriptionCommand(interaction as SubscriptionInteraction)),
    handle: async (interaction, games) => {
      const di = interaction;
      try {
        if (di.commandName === "start") return await handlers.handleStartInteraction(di, games);
        return await handlers.handleStopInteraction(di, games);
      } catch (err: unknown) {
        target.logger?.("ERROR", "SUBSCRIPTION_INTERACTION", "Eroare in handler-ul de start/stop", errorDetail(err));
        const payload = createInteractionErrorPayload(target.MessageFlags);
        try {
          if ((di.deferred || di.replied) && typeof di.followUp === "function") await di.followUp(payload);
          else if (typeof di.reply === "function") await di.reply(payload);
        } catch {  }
        return undefined;
      }
    }
  };
  return { handlers, ...command };
}

function installSubscriptionInteractions(target: SubscriptionContext) {
  const previousHandleInteraction = target.handleInteraction;
  const { handlers, canHandle, handle } = buildSubscriptionCommandHandler(target);

  async function handleInteraction(interaction: SubscriptionInteraction, games: GameConfig[]) {
    if (!canHandle(interaction)) {
      if (typeof previousHandleInteraction === "function") return previousHandleInteraction(interaction, games);
      return undefined;
    }
    return handle(interaction, games);
  }

  Object.assign(target, handlers, { handleInteraction });
}

export = Object.assign(installSubscriptionInteractions, { createSubscriptionInteractionHandlers, buildCommandHandler: buildSubscriptionCommandHandler });
