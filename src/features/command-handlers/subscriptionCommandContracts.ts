"use strict";

import type { DealInfo, FetchResult, GameConfig, GuildSettings, MongoWriteOutcome } from "../../types";

export type SubscriptionLogger = (level: string, context: string, message: string, meta?: unknown) => void;
export type MongoWriteResult = MongoWriteOutcome;
export type InteractionPayload = string | Record<string, unknown>;

export interface DiscordChannel {
  id: string;
}

export interface SubscriptionInteraction {
  commandName?: string;
  guild?: { id: string } | null;
  channel?: DiscordChannel | null;
  client?: { user?: { id: string } | null } | null;
  deferred?: boolean;
  replied?: boolean;
  options: {
    getSubcommand(): string;
    getString?(name: string, required?: boolean): string | null;
  };
  isChatInputCommand?: () => boolean;
  reply?: (payload: unknown) => Promise<unknown>;
  followUp?: (payload: unknown) => Promise<unknown>;
}

export type GuildModelLike = {
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>): Promise<MongoWriteResult>;
};

export type SubscriptionInteractionDeps = {
  GuildModel: GuildModelLike;
  logger: SubscriptionLogger;
  getGuildSettings: (guildId: string) => Promise<GuildSettings | null>;
  invalidateGuildCache: (guildId: string) => void;
  DEFAULT_CURRENCY: string;
  getLatestForAllGames: (games: GameConfig[]) => Promise<FetchResult[]>;
  fetchDeals: (options: { currency: string }) => Promise<DealInfo[]>;
  dealHash: (deal: DealInfo) => string;
  seedSeenUpdates: (guildId: string, entries: Array<{ gameKey: string; updateId: string }>) => Promise<void>;
  seedSeenDiscounts: (guildId: string, hashes: string[]) => Promise<void>;
  DEALS_HISTORY_LIMIT: number;
  OP_UPDATE_OPTS: Record<string, unknown>;
  setDealsCache: (currency: string, deals: DealInfo[]) => void;
  safeDefer: (interaction: SubscriptionInteraction, ephemeral?: boolean) => Promise<void>;
  safeEdit: (interaction: SubscriptionInteraction, payload: InteractionPayload) => Promise<unknown>;
  canSendEmbeds: (channel: DiscordChannel | null | undefined, botId: string) => boolean;
  listMissingChannelPerms: (channel: DiscordChannel | null | undefined, botId: string) => string[] | null;
  missingChannelPermsMessage: (missing?: string[] | null) => string;
  makeActivationId: () => string;
  formatUserError: (err: unknown, fallback: string) => string;
};

export interface SubscriptionFamily {
  start(interaction: SubscriptionInteraction, guildId: string, channel: DiscordChannel, games: GameConfig[]): Promise<unknown>;
  stop(interaction: SubscriptionInteraction, guildId: string, games: GameConfig[]): Promise<unknown>;
}

export type SubscriptionContext = SubscriptionInteractionDeps & {
  MessageFlags: { Ephemeral: number };
  handleInteraction?: (interaction: SubscriptionInteraction, games: GameConfig[]) => MaybePromise<unknown>;
};

type MaybePromise<T> = T | Promise<T>;
