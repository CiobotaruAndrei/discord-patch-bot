"use strict";

import type { OutboxDiscordClient } from "../notifications/outboundChannel.js";
import type { OutboxMessagePayload } from "../notifications/outboxTypes.js";

export type OutboxAdminInteraction = {
  commandName?: string;
  guild?: { id: string } | null;
  user?: { id?: string } | null;
  client?: OutboxDiscordClient;
  deferred?: boolean;
  replied?: boolean;
  options: {
    getSubcommandGroup(required: false): string | null;
    getSubcommand(): string;
  };
  isChatInputCommand?: () => boolean;
  reply: (payload: unknown) => Promise<unknown>;
  followUp?: (payload: unknown) => Promise<unknown>;
};

export interface DrainResultLike {
  sent?: number;
  retried?: number;
  deadLettered?: number;
  expired?: number;
  queued?: number;
}

export interface OutboxModelLike {
  countDocuments(filter?: unknown): Promise<number>;
  updateMany(filter: unknown, update: unknown): Promise<{ modifiedCount?: number; matchedCount?: number }>;
}

export interface DeadLetterEntryLike {
  kind?: string;
  itemId?: string;
  title?: string;
  channelId?: string;
  dedupeKey?: string;
  reason?: string;
  attempts?: number;
  failedAt?: Date | string;
}

export interface GuildSettingsLike {
  outboxRecoveryVerify?: boolean;
  notificationChannelId?: string | null;
  discountChannelId?: string | null;
  youtubeNotificationChannelId?: string | null;
  dlcChannelId?: string | null;
  futureReleaseChannelId?: string | null;
  youtubeChannelRoutes?: Array<{ channelId?: string; discordChannelIds?: string[] }>;
}

export interface ChannelPermissions {
  viewChannel: boolean;
  sendMessages: boolean;
  embedLinks: boolean;
  readMessageHistory: boolean;
}

export type OutboxAdminLogger = (level: string, context: string, msg: string, meta?: unknown) => void;

export interface ReplayHistoryEntryLike {
  kind: "update" | "discount" | "youtube";
  gameKey?: string;
  title?: string;
  link?: string;
  itemId?: string;
}

export interface ReplayDeadLetterDoc {
  _id: unknown;
  kind: "update" | "discount" | "youtube";
  channelId: string;
  payload: unknown;
  dedupeKey: string;
  recoveryVerify: boolean;
  history?: ReplayHistoryEntryLike[];
}

export type EnqueueOutbox = (job: { guildId: string; channelId: string; kind: "update" | "discount" | "youtube"; payload: OutboxMessagePayload; recoveryVerify?: boolean; history?: ReplayHistoryEntryLike[] }) => Promise<void>;

export function onOff(value: boolean): string {
  return value ? "ON" : "OFF";
}
