"use strict";

import type { GuildSettings, LoggerFunction } from "../../types";
import type { NotificationDiscordClient, ResolveOutboundChannelResult } from "../notifications/outboundChannel";
import { renderYouTubeMessageTemplate, youtubeDestinationIds } from "./youtubeDeliveryPolicy";
import { buildYouTubeEmbed, packYouTubeDeliveries, type PreparedVideo } from "./youtubeDeliveryPlanner";

export interface DeliveryState {
  item: PreparedVideo;
  successful: boolean;
  pendingDestinations: number;
  totalDestinations: number;
}

export interface DeliveryResult {
  videos: number;
  batches: number;
  destinations: number;
}

export interface YouTubeDeliveryExecutorDeps {
  logger: LoggerFunction;
  resolveOutboundChannel(args: {
    client: NotificationDiscordClient;
    guild: GuildSettings;
    channelId: string | null | undefined;
    context: string;
    disableFn: (guildId: string, channelId: string, message: string) => Promise<object>;
    bypassOutbox?: boolean;
    manual?: boolean;
  }): Promise<ResolveOutboundChannelResult>;
  disableNotificationsForChannelError(guildId: string, channelId: string, message: string): Promise<object>;
  removeRouteForChannelError(guildId: string, channelId: string, message: string): Promise<object>;
  sleepIfPositive(ms: number): Promise<void>;
  batchDelayMs: number;
  now(): Date;
}

export function createYouTubeDeliveryExecutor(deps: YouTubeDeliveryExecutorDeps) {
  const { logger, resolveOutboundChannel, disableNotificationsForChannelError, removeRouteForChannelError, sleepIfPositive, batchDelayMs, now } = deps;

  async function deliverPrepared(
    client: NotificationDiscordClient,
    guild: GuildSettings,
    items: PreparedVideo[],
    bypassOutbox: boolean,
    shouldAbort: () => boolean,
    enqueueStaggered = false,
    manual = false
  ): Promise<{ result: DeliveryResult; states: DeliveryState[] }> {
    const states: DeliveryState[] = items.map(item => ({ item, successful: false, pendingDestinations: 0, totalDestinations: 0 }));
    const stateByItem = new Map(items.map((item, index) => [item, states[index]]));
    const groups = new Map<string, PreparedVideo[]>();
    for (const item of items) {
      const destinationIds = youtubeDestinationIds(guild, item.channel.channelId);
      const state = stateByItem.get(item);
      if (state) {
        state.pendingDestinations = destinationIds.length;
        state.totalDestinations = destinationIds.length;
      }
      for (const destinationId of destinationIds) {
        const destinationItems = groups.get(destinationId) || [];
        destinationItems.push(item);
        groups.set(destinationId, destinationItems);
      }
    }
    let batches = 0;
    let destinations = 0;
    for (const [destinationId, destinationItems] of groups) {
      if (shouldAbort()) break;
      const isMainDestination = destinationId === guild.youtubeNotificationChannelId;
      const resolved = await resolveOutboundChannel({
        client,
        guild,
        channelId: destinationId,
        context: "CRON_YOUTUBE",
        disableFn: isMainDestination
          ? disableNotificationsForChannelError
          : removeRouteForChannelError,
        bypassOutbox,
        manual
      });
      if (resolved.abort) continue;
      destinations++;
      const chunks = packYouTubeDeliveries(destinationItems, guild.youtubeMessageTemplate);
      for (let index = 0; index < chunks.length; index++) {
        if (shouldAbort()) break;
        const chunk = chunks[index];
        try {
          await resolved.channel.send(
            {
              content: chunk
                .map(item => renderYouTubeMessageTemplate(guild.youtubeMessageTemplate, item.channel, item.video))
                .join("\n\n"),
              embeds: chunk.map(buildYouTubeEmbed),
              allowedMentions: { parse: [] }
            },
            {
              historyEntries: chunk.map(item => ({
                kind: "youtube" as const,
                gameKey: `youtube:${item.channel.channelId}`,
                title: item.video.title,
                link: item.video.link,
                itemId: item.video.videoId
              })),
              availableAt: enqueueStaggered ? new Date(now().getTime() + index * batchDelayMs) : undefined
            }
          );
          batches++;
          for (const item of chunk) {
            const state = stateByItem.get(item);
            if (state) state.pendingDestinations = Math.max(0, state.pendingDestinations - 1);
          }
          if (!enqueueStaggered && index < chunks.length - 1) await sleepIfPositive(batchDelayMs);
        } catch (error) {
          logger("WARN", "YOUTUBE", `Livrarea YouTube a esuat pentru guild ${guild._id} si canalul ${destinationId}`, error);
          break;
        }
      }
    }
    for (const state of states) state.successful = state.totalDestinations > 0 && state.pendingDestinations === 0;
    return {
      result: {
        videos: states.filter(state => state.successful).length,
        batches,
        destinations
      },
      states
    };
  }

  return { deliverPrepared };
}
