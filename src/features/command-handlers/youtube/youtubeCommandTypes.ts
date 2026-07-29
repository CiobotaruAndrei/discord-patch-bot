"use strict";

import type {
  BooleanOption,
  ChannelOption,
  ChatInputInteraction,
  IntegerOption,
  InteractionGuildRef,
  StringOption,
  SubcommandGroupOption,
  SubcommandOption
} from "../discordInteractionPorts.js";
import type { GuildSettings, LoggerFunction, YouTubeVideo } from "../../../types.js";
import type { NotificationDiscordClient } from "../../notifications/outboundChannel.js";
import type { ResolvedYouTubeChannel } from "../../youtube/youtubeSource.js";
import type { PreparedVideo, ManualVideoBatch } from "../../youtube/youtubeNotificationService.js";
import type { YouTubeConfigGuildModel } from "../../youtube/youtubeGuildConfigRepository.js";
import type { YoutubeErrorModelLike } from "../../youtube/youtubeErrorsRepository.js";

export type InteractionPayload = string | { content?: string; embeds?: object[]; flags?: number };

export interface DiscordChannel {
  id: string;
}

export type DiscordInteraction = ChatInputInteraction<
  SubcommandOption & SubcommandGroupOption & StringOption & BooleanOption & IntegerOption & ChannelOption<DiscordChannel>,
  InteractionGuildRef,
  InteractionPayload
> & { client?: NotificationDiscordClient };

export interface ChannelPermissions {
  viewChannel: boolean;
  sendMessages: boolean;
  embedLinks: boolean;
  readMessageHistory: boolean;
}

export interface YouTubeInteractionDeps {
  GuildModel: YouTubeConfigGuildModel;
  GuildYoutubeErrorModel: Pick<YoutubeErrorModelLike, "find" | "countDocuments">;
  getGuildSettings(guildId: string): Promise<GuildSettings | null>;
  resolveYouTubeChannel(input: string): Promise<ResolvedYouTubeChannel>;
  fetchYouTubeFeed(channel: ResolvedYouTubeChannel): Promise<YouTubeVideo[]>;
  seedSeenVideos(guildId: string, channelId: string, videos: YouTubeVideo[]): Promise<void>;
  removeSeenChannel(guildId: string, channelId: string): Promise<void>;
  clearYouTubeErrors(guildId: string): Promise<void>;
  prepareManualYouTubeVideos(guild: GuildSettings, selectedChannelId: string, force?: boolean): Promise<{ deliverable: PreparedVideo[]; skipped: number; claimed: boolean }>;
  deliverManualYouTubeVideos(
    client: NotificationDiscordClient,
    guild: GuildSettings,
    batch: ManualVideoBatch,
    bypassOutbox?: boolean
  ): Promise<{ videos: number; batches: number; destinations: number }>;
  checkChannelPermissions(interaction: DiscordInteraction, channelId: string): Promise<ChannelPermissions | null>;
  safeDefer(interaction: DiscordInteraction, ephemeral?: boolean): Promise<void>;
  safeEdit(interaction: DiscordInteraction, payload: InteractionPayload): Promise<unknown>;
  formatUserError(error: unknown, fallback: string): string;
  logger: LoggerFunction;
  MessageFlags: { Ephemeral: number };
  outboxEnabled?: boolean;
}
