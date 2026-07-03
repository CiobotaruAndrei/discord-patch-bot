"use strict";

import type { GameConfig } from "../../types";
import type { DiscordChannel, SubscriptionFamily, SubscriptionInteraction, SubscriptionInteractionDeps } from "./subscriptionCommandContracts";

const { errorMessage } = require("../../shared/errors");
const { HASH_VERSION } = require("../../native/fuzzy") as { HASH_VERSION: number };

export function createUpdatesSubscriptionFamily(deps: SubscriptionInteractionDeps): SubscriptionFamily {
  const { GuildModel, logger, invalidateGuildCache, getLatestForAllGames, seedSeenUpdates, OP_UPDATE_OPTS, safeEdit, makeActivationId, formatUserError } = deps;

  async function start(interaction: SubscriptionInteraction, guildId: string, channel: DiscordChannel, games: GameConfig[]) {
    try {
      const activationId = makeActivationId();
      await GuildModel.updateOne(
        { _id: guildId },
        {
          $set: {
            subscribed: true,
            notificationChannelId: channel.id,
            updatesInitializing: true,
            updatesActivationId: activationId,
            pendingUpdates: {}
          },
          $unset: { updatesLastError: "" }
        },
        { upsert: true, ...OP_UPDATE_OPTS }
      );
      invalidateGuildCache(guildId);

      try {
        const results = await getLatestForAllGames(games);
        const seedEntries = results
          .filter(result => result.latest)
          .map(result => ({ gameKey: result.game.key, updateId: result.latest!.id }));
        await seedSeenUpdates(guildId, seedEntries);
        const activationResult = await GuildModel.updateOne(
          {
            _id: guildId,
            subscribed: true,
            notificationChannelId: channel.id,
            updatesActivationId: activationId
          },
          {
            $set: { updatesInitializing: false, seenHashVersionUpdates: HASH_VERSION },
            $unset: { updatesActivationId: "", updatesLastError: "" }
          },
          OP_UPDATE_OPTS
        );
        if (activationResult.matchedCount === 0) {
          return safeEdit(interaction, "Activarea update-urilor a fost intrerupta de o comanda stop/start mai noua. Ruleaza din nou /start updates daca mai vrei activarea.");
        }
        return safeEdit(interaction, "OK: Update-uri automate activate.");
      } catch (err: unknown) {
        await GuildModel.updateOne(
          { _id: guildId, updatesActivationId: activationId },
          {
            $set: {
              subscribed: false,
              notificationChannelId: null,
              updatesInitializing: false,
              updatesLastError: { message: errorMessage(err), channelId: channel.id, at: new Date() }
            },
            $unset: { updatesActivationId: "" }
          },
          OP_UPDATE_OPTS
        ).catch(() => null);
        logger("WARN", "START_UPDATES", "Activat, dar baseline-ul initial a esuat", errorMessage(err));
        invalidateGuildCache(guildId);
        return safeEdit(interaction, formatUserError(err, "Nu am activat update-urile fiindca baseline-ul initial nu a putut fi incarcat."));
      }
    } catch (err: unknown) {
      return safeEdit(interaction, formatUserError(err, "Eroare la activarea update-urilor."));
    }
  }

  async function stop(interaction: SubscriptionInteraction, guildId: string) {
    await GuildModel.updateOne({ _id: guildId }, {
      $set: { subscribed: false, notificationChannelId: null, updatesInitializing: false, pendingUpdates: {} },
      $unset: { updatesActivationId: "" }
    }, OP_UPDATE_OPTS);
    invalidateGuildCache(guildId);
    return safeEdit(interaction, "OK: Update-uri oprite.");
  }

  return { start, stop };
}
