"use strict";

import type { DealInfo } from "../../types";
import type { DiscordChannel, SubscriptionFamily, SubscriptionInteraction, SubscriptionInteractionDeps } from "./subscriptionCommandContracts";
import { createSubscriptionService } from "../notifications/subscriptionService";

export function createDiscountsSubscriptionFamily(deps: SubscriptionInteractionDeps): SubscriptionFamily {
  const {
    getGuildSettings, DEFAULT_CURRENCY, fetchDeals, dealHash, seedSeenDiscounts,
    DEALS_HISTORY_LIMIT, setDealsCache, safeEdit, formatUserError
  } = deps;
  const service = createSubscriptionService(deps);

  async function start(interaction: SubscriptionInteraction, guildId: string, channel: DiscordChannel) {
    try {
      const existingGuild = await getGuildSettings(guildId);
      const currency = existingGuild?.currency || DEFAULT_CURRENCY;
      let deals: DealInfo[] = [];
      const outcome = await service.startDiscounts(guildId, channel.id, async () => {
        deals = await fetchDeals({ currency });
        const initHashes = deals.slice(0, DEALS_HISTORY_LIMIT).map((deal) => dealHash(deal));
        await seedSeenDiscounts(guildId, initHashes);
      });
      if (outcome.status === "superseded") {
        return safeEdit(interaction, "Activarea reducerilor a fost intrerupta de o comanda stop/start mai noua. Ruleaza din nou /start reduceri daca mai vrei activarea.");
      }
      if (outcome.status === "baseline-failed") {
        return safeEdit(interaction, formatUserError(outcome.error, "Nu am activat reducerile fiindca baseline-ul initial nu a putut fi incarcat."));
      }
      setDealsCache(currency, deals);
      return safeEdit(interaction, `OK: Alerte reduceri activate pe acest canal. Valuta: **${currency}**.`);
    } catch (err: unknown) {
      return safeEdit(interaction, formatUserError(err, "Eroare la activarea reducerilor."));
    }
  }

  async function stop(interaction: SubscriptionInteraction, guildId: string) {
    await service.stopDiscounts(guildId);
    return safeEdit(interaction, "OK: Reduceri oprite.");
  }

  return { start, stop };
}
