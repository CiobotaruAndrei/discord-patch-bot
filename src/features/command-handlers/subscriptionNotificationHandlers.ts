"use strict";

import type { GameConfig } from "../../config/configTypes.js";
import type { CommandHandler } from "../command-registry/commandHandler.js";
import type { SubscriptionContext, SubscriptionInteraction, SubscriptionInteractionDeps } from "./subscriptionCommandContracts.js";
import { createStartStopHandlers } from "./startStopCommandFactory.js";
import { createUpdatesSubscriptionFamily } from "./updatesSubscriptionFamily.js";
import { createDiscountsSubscriptionFamily } from "./discountsSubscriptionFamily.js";
import { createDlcSubscriptionFamily } from "./dlcSubscriptionFamily.js";
import { createPlayerCountSubscriptionFamily } from "./playerCountSubscriptionFamily.js";

import { errorDetail } from "../../shared/errors.js";
import type { MissingDependencyKeys, ExtraDependencyKeys, ExactDependencyKeys } from "../../shared/dependencyKeyContract.js";
import { START_STOP_TOGGLE_FIELDS } from "../command-security/securityCommandFields.js";

function createSubscriptionInteractionHandlers(deps: SubscriptionInteractionDeps) {
  const families = {
    updates: createUpdatesSubscriptionFamily(deps),
    reduceri: createDiscountsSubscriptionFamily(deps),
    dlc: createDlcSubscriptionFamily(deps),
    "player-count": createPlayerCountSubscriptionFamily(deps)
  };
  return createStartStopHandlers(deps, families);
}

export function isSubscriptionStartStop(interaction: SubscriptionInteraction): boolean {
  if (interaction?.isChatInputCommand?.() !== true || !interaction.guild) return false;
  if (interaction.commandName !== "start" && interaction.commandName !== "stop") return false;
  return !Object.hasOwn(START_STOP_TOGGLE_FIELDS, interaction.options.getSubcommand());
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
    DEFAULT_CURRENCY: target.DEFAULT_CURRENCY,
    getLatestForAllGames: target.getLatestForAllGames,
    fetchDeals: target.fetchDeals,
    dealHash: target.dealHash,
    seedSeenUpdates: target.seedSeenUpdates,
    seedSeenDiscounts: target.seedSeenDiscounts,
    seedBaselineDlc: target.seedBaselineDlc,
    fetchSteamCurrentPlayers: target.fetchSteamCurrentPlayers,
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
    canHandle: (interaction): interaction is SubscriptionInteraction => isSubscriptionStartStop(interaction as SubscriptionInteraction),
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

export default { createSubscriptionInteractionHandlers, buildCommandHandler: buildSubscriptionCommandHandler };

export const SUBSCRIPTION_HANDLER_KEYS = [
  "DEALS_HISTORY_LIMIT",
  "DEFAULT_CURRENCY",
  "GuildModel",
  "MessageFlags",
  "OP_UPDATE_OPTS",
  "canSendEmbeds",
  "dealHash",
  "fetchDeals",
  "fetchSteamCurrentPlayers",
  "formatUserError",
  "getGuildSettings",
  "getLatestForAllGames",
  "listMissingChannelPerms",
  "logger",
  "makeActivationId",
  "missingChannelPermsMessage",
  "safeDefer",
  "safeEdit",
  "seedBaselineDlc",
  "seedSeenDiscounts",
  "seedSeenUpdates",
  "setDealsCache"
] as const;

type SubscriptionKeyCheckDeps = Parameters<typeof buildSubscriptionCommandHandler>[0];
type SubscriptionMissing = MissingDependencyKeys<SubscriptionKeyCheckDeps, (typeof SUBSCRIPTION_HANDLER_KEYS)[number] & string>;
type SubscriptionExtra = ExtraDependencyKeys<SubscriptionKeyCheckDeps, (typeof SUBSCRIPTION_HANDLER_KEYS)[number] & string>;
const subscriptionKeysComplete: ExactDependencyKeys<SubscriptionMissing, SubscriptionExtra> = true;
