"use strict";

import type { GuildSettings, LoggerFunction, YouTubeVideo } from "../../../types";
import type { NotificationDiscordClient } from "../../notifications/outboundChannel";
import type { ResolvedYouTubeChannel } from "../../youtube/youtubeSource";
import type { PreparedVideo, ManualVideoBatch } from "../../youtube/youtubeNotificationService";
import type { YouTubeConfigGuildModel } from "../../youtube/youtubeGuildConfigRepository";

export type InteractionPayload = string | { content?: string; embeds?: object[]; flags?: number };

export interface DiscordChannel {
  id: string;
}

export interface DiscordInteraction {
  commandName?: string;
  guild?: { id: string } | null;
  deferred?: boolean;
  replied?: boolean;
  client?: NotificationDiscordClient;
  isChatInputCommand?: () => boolean;
  options: {
    getSubcommand(): string;
    getSubcommandGroup(required?: boolean): string | null;
    getString(name: string, required?: boolean): string | null;
    getBoolean(name: string, required?: boolean): boolean | null;
    getInteger(name: string, required?: boolean): number | null;
    getChannel(name: string, required?: boolean): DiscordChannel | null;
  };
  reply?(payload: InteractionPayload): Promise<unknown>;
  followUp?(payload: InteractionPayload): Promise<unknown>;
}

export interface ChannelPermissions {
  viewChannel: boolean;
  sendMessages: boolean;
  embedLinks: boolean;
  readMessageHistory: boolean;
}

export interface YouTubeInteractionDeps {
  GuildModel: YouTubeConfigGuildModel;
  getGuildSettings(guildId: string): Promise<GuildSettings | null>;
  invalidateGuildCache(guildId: string): void;
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
