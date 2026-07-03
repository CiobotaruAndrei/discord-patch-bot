"use strict";

import type { DiscordChannel, SubscriptionFamily, SubscriptionInteraction, SubscriptionInteractionDeps } from "./subscriptionCommandContracts";

const { errorMessage } = require("../../shared/errors");
const { HASH_VERSION } = require("../../native/fuzzy") as { HASH_VERSION: number };

export function createDiscountsSubscriptionFamily(deps: SubscriptionInteractionDeps): SubscriptionFamily {
  const {
    GuildModel, logger, getGuildSettings, invalidateGuildCache, DEFAULT_CURRENCY,
    fetchDeals, dealHash, seedSeenDiscounts, DEALS_HISTORY_LIMIT, OP_UPDATE_OPTS,
    setDealsCache, safeEdit, makeActivationId, formatUserError
  } = deps;

  async function start(interaction: SubscriptionInteraction, guildId: string, channel: DiscordChannel) {
    try {
      const activationId = makeActivationId();
      const existingGuild = await getGuildSettings(guildId);
      const currency = existingGuild?.currency || DEFAULT_CURRENCY;
      await GuildModel.updateOne(
        { _id: guildId },
        {
          $set: {
            discountsSubscribed: true,
            discountChannelId: channel.id,
            discountsInitializing: true,
            discountsActivationId: activationId,
            pendingDiscounts: []
          },
          $unset: { discountsLastError: "" }
        },
        { upsert: true, ...OP_UPDATE_OPTS }
      );
      invalidateGuildCache(guildId);

      try {
        const deals = await fetchDeals({ currency });
        const initHashes = deals.slice(0, DEALS_HISTORY_LIMIT).map((deal) => dealHash(deal));
        await seedSeenDiscounts(guildId, initHashes);
        const activationResult = await GuildModel.updateOne(
          {
            _id: guildId,
            discountsSubscribed: true,
            discountChannelId: channel.id,
            discountsActivationId: activationId
          },
          {
            $set: {
              discountsInitializing: false,
              seenHashVersionDiscounts: HASH_VERSION
            },
            $unset: { discountsActivationId: "", discountsLastError: "" }
          },
          OP_UPDATE_OPTS
        );
        if (activationResult.matchedCount === 0) {
          return safeEdit(interaction, "Activarea reducerilor a fost intrerupta de o comanda stop/start mai noua. Ruleaza din nou /start reduceri daca mai vrei activarea.");
        }
        setDealsCache(currency, deals);
        return safeEdit(interaction, `OK: Alerte reduceri activate pe acest canal. Valuta: **${currency}**.`);
      } catch (err: unknown) {
        await GuildModel.updateOne(
          { _id: guildId, discountsActivationId: activationId },
          {
            $set: {
              discountsSubscribed: false,
              discountChannelId: null,
              discountsInitializing: false,
              discountsLastError: { message: errorMessage(err), channelId: channel.id, at: new Date() }
            },
            $unset: { discountsActivationId: "" }
          },
          OP_UPDATE_OPTS
        ).catch(() => null);
        logger("WARN", "START_DISCOUNTS", "Activat, dar baseline-ul de reduceri a esuat", errorMessage(err));
        invalidateGuildCache(guildId);
        return safeEdit(interaction, formatUserError(err, "Nu am activat reducerile fiindca baseline-ul initial nu a putut fi incarcat."));
      }
    } catch (err: unknown) {
      return safeEdit(interaction, formatUserError(err, "Eroare la activarea reducerilor."));
    }
  }

  async function stop(interaction: SubscriptionInteraction, guildId: string) {
    await GuildModel.updateOne({ _id: guildId }, {
      $set: { discountsSubscribed: false, discountChannelId: null, discountsInitializing: false, pendingDiscounts: [] },
      $unset: { discountsActivationId: "" }
    }, OP_UPDATE_OPTS);
    invalidateGuildCache(guildId);
    return safeEdit(interaction, "OK: Reduceri oprite.");
  }

  return { start, stop };
}
