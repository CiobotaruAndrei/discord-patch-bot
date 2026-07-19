import crypto from "crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder
} from "discord.js";

import type { SourceRegistryApi } from "../../sources/sourceRegistry.js";
import type { RedisRuntime } from "../../infra/redis/redisClient.js";
import type { RedisCache } from "../../infra/redis/redisCache.js";

type MongoContextExports = typeof import("../../infra/mongo/mongoContext.js")["default"];

export interface CommandRuntimeInput {
  mongo: MongoContextExports;
  sources: SourceRegistryApi;
  redis: RedisRuntime;
  redisCache: Pick<RedisCache, "getJson" | "setJson">;
}

export type DiscordRuntimeBindings = {
  crypto: typeof crypto;
  EmbedBuilder: typeof EmbedBuilder;
  ActionRowBuilder: typeof ActionRowBuilder;
  ButtonBuilder: typeof ButtonBuilder;
  ButtonStyle: typeof ButtonStyle;
  ComponentType: typeof ComponentType;
  MessageFlags: typeof MessageFlags;
  PermissionsBitField: typeof PermissionsBitField;
  SlashCommandBuilder: typeof SlashCommandBuilder;
  Routes: typeof Routes;
  REST: typeof REST;
};

type PermissionAwareChannel = {
  permissionsFor(member: unknown): { has(flag: unknown): boolean } | null;
};

type PermissionAwareInteraction = {
  guild?: {
    id?: unknown;
    members?: { me?: unknown };
    channels?: {
      cache?: { get(channelId: string): unknown };
      fetch?(channelId: string): Promise<unknown>;
    };
  } | null;
};

interface ChannelPermissions {
  viewChannel: boolean;
  sendMessages: boolean;
  embedLinks: boolean;
  readMessageHistory: boolean;
}

type CommandMongoKey =
  | "logger" | "env" | "DEFAULT_CURRENCY" | "SUPPORTED_CURRENCIES" | "getCurrencyConfig" | "formatPrice"
  | "getGuildSettings" | "getGuildCacheSize" | "adminAlert" | "withMongoRetry"
  | "saveFetchSnapshot" | "loadFetchSnapshot" | "loadDealsFetchSnapshots" | "loadSourceHealth"
  | "getOutboxPaused" | "setOutboxPaused" | "getSystemTimes" | "saveSystemTime"
  | "validateUpdateFetchSnapshot" | "validatePendingDiscountSnapshot"
  | "GuildModel" | "GuildAuditLogModel" | "GuildConfigBackupModel" | "GuildSuggestedCommandModel"
  | "GuildYoutubeErrorModel" | "GuildDeadLetterModel" | "PlayerCountSnapshotModel" | "PlayerCountHistoryModel"
  | "ReviewTrendSnapshotModel"
  | "DealPriceSnapshotModel"
  | "NewAccountAlertDeliveryModel"
  | "PlayerCountRecordModel" | "FeedbackReportModel" | "BugReportModel" | "UserComplaintModel"
  | "GuildSeenDiscountModel" | "GuildSeenUpdateModel" | "GuildSeenYoutubeModel"
  | "NotificationOutboxModel" | "NotificationOutboxSentModel" | "NotificationHistoryModel"
  | "NotificationDeadLetterReplayModel" | "OperationJournalModel" | "runConcurrent";

type CommandSourceKey =
  | "MAX_DEALS" | "FETCH_CONCURRENCY"
  | "cleanText" | "truncate" | "normalizeTitleForDedupe" | "safeCheerioLoad" | "httpReq" | "fetchWithProxy"
  | "fetchDeals" | "fetchGameUpdate" | "getLatestForAllGames" | "executeFetchWithCircuitBreaker"
  | "fetchSteamCurrentPlayers" | "fetchSteamLatestUpdateSize" | "searchSteamGameByName" | "chooseBestSteamMatch" | "fetchSteamPriceDetails"
  | "enrichDealData" | "fetchSteamReviewData" | "extractOfferEndFromHtml" | "extractSteamOfferEndDate"
  | "cleanEnrichedCache" | "getEnrichedCacheSize" | "dealHash";

export type CommandMongoDependencies = Pick<MongoContextExports, CommandMongoKey>;
export type CommandSourceDependencies = Pick<SourceRegistryApi, CommandSourceKey>;
export type CommandPlatformDependencies = {
  checkReadMessageHistory: typeof checkReadMessageHistory;
  checkChannelPermissions: typeof checkChannelPermissions;
  redis: RedisRuntime;
  redisCache: Pick<RedisCache, "getJson" | "setJson">;
};

export interface CommandRuntimeDependencies {
  discord: DiscordRuntimeBindings;
  mongo: CommandMongoDependencies;
  sources: CommandSourceDependencies;
  platform: CommandPlatformDependencies;
}

export function createDiscordRuntimeBindings(): DiscordRuntimeBindings {
  return {
    crypto,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    MessageFlags,
    PermissionsBitField,
    SlashCommandBuilder,
    Routes,
    REST
  };
}

async function resolvePermissionsFor(interaction: PermissionAwareInteraction, channelId: string): Promise<{ has(flag: unknown): boolean } | null> {
  try {
    const guild = interaction.guild;
    const me = guild?.members?.me;
    if (!me || !guild?.channels) return null;
    const cached = guild.channels.cache?.get(channelId);
    const fetched = typeof guild.channels.fetch === "function"
      ? await guild.channels.fetch(channelId).catch(() => null)
      : null;
    const channel = cached ?? fetched;
    if (!isPermissionAwareChannel(channel)) return null;
    return channel.permissionsFor(me);
  } catch {
    return null;
  }
}

function isPermissionAwareChannel(value: unknown): value is PermissionAwareChannel {
  if (!value || typeof value !== "object") return false;
  return "permissionsFor" in value && typeof value.permissionsFor === "function";
}

export async function checkReadMessageHistory(interaction: PermissionAwareInteraction, channelId: string): Promise<boolean | null> {
  const perms = await resolvePermissionsFor(interaction, channelId);
  return perms ? perms.has(PermissionsBitField.Flags.ReadMessageHistory) : null;
}

export async function checkChannelPermissions(interaction: PermissionAwareInteraction, channelId: string): Promise<ChannelPermissions | null> {
  const perms = await resolvePermissionsFor(interaction, channelId);
  if (!perms) return null;
  return {
    viewChannel: perms.has(PermissionsBitField.Flags.ViewChannel),
    sendMessages: perms.has(PermissionsBitField.Flags.SendMessages),
    embedLinks: perms.has(PermissionsBitField.Flags.EmbedLinks),
    readMessageHistory: perms.has(PermissionsBitField.Flags.ReadMessageHistory)
  };
}

export function selectCommandMongoDependencies(source: MongoContextExports): CommandMongoDependencies {
  return {
    logger: source.logger,
    env: source.env,
    DEFAULT_CURRENCY: source.DEFAULT_CURRENCY,
    SUPPORTED_CURRENCIES: source.SUPPORTED_CURRENCIES,
    getCurrencyConfig: source.getCurrencyConfig,
    formatPrice: source.formatPrice,
    getGuildSettings: source.getGuildSettings,
    getGuildCacheSize: source.getGuildCacheSize,
    adminAlert: source.adminAlert,
    withMongoRetry: source.withMongoRetry,
    saveFetchSnapshot: source.saveFetchSnapshot,
    loadFetchSnapshot: source.loadFetchSnapshot,
    loadDealsFetchSnapshots: source.loadDealsFetchSnapshots,
    loadSourceHealth: source.loadSourceHealth,
    getOutboxPaused: source.getOutboxPaused,
    setOutboxPaused: source.setOutboxPaused,
    getSystemTimes: source.getSystemTimes,
    saveSystemTime: source.saveSystemTime,
    validateUpdateFetchSnapshot: source.validateUpdateFetchSnapshot,
    validatePendingDiscountSnapshot: source.validatePendingDiscountSnapshot,
    runConcurrent: source.runConcurrent,
    GuildModel: source.GuildModel,
    GuildAuditLogModel: source.GuildAuditLogModel,
    GuildConfigBackupModel: source.GuildConfigBackupModel,
    GuildSuggestedCommandModel: source.GuildSuggestedCommandModel,
    GuildYoutubeErrorModel: source.GuildYoutubeErrorModel,
    GuildDeadLetterModel: source.GuildDeadLetterModel,
    PlayerCountSnapshotModel: source.PlayerCountSnapshotModel,
    PlayerCountHistoryModel: source.PlayerCountHistoryModel,
    ReviewTrendSnapshotModel: source.ReviewTrendSnapshotModel,
    DealPriceSnapshotModel: source.DealPriceSnapshotModel,
    NewAccountAlertDeliveryModel: source.NewAccountAlertDeliveryModel,
    PlayerCountRecordModel: source.PlayerCountRecordModel,
    FeedbackReportModel: source.FeedbackReportModel,
    BugReportModel: source.BugReportModel,
    UserComplaintModel: source.UserComplaintModel,
    GuildSeenDiscountModel: source.GuildSeenDiscountModel,
    GuildSeenUpdateModel: source.GuildSeenUpdateModel,
    GuildSeenYoutubeModel: source.GuildSeenYoutubeModel,
    NotificationOutboxModel: source.NotificationOutboxModel,
    NotificationOutboxSentModel: source.NotificationOutboxSentModel,
    NotificationHistoryModel: source.NotificationHistoryModel,
    NotificationDeadLetterReplayModel: source.NotificationDeadLetterReplayModel,
    OperationJournalModel: source.OperationJournalModel
  };
}

export function selectCommandSourceDependencies(source: SourceRegistryApi): CommandSourceDependencies {
  return {
    MAX_DEALS: source.MAX_DEALS,
    FETCH_CONCURRENCY: source.FETCH_CONCURRENCY,
    cleanText: source.cleanText,
    truncate: source.truncate,
    normalizeTitleForDedupe: source.normalizeTitleForDedupe,
    safeCheerioLoad: source.safeCheerioLoad,
    httpReq: source.httpReq,
    fetchWithProxy: source.fetchWithProxy,
    fetchDeals: source.fetchDeals,
    fetchGameUpdate: source.fetchGameUpdate,
    getLatestForAllGames: source.getLatestForAllGames,
    executeFetchWithCircuitBreaker: source.executeFetchWithCircuitBreaker,
    fetchSteamCurrentPlayers: source.fetchSteamCurrentPlayers,
    fetchSteamLatestUpdateSize: source.fetchSteamLatestUpdateSize,
    searchSteamGameByName: source.searchSteamGameByName,
    chooseBestSteamMatch: source.chooseBestSteamMatch,
    fetchSteamPriceDetails: source.fetchSteamPriceDetails,
    enrichDealData: source.enrichDealData,
    fetchSteamReviewData: source.fetchSteamReviewData,
    extractOfferEndFromHtml: source.extractOfferEndFromHtml,
    extractSteamOfferEndDate: source.extractSteamOfferEndDate,
    cleanEnrichedCache: source.cleanEnrichedCache,
    getEnrichedCacheSize: source.getEnrichedCacheSize,
    dealHash: source.dealHash
  };
}

export function createCommandRuntimeDependencies(input: CommandRuntimeInput): CommandRuntimeDependencies {
  return {
    discord: createDiscordRuntimeBindings(),
    mongo: selectCommandMongoDependencies(input.mongo),
    sources: selectCommandSourceDependencies(input.sources),
    platform: {
      checkReadMessageHistory,
      checkChannelPermissions,
      redis: input.redis,
      redisCache: input.redisCache
    }
  };
}
