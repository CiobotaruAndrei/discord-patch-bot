"use strict";

import type {
  ChatInputInteraction,
  InteractionGuildRef,
  InteractionUserRef,
  StringOption,
  SubcommandOption
} from "./discordInteractionPorts.js";
import type { DiscordReplyPayload, MongoWriteOutcome } from "../../types.js";
import type { GameConfig } from "../../config/configTypes.js";
import type { GuildSettings } from "../guild-config/guildSettingsTypes.js";
import type { DealInfo, FetchResult } from "../../sources/sourceTypes.js";

export type SubscriptionLogger = (level: string, context: string, message: string, meta?: unknown) => void;
export type MongoWriteResult = MongoWriteOutcome;
export type InteractionPayload = DiscordReplyPayload;

export interface DiscordChannel {
  id: string;
}

export type SubscriptionInteraction = ChatInputInteraction<
  SubcommandOption & Partial<StringOption>,
  InteractionGuildRef,
  InteractionPayload
> & {
  channel?: DiscordChannel | null;
  client?: { user?: InteractionUserRef | null } | null;
};

export type GuildModelLike = {
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>): Promise<MongoWriteResult>;
};

export type SubscriptionInteractionDeps = {
  GuildModel: GuildModelLike;
  logger: SubscriptionLogger;
  getGuildSettings: (guildId: string) => Promise<GuildSettings | null>;
  DEFAULT_CURRENCY: string;
  getLatestForAllGames: (games: GameConfig[]) => Promise<FetchResult[]>;
  fetchDeals: (options: { currency: string }) => Promise<DealInfo[]>;
  dealHash: (deal: DealInfo) => string;
  seedSeenUpdates: (guildId: string, entries: Array<{ gameKey: string; updateId: string }>) => Promise<void>;
  seedSeenDiscounts: (guildId: string, hashes: string[]) => Promise<void>;
  seedBaselineDlc?: (guildId: string, games: GameConfig[]) => Promise<void>;
  fetchSteamCurrentPlayers(appId: string | number): Promise<{ playerCount: number; success: boolean }>;
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
};

type MaybePromise<T> = T | Promise<T>;
