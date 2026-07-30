"use strict";

import type { CommandDomainDeps } from "./commandDomainDeps.js";

type DomainKeys<D extends keyof CommandDomainDeps> = readonly (keyof CommandDomainDeps[D])[];

export const GAME_INFO_KEYS: DomainKeys<"game-info"> = [
  "DEFAULT_CURRENCY",
  "MessageFlags",
  "chooseBestSteamMatch",
  "enforceCooldown",
  "enrichDealData",
  "executeFetchWithCircuitBreaker",
  "fetchDeals",
  "fetchGameStatusSummary",
  "fetchSteamCurrentPlayers",
  "fetchSteamLatestUpdateSize",
  "fetchSteamPriceDetails",
  "fetchSteamReviewData",
  "findGameAndSuggestion",
  "formatPrice",
  "getCurrencyConfig",
  "getDealsCacheData",
  "getGuildSettings",
  "httpReq",
  "logger",
  "readDealPriceHistory",
  "readPlayerCountHistory",
  "readPlayerCountRecords",
  "readPlayerCountSnapshots",
  "readReviewTrendHistory",
  "recordDealPriceSnapshots",
  "recordReviewTrendSnapshot",
  "safeCheerioLoad",
  "safeDefer",
  "safeEdit",
  "searchSteamGameByName",
  "setDealsCache",
  "startCommandLog"
];

export const ADMIN_KEYS: DomainKeys<"admin"> = [
  "ChannelLockRecoveryModel",
  "DEFAULT_CURRENCY",
  "GuildAuditLogModel",
  "GuildConfigBackupModel",
  "GuildDeadLetterModel",
  "GuildModel",
  "GuildModerationModel",
  "GuildSecurityModel",
  "GuildYoutubeErrorModel",
  "MessageFlags",
  "NewAccountAlertDeliveryModel",
  "NotificationDeadLetterReplayModel",
  "NotificationOutboxModel",
  "OperationJournalModel",
  "adminAlert",
  "auditBatchIntervalMs",
  "checkChannelPermissions",
  "enforceCooldown",
  "formatUserError",
  "getCacheSizes",
  "getGuildSettings",
  "getOutboxPaused",
  "loadDealsFetchSnapshots",
  "loadFetchSnapshot",
  "loadSourceHealth",
  "logger",
  "redis",
  "safeDefer",
  "safeEdit",
  "scheduleAuditBatch",
  "startCommandLog"
];

export const NOTIFICATIONS_KEYS: DomainKeys<"notifications"> = [
  "CACHE_TTL_MS",
  "COLORS",
  "DEALS_HISTORY_LIMIT",
  "DEFAULT_CURRENCY",
  "DLC_CACHE_MAX_SIZE",
  "DLC_ITEMS_PER_PAGE",
  "EmbedBuilder",
  "GuildModel",
  "MessageFlags",
  "OP_UPDATE_OPTS",
  "SUPPORTED_CURRENCIES",
  "cache",
  "cacheGetLRU",
  "cacheSetLRU",
  "canSendEmbeds",
  "checkChannelPermissions",
  "chooseBestSteamMatch",
  "dealHash",
  "enforceCooldown",
  "fetchDeals",
  "fetchSteamCurrentPlayers",
  "fetchSteamPriceDetails",
  "formatUserError",
  "getCurrencyConfig",
  "getGuildSettings",
  "getLatestForAllGames",
  "handlePagination",
  "httpReq",
  "listMissingChannelPerms",
  "logger",
  "makeActivationId",
  "missingChannelPermsMessage",
  "safeCheerioLoad",
  "safeDefer",
  "safeEdit",
  "searchSteamGameByName",
  "seedBaselineDlc",
  "seedSeenDiscounts",
  "seedSeenUpdates",
  "setDealsCache",
  "startCommandLog",
  "truncate"
];

export const CONFIGURATION_KEYS: DomainKeys<"configuration"> = [
  "DEFAULT_CURRENCY",
  "GuildAuditLogModel",
  "GuildModel",
  "MessageFlags",
  "SUPPORTED_CURRENCIES",
  "checkReadMessageHistory",
  "enforceCooldown",
  "findGameAndSuggestion",
  "formatUserError",
  "getGuildSettings",
  "handlePagination",
  "logger",
  "requireGuildAdmin",
  "safeDefer",
  "safeEdit",
  "startCommandLog"
];

export const CORE_KEYS: DomainKeys<"core"> = [
  "CACHE_TTL_MS",
  "COLORS",
  "COMMAND_OUTPUT_MAX_CHARS",
  "DEFAULT_CURRENCY",
  "EmbedBuilder",
  "GuildAuditLogModel",
  "GuildSuggestedCommandModel",
  "ITEMS_PER_PAGE",
  "MAX_DEALS",
  "MessageFlags",
  "SINGLE_CACHE_MAX_SIZE",
  "adminAlert",
  "buildDealEmbed",
  "buildHelpEmbed",
  "buildSteamPriceEmbed",
  "buildUpdateEmbed",
  "cache",
  "cacheGetLRU",
  "cacheSetLRU",
  "chooseBestSteamMatch",
  "dealPassesFilters",
  "enforceCooldown",
  "enrichDealData",
  "executeFetchWithCircuitBreaker",
  "extractSteamOfferEndDate",
  "fetchDeals",
  "fetchGameStatus",
  "fetchGameStatusSummary",
  "fetchSteamPriceDetails",
  "findGameAndSuggestion",
  "formatUserError",
  "getDealsCacheData",
  "getGuildSettings",
  "getLatestForAllGames",
  "getSystemTimes",
  "getUpdatesCacheData",
  "handlePagination",
  "listBugs",
  "listComplaints",
  "loadFetchSnapshot",
  "logger",
  "removeBug",
  "removeComplaint",
  "requireGuildAdmin",
  "safeDefer",
  "safeEdit",
  "saveBug",
  "saveComplaint",
  "saveSystemTime",
  "searchSteamGameByName",
  "setDealsCache",
  "setUpdatesCache",
  "smoothTime",
  "startCommandLog",
  "validatePendingDiscountSnapshot",
  "validateUpdateFetchSnapshot"
];

export const YOUTUBE_KEYS: DomainKeys<"youtube"> = [
  "GuildYoutubeStateModel",
  "GuildModel",
  "GuildYoutubeErrorModel",
  "MessageFlags",
  "checkChannelPermissions",
  "clearYouTubeErrors",
  "deliverManualYouTubeVideos",
  "env",
  "fetchYouTubeFeed",
  "formatUserError",
  "getGuildSettings",
  "logger",
  "outboxEnabled",
  "prepareManualYouTubeVideos",
  "removeSeenChannel",
  "resolveYouTubeChannel",
  "safeDefer",
  "safeEdit",
  "seedSeenVideos"
];

export const ROUTING_KEYS: DomainKeys<"routing"> = [
  "MessageFlags",
  "getGuildSettings",
  "logger"
];

type Missing<D extends keyof CommandDomainDeps, Listed extends PropertyKey> = Exclude<keyof CommandDomainDeps[D], Listed>;

type GameInfoMissing = Missing<"game-info", (typeof GAME_INFO_KEYS)[number]>;
const gameinfoComplete: [GameInfoMissing] extends [never] ? true : GameInfoMissing = true;
type AdminMissing = Missing<"admin", (typeof ADMIN_KEYS)[number]>;
const adminComplete: [AdminMissing] extends [never] ? true : AdminMissing = true;
type NotificationsMissing = Missing<"notifications", (typeof NOTIFICATIONS_KEYS)[number]>;
const notificationsComplete: [NotificationsMissing] extends [never] ? true : NotificationsMissing = true;
type ConfigurationMissing = Missing<"configuration", (typeof CONFIGURATION_KEYS)[number]>;
const configurationComplete: [ConfigurationMissing] extends [never] ? true : ConfigurationMissing = true;
type CoreMissing = Missing<"core", (typeof CORE_KEYS)[number]>;
const coreComplete: [CoreMissing] extends [never] ? true : CoreMissing = true;
type YoutubeMissing = Missing<"youtube", (typeof YOUTUBE_KEYS)[number]>;
const youtubeComplete: [YoutubeMissing] extends [never] ? true : YoutubeMissing = true;
type RoutingMissing = Missing<"routing", (typeof ROUTING_KEYS)[number]>;
const routingComplete: [RoutingMissing] extends [never] ? true : RoutingMissing = true;

export const DOMAIN_KEY_COVERAGE = [gameinfoComplete, adminComplete, notificationsComplete, configurationComplete, coreComplete, youtubeComplete, routingComplete] as const;

export const COMMAND_DOMAIN_KEYS = {
  "game-info": GAME_INFO_KEYS,
  admin: ADMIN_KEYS,
  notifications: NOTIFICATIONS_KEYS,
  configuration: CONFIGURATION_KEYS,
  core: CORE_KEYS,
  youtube: YOUTUBE_KEYS,
  routing: ROUTING_KEYS,
} as const;
