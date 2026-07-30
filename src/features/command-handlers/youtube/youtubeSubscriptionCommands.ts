"use strict";

import type { YouTubeChannelSubscription } from "../../youtube/youtubeTypes.js";
import type { DiscordInteraction, YouTubeInteractionDeps } from "./youtubeCommandTypes.js";
import { isRecentYouTubeVideo } from "../../youtube/youtubeDeliveryPolicy.js";
import {
  MAX_YOUTUBE_CHANNELS,
  addYouTubeChannelSubscription,
  removeYouTubeChannelSubscription
} from "../../youtube/youtubeGuildConfigRepository.js";

import { errorDetail } from "../../../shared/errors.js";

export function createYouTubeSubscriptionCommands(deps: YouTubeInteractionDeps) {
  const { GuildModel, getGuildSettings, resolveYouTubeChannel, fetchYouTubeFeed, seedSeenVideos, removeSeenChannel, safeEdit } = deps;

  async function rollbackSeenBaseline(guildId: string, channelId: string, why: string): Promise<void> {
    try {
      await removeSeenChannel(guildId, channelId);
    } catch (cleanupError) {
      deps.logger("WARN", "YOUTUBE_COMMAND", `Rollback-ul baseline-ului seen pentru canalul ${channelId} a esuat (${why}); pot ramane intrari seen orfane`, errorDetail(cleanupError));
    }
  }

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
    let outcome: Awaited<ReturnType<typeof addYouTubeChannelSubscription>>;
    try {
      outcome = await addYouTubeChannelSubscription(GuildModel, guildId, subscription);
    } catch (error) {
      await rollbackSeenBaseline(guildId, resolved.channelId, "salvarea abonarii a esuat");
      throw error;
    }
    if (outcome.alreadySubscribed) {
      return safeEdit(interaction, `Info: **${resolved.channelName}** este deja urmarit.`);
    }
    if (outcome.limitReached) {
      await rollbackSeenBaseline(guildId, resolved.channelId, "limita de canale a fost ocupata concurent");
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
    try {
      await removeSeenChannel(guildId, channelId);
    } catch (error) {
      deps.logger("WARN", "YOUTUBE_COMMAND", `Curatarea colectiei seen pentru canalul ${channelId} a esuat (best-effort, abonarea a fost deja scoasa)`, errorDetail(error));
    }
    return safeEdit(interaction, `OK: **${channel?.channelName || channelId}** nu mai este urmarit.`);
  }

  return { subscribe, unsubscribe };
}
