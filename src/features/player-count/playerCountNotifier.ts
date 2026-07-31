"use strict";

import type { GameConfig } from "../../config/configTypes.js";
import type { NotificationDiscordClient } from "../notifications/outboundChannel.js";
import { errorMessage } from "../../shared/errors.js";
import ________shared_utilities from "../../shared/utilities.js";
import { watchlistGameFilter } from "./playerCountWatchlist.js";
import type { PlayerCountChange } from "./playerCountChangeSignal.js";
import type { MilestoneGuildDoc, GuildModelLike, PlayerCountLogger } from "./playerCountTypes.js";
import { sendableChannel } from "./playerCountTypes.js";
import type { PlayerCountWatchRecord } from "./playerCountWatchRepository.js";
const { mapWithConcurrency } = ________shared_utilities;

export interface PlayerCountNotifierDeps {
  GuildModel: GuildModelLike;
  logger: PlayerCountLogger;
  concurrency: number;
  listWatched(guildIds: readonly string[], gameKey: string): Promise<Map<string, PlayerCountWatchRecord>>;
  claimChange(
    guild: MilestoneGuildDoc,
    game: GameConfig,
    playerCount: number,
    fetchedAt: Date,
    watched: PlayerCountWatchRecord | undefined
  ): Promise<PlayerCountChange | null>;
}

export function createPlayerCountNotifier(deps: PlayerCountNotifierDeps) {
  const { GuildModel, logger, concurrency: REFRESH_CONCURRENCY, listWatched, claimChange } = deps;

  async function notifyPlayerCountChanges(
    client: NotificationDiscordClient | null | undefined,
    game: GameConfig,
    playerCount: number,
    fetchedAt: Date
  ): Promise<void> {
    const guilds = await GuildModel.find({
      playerCountSubscribed: true,
      playerCountChannelId: { $ne: null },
      ...watchlistGameFilter(game.key)
    }).lean();
    const watched = await listWatched(guilds.map(guild => guild._id), game.key);
    await mapWithConcurrency(guilds, REFRESH_CONCURRENCY, async guild => {
      const change = await claimChange(guild, game, playerCount, fetchedAt, watched.get(guild._id));
      if (!change || !client) return null;
      let channel = null;
      try {
        channel = await client.channels.fetch(String(guild.playerCountChannelId || ""));
      } catch {
        return null;
      }
      if (!sendableChannel(channel)) return null;
      const sign = change.absoluteChange > 0 ? "+" : "";
      await channel.send({
        embeds: [{
          title: `Schimbare mare de player-count: ${game.name}`,
          color: change.direction === "up" ? 0x2ecc71 : 0xe74c3c,
          description: `Anterior: **${(playerCount - change.absoluteChange).toLocaleString("en-US")}**\nAcum: **${playerCount.toLocaleString("en-US")}**\nSchimbare: **${sign}${change.absoluteChange.toLocaleString("en-US")} (${sign}${change.percentChange.toFixed(1)}%)**`
        }]
      });
      return null;
    });
  }

  async function notifyMilestone(client: NotificationDiscordClient | null | undefined, game: GameConfig, previous: number, current: number, reachedAt: Date): Promise<void> {
    if (!client) return;
    const guilds = await GuildModel.find({
      playerCountSubscribed: true,
      playerCountChannelId: { $ne: null },
      ...watchlistGameFilter(game.key)
    }).lean();
    await mapWithConcurrency(guilds, REFRESH_CONCURRENCY, async guild => {
      const channelId = String(guild.playerCountChannelId || "");
      if (!channelId) return null;
      try {
        const channel = await client.channels.fetch(channelId);
        if (!sendableChannel(channel)) return null;
        await channel.send({
          embeds: [{
            title: `Record nou de jucatori: ${game.name}`,
            color: 0x2ecc71,
            description: `Record vechi: **${previous.toLocaleString("en-US")}**\nRecord nou: **${current.toLocaleString("en-US")}**\nDiferenta: **+${(current - previous).toLocaleString("en-US")}**\nData: <t:${Math.floor(reachedAt.getTime() / 1000)}:F>`
          }]
        });
      } catch (err: unknown) {
        logger("WARN", "PLAYER_COUNT_MILESTONE", `Notificarea milestone a esuat pentru guild ${guild._id}`, errorMessage(err));
      }
      return null;
    });
  }

  return { notifyPlayerCountChanges, notifyMilestone };
}
