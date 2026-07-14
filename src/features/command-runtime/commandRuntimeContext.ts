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

type MongoContextExports = typeof import("../../infra/mongo/mongoContext.js")["default"];

import data from "../../infra/mongo/mongoContext.js";
import scrapers from "../../sources/sourceRegistry.js";
import redis from "../../infra/redis/redisContext.js";

type DiscordRuntimeBindings = {
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
}

function createDiscordRuntimeBindings(): DiscordRuntimeBindings {
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

async function resolvePermissionsFor(interaction: PermissionAwareInteraction, channelId: string): Promise<{ has(flag: unknown): boolean } | null> {
  try {
    const guild = interaction?.guild;
    const me = guild?.members?.me;
    if (!me || !guild?.channels) return null;
    const cached = guild.channels.cache?.get(channelId);
    const channel = (cached ?? (typeof guild.channels.fetch === "function"
      ? await guild.channels.fetch(channelId).catch(() => null)
      : null)) as PermissionAwareChannel | null;
    if (!channel || typeof channel.permissionsFor !== "function") return null;
    return channel.permissionsFor(me);
  } catch {
    return null;
  }
}

async function checkReadMessageHistory(interaction: PermissionAwareInteraction, channelId: string): Promise<boolean | null> {
  const perms = await resolvePermissionsFor(interaction, channelId);
  return perms ? perms.has(PermissionsBitField.Flags.ReadMessageHistory) : null;
}

async function checkChannelPermissions(interaction: PermissionAwareInteraction, channelId: string): Promise<ChannelPermissions | null> {
  const perms = await resolvePermissionsFor(interaction, channelId);
  if (!perms) return null;
  return {
    viewChannel: perms.has(PermissionsBitField.Flags.ViewChannel),
    sendMessages: perms.has(PermissionsBitField.Flags.SendMessages),
    embedLinks: perms.has(PermissionsBitField.Flags.EmbedLinks),
    readMessageHistory: perms.has(PermissionsBitField.Flags.ReadMessageHistory)
  };
}

type CommandMongoKey =
  | "logger" | "env" | "DEFAULT_CURRENCY" | "SUPPORTED_CURRENCIES" | "getCurrencyConfig" | "formatPrice"
  | "getGuildSettings" | "invalidateGuildCache" | "getGuildCacheSize" | "adminAlert" | "withMongoRetry"
  | "saveFetchSnapshot" | "loadFetchSnapshot" | "loadDealsFetchSnapshots" | "loadSourceHealth"
  | "getOutboxPaused" | "setOutboxPaused" | "getSystemTimes" | "saveSystemTime"
  | "validateUpdateFetchSnapshot" | "validatePendingDiscountSnapshot"
  | "GuildModel" | "GuildAuditLogModel" | "GuildConfigBackupModel" | "GuildSuggestedCommandModel"
  | "GuildYoutubeErrorModel" | "GuildDeadLetterModel" | "PlayerCountSnapshotModel" | "PlayerCountHistoryModel"
  | "PlayerCountRecordModel" | "FeedbackReportModel" | "BugReportModel" | "UserComplaintModel"
  | "GuildSeenDiscountModel" | "GuildSeenUpdateModel" | "GuildSeenYoutubeModel"
  | "NotificationOutboxModel" | "NotificationOutboxSentModel" | "NotificationHistoryModel"
  | "NotificationDeadLetterReplayModel" | "OperationJournalModel" | "runConcurrent";

type CommandSourceKey =
  | "MAX_DEALS" | "FETCH_CONCURRENCY"
  | "cleanText" | "truncate" | "normalizeTitleForDedupe" | "safeCheerioLoad" | "httpReq" | "fetchWithProxy"
  | "fetchDeals" | "fetchGameUpdate" | "getLatestForAllGames" | "executeFetchWithCircuitBreaker"
  | "fetchSteamCurrentPlayers" | "searchSteamGameByName" | "chooseBestSteamMatch" | "fetchSteamPriceDetails"
  | "enrichDealData" | "fetchSteamReviewData" | "extractOfferEndFromHtml" | "extractSteamOfferEndDate"
  | "cleanEnrichedCache" | "getEnrichedCacheSize" | "dealHash";

type CommandRuntimeContext = DiscordRuntimeBindings & Pick<MongoContextExports, CommandMongoKey> & Pick<SourceRegistryApi, CommandSourceKey> & {
  checkReadMessageHistory: typeof checkReadMessageHistory;
  checkChannelPermissions: typeof checkChannelPermissions;
  redis: typeof redis;
};

function selectCommandMongoExports(source: MongoContextExports): Pick<MongoContextExports, CommandMongoKey> {
  return {
    logger: source.logger,
    env: source.env,
    DEFAULT_CURRENCY: source.DEFAULT_CURRENCY,
    SUPPORTED_CURRENCIES: source.SUPPORTED_CURRENCIES,
    getCurrencyConfig: source.getCurrencyConfig,
    formatPrice: source.formatPrice,
    getGuildSettings: source.getGuildSettings,
    invalidateGuildCache: source.invalidateGuildCache,
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

function selectCommandSourceApi(source: SourceRegistryApi): Pick<SourceRegistryApi, CommandSourceKey> {
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

function createCommandRuntimeContext(): CommandRuntimeContext {
  return {
    ...createDiscordRuntimeBindings(),
    ...selectCommandMongoExports(data),
    ...selectCommandSourceApi(scrapers),
    checkReadMessageHistory,
    checkChannelPermissions,
    redis
  };
}

export default Object.assign(createCommandRuntimeContext, {
  createCommandRuntimeContext,
  createDiscordRuntimeBindings,
  checkChannelPermissions,
  checkReadMessageHistory
});
