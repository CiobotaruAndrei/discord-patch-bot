"use strict";

import type { GameConfig } from "../../types.js";
import type { DiscordChannel, SubscriptionFamily, SubscriptionInteraction, SubscriptionInteractionDeps } from "./subscriptionCommandContracts.js";
import { createSubscriptionService } from "../notifications/subscriptionService.js";

export function normalizeGameKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function findConfiguredGame(games: GameConfig[], value: string | null): GameConfig | null {
  const input = normalizeGameKey(String(value || ""));
  if (!input) return null;
  return games.find(game => {
    if (normalizeGameKey(game.key) === input || normalizeGameKey(game.name) === input) return true;
    return Array.isArray(game.aliases) && game.aliases.some(alias => normalizeGameKey(String(alias)) === input);
  }) || null;
}

export function createPlayerCountSubscriptionFamily(deps: SubscriptionInteractionDeps): SubscriptionFamily {
  const { getGuildSettings, safeEdit, formatUserError } = deps;
  const service = createSubscriptionService(deps);

  async function start(interaction: SubscriptionInteraction, guildId: string, channel: DiscordChannel, games: GameConfig[]) {
    const game = findConfiguredGame(games, interaction.options.getString?.("game", true) || null);
    if (!game) return safeEdit(interaction, "Eroare: jocul nu exista in lista configurata a botului.");
    if (!game.appId) return safeEdit(interaction, `Eroare: \`${game.name}\` nu are Steam appId configurat, deci nu poate avea player-count Steam.`);
    try {
      await service.addPlayerCountGame(guildId, channel.id, game.key);
      return safeEdit(interaction, `OK: player-count pornit pentru **${game.name}** pe acest server.`);
    } catch (err: unknown) {
      return safeEdit(interaction, formatUserError(err, "Eroare la pornirea player-count."));
    }
  }

  async function stop(interaction: SubscriptionInteraction, guildId: string, games: GameConfig[]) {
    const requested = interaction.options.getString?.("game", true) || null;
    const game = findConfiguredGame(games, requested);
    const requestedKey = game?.key || String(requested || "").trim();
    if (!requestedKey) return safeEdit(interaction, "Eroare: trebuie sa specifici jocul pentru care opresti player-count.");
    const existingGuild = await getGuildSettings(guildId);
    const current = Array.isArray(existingGuild?.playerCountGames) ? existingGuild.playerCountGames.map(String) : [];
    const normalizedRequested = normalizeGameKey(requestedKey);
    const remaining = current.filter(key => normalizeGameKey(key) !== normalizedRequested);
    await service.setPlayerCountGames(guildId, remaining, existingGuild?.playerCountChannelId || null);
    return safeEdit(interaction, `OK: player-count oprit pentru \`${game?.name || requestedKey}\`.`);
  }

  return { start, stop };
}
