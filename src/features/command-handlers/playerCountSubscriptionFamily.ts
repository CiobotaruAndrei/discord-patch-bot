"use strict";

import type { GameConfig } from "../../types.js";
import type { DiscordChannel, SubscriptionFamily, SubscriptionInteraction, SubscriptionInteractionDeps } from "./subscriptionCommandContracts.js";
import { createSubscriptionService } from "../notifications/subscriptionService.js";
import { normalizeGameKey, findGameByKeyOrAlias as findConfiguredGame } from "../../config/gameCatalog.js";

export { normalizeGameKey, findConfiguredGame };

export function createPlayerCountSubscriptionFamily(deps: SubscriptionInteractionDeps): SubscriptionFamily {
  const { getGuildSettings, safeEdit, formatUserError } = deps;
  const service = createSubscriptionService(deps);

  async function start(interaction: SubscriptionInteraction, guildId: string, channel: DiscordChannel, games: GameConfig[]) {
    const requested = interaction.options.getString?.("game", false) || null;
    const settings = await getGuildSettings(guildId);
    const eligible = (Array.isArray(settings?.enabledGames) && settings.enabledGames.length ? settings.enabledGames : games.map(game => game.key))
      .map(key => findConfiguredGame(games, key))
      .filter((game): game is GameConfig => Boolean(game));
    const selected = requested ? [findConfiguredGame(games, requested)].filter((game): game is GameConfig => Boolean(game)) : eligible;
    const valid = selected.filter(game => Boolean(game.appId));
    if (!valid.length) return safeEdit(interaction, requested ? "Eroare: jocul nu exista sau nu are Steam appId." : "Eroare: watchlist-ul nu contine jocuri cu Steam appId.");
    try {
      if (requested && valid.length === 1) await service.addPlayerCountGame(guildId, channel.id, valid[0].key);
      else await service.addPlayerCountGames(guildId, channel.id, valid.map(game => game.key));
      const skipped = selected.length - valid.length;
      return safeEdit(interaction, `OK: player-count pornit pentru ${valid.length} jocuri${skipped ? `; ${skipped} fără Steam appId au fost omise` : ""}.`);
    } catch (err: unknown) {
      return safeEdit(interaction, formatUserError(err, "Eroare la pornirea player-count."));
    }
  }

  async function stop(interaction: SubscriptionInteraction, guildId: string, games: GameConfig[]) {
    const requested = interaction.options.getString?.("game", false) || null;
    const game = findConfiguredGame(games, requested);
    const requestedKey = game?.key || String(requested || "").trim();
    const existingGuild = await getGuildSettings(guildId);
    const current = Array.isArray(existingGuild?.playerCountGames) ? existingGuild.playerCountGames.map(String) : [];
    if (!requestedKey) {
      await service.stopPlayerCount(guildId);
      return safeEdit(interaction, "OK: player-count a fost oprit pentru server; watchlist-ul nu a fost modificat.");
    }
    const normalizedRequested = normalizeGameKey(requestedKey);
    const remaining = current.filter(key => normalizeGameKey(key) !== normalizedRequested);
    await service.setPlayerCountGames(guildId, remaining, existingGuild?.playerCountChannelId || null);
    return safeEdit(interaction, `OK: player-count oprit pentru \`${game?.name || requestedKey}\`.`);
  }

  return { start, stop };
}
