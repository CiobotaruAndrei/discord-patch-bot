"use strict";

import type { YouTubeChannelSubscription } from "../../../types";
import type { DiscordInteraction, YouTubeInteractionDeps } from "./youtubeCommandTypes";
import { isRecentYouTubeVideo } from "../../youtube/youtubeDeliveryPolicy";
import {
  MAX_YOUTUBE_CHANNELS,
  addYouTubeChannelSubscription,
  removeYouTubeChannelSubscription
} from "../../youtube/youtubeGuildConfigRepository";

const { errorDetail } = require("../../../shared/errors") as typeof import("../../../shared/errors");

export function createYouTubeSubscriptionCommands(deps: YouTubeInteractionDeps) {
  const { GuildModel, getGuildSettings, invalidateGuildCache, resolveYouTubeChannel, fetchYouTubeFeed, seedSeenVideos, removeSeenChannel, safeEdit } = deps;

  async function subscribe(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    const input = interaction.options.getString("canal", true);
    if (!input) return safeEdit(interaction, "Eroare: trebuie sa introduci canalul YouTube.");
    const settings = await getGuildSettings(guildId);
    const channels = settings?.youtubeChannels || [];
    if (channels.length >= MAX_YOUTUBE_CHANNELS) {
      return safeEdit(interaction, `Eroare: serverul a atins limita de ${MAX_YOUTUBE_CHANNELS} canale YouTube.`);
    }
    const resolved = await resolveYouTubeChannel(input);
    if (channels.some(channel => channel.channelId === resolved.channelId)) {
      return safeEdit(interaction, `Info: **${resolved.channelName}** este deja urmarit.`);
    }
    const videos = await fetchYouTubeFeed(resolved);
    const now = new Date();
    const olderVideos = videos.filter(video => !isRecentYouTubeVideo(video, now));
    await seedSeenVideos(guildId, resolved.channelId, olderVideos);
    const subscription: YouTubeChannelSubscription = {
      ...resolved,
      subscribedAt: now,
      lastCheckedAt: now,
      lastVideoId: videos[0]?.videoId || "",
      lastError: { message: "", channelId: null, at: null }
    };
    const outcome = await addYouTubeChannelSubscription(GuildModel, guildId, subscription);
    invalidateGuildCache(guildId);
    if (outcome.alreadySubscribed) {
      return safeEdit(interaction, `Info: **${resolved.channelName}** este deja urmarit.`);
    }
    if (outcome.limitReached) {
      return safeEdit(interaction, `Eroare: serverul a atins limita de ${MAX_YOUTUBE_CHANNELS} canale YouTube (o comanda concurenta a ocupat ultimul loc).`);
    }
    return safeEdit(
      interaction,
      `OK: **${resolved.channelName}** a fost adaugat. Am ignorat ${olderVideos.length} videoclipuri mai vechi de o luna; cele recente pot fi livrate la prima activare.`
    );
  }

  async function unsubscribe(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    const channelId = interaction.options.getString("canal", true);
    if (!channelId) return safeEdit(interaction, "Eroare: trebuie sa alegi un canal urmarit.");
    const settings = await getGuildSettings(guildId);
    const channel = settings?.youtubeChannels?.find(item => item.channelId === channelId);
    const removed = await removeYouTubeChannelSubscription(GuildModel, guildId, channelId);
    if (!removed) {
      return safeEdit(interaction, `Info: canalul \`${channelId}\` nu era urmarit.`);
    }
    invalidateGuildCache(guildId);
    try {
      await removeSeenChannel(guildId, channelId);
    } catch (error) {
      deps.logger("WARN", "YOUTUBE_COMMAND", `Curatarea colectiei seen pentru canalul ${channelId} a esuat (best-effort, abonarea a fost deja scoasa)`, errorDetail(error));
    }
    return safeEdit(interaction, `OK: **${channel?.channelName || channelId}** nu mai este urmarit.`);
  }

  return { subscribe, unsubscribe };
}
