"use strict";

import type { GameConfig } from "../../types.js";
import type { DiscordChannel, SubscriptionFamily, SubscriptionInteraction, SubscriptionInteractionDeps } from "./subscriptionCommandContracts.js";
import { createSubscriptionService } from "../notifications/subscriptionService.js";
import { normalizeGameKey } from "../../config/gameCatalog.js";

export { normalizeGameKey };

export function createPlayerCountSubscriptionFamily(deps: SubscriptionInteractionDeps): SubscriptionFamily {
  const { getGuildSettings, safeEdit, formatUserError, fetchSteamCurrentPlayers } = deps;
  const service = createSubscriptionService(deps);

  async function start(interaction: SubscriptionInteraction, guildId: string, channel: DiscordChannel, games: GameConfig[]) {
    const settings = await getGuildSettings(guildId);
    const enabled = new Set((settings?.enabledGames ?? []).map(normalizeGameKey));
    const watched = games.filter(game => enabled.has(normalizeGameKey(game.key)));
    const eligible = watched.filter(game => Boolean(game.appId));
    if (!eligible.length) return safeEdit(interaction, "Eroare: watchlist-ul nu contine niciun joc eligibil cu Steam appId.");
    try {
      const outcome = await service.startPlayerCount(guildId, channel.id, async () => {
        const fetchedAt = new Date();
        const values = await Promise.all(eligible.map(async game => {
          const result = await fetchSteamCurrentPlayers(String(game.appId));
          return result.success ? { gameKey: game.key, appId: String(game.appId), playerCount: result.playerCount, fetchedAt } : null;
        }));
        return values.filter((value): value is NonNullable<typeof value> => value !== null);
      });
      if (outcome.status === "superseded") return safeEdit(interaction, "Player-count nu a fost pornit deoarece activarea a fost oprita sau inlocuita intre timp.");
      if (outcome.status === "baseline-failed") return safeEdit(interaction, formatUserError(outcome.error, "Eroare la baseline-ul player-count."));
      const omitted = watched.length - eligible.length;
      return safeEdit(interaction, `OK: player-count pornit pentru watchlist. Jocuri eligibile: ${eligible.length}; fara Steam appId: ${omitted}.`);
    } catch (err: unknown) {
      return safeEdit(interaction, formatUserError(err, "Eroare la pornirea player-count."));
    }
  }

  async function stop(interaction: SubscriptionInteraction, guildId: string) {
    await service.stopPlayerCount(guildId);
    return safeEdit(interaction, "OK: player-count oprit pentru intregul watchlist; starea pending a fost curatata.");
  }

  return { start, stop };
}
