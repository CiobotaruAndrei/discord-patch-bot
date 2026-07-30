"use strict";

import type { GameConfig } from "../../config/configTypes.js";
import type { DiscordChannel, SubscriptionFamily, SubscriptionInteraction, SubscriptionInteractionDeps } from "./subscriptionCommandContracts.js";
import { createSubscriptionService } from "../notifications/subscriptionService.js";

export function createUpdatesSubscriptionFamily(deps: SubscriptionInteractionDeps): SubscriptionFamily {
  const { getLatestForAllGames, seedSeenUpdates, safeEdit, formatUserError } = deps;
  const service = createSubscriptionService(deps);

  async function start(interaction: SubscriptionInteraction, guildId: string, channel: DiscordChannel, games: GameConfig[]) {
    try {
      const outcome = await service.startUpdates(guildId, channel.id, async () => {
        const results = await getLatestForAllGames(games);
        const seedEntries = results
          .filter(result => result.latest)
          .map(result => ({ gameKey: result.game.key, updateId: result.latest!.id }));
        await seedSeenUpdates(guildId, seedEntries);
      });
      if (outcome.status === "superseded") {
        return safeEdit(interaction, "Activarea update-urilor a fost intrerupta de o comanda stop/start mai noua. Ruleaza din nou /start updates daca mai vrei activarea.");
      }
      if (outcome.status === "baseline-failed") {
        return safeEdit(interaction, formatUserError(outcome.error, "Nu am activat update-urile fiindca baseline-ul initial nu a putut fi incarcat."));
      }
      return safeEdit(interaction, "OK: Update-uri automate activate.");
    } catch (err: unknown) {
      return safeEdit(interaction, formatUserError(err, "Eroare la activarea update-urilor."));
    }
  }

  async function stop(interaction: SubscriptionInteraction, guildId: string) {
    await service.stopUpdates(guildId);
    return safeEdit(interaction, "OK: Update-uri oprite.");
  }

  return { start, stop };
}
