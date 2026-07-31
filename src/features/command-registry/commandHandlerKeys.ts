"use strict";

import type attachAdminCommandAccessHandler from "../command-handlers/adminCommandAccessHandler.js";
import type attachAuditLogInteractionHandler from "../command-handlers/auditLogInteractionHandler.js";
import type attachAutocompleteInteractionHandler from "../command-handlers/autocompleteInteractionHandler.js";
import type attachBackupInteractionHandler from "../command-handlers/backupInteractionHandler.js";
import type attachBotAddInteractionHandler from "../command-handlers/botAddInteractionHandler.js";
import type attachConfigInteractionHandler from "../command-handlers/configInteractionHandler.js";
import type attachCoverageAliasHandler from "../command-handlers/watchlistCoverageAndAliasHandler.js";
import type attachDealScoreInteractionHandler from "../command-handlers/dealScoreInteractionHandler.js";
import type attachDlcInteractionHandler from "../command-handlers/dlcInteractionHandler.js";
import type attachFallbackInteractionHandler from "../command-handlers/fallbackInteractionHandler.js";
import type attachFutureReleaseInteractionHandler from "../command-handlers/futureReleaseInteractionHandler.js";
import type attachGameFilterHandlers from "../command-handlers/gameFilterHandlers.js";
import type attachGameInfoInteractionHandler from "../command-handlers/gameInfoInteractionHandler.js";
import type attachGameOverviewInteractionHandler from "../command-handlers/gameOverviewInteractionHandler.js";
import type attachGuildConfigurationAdminHandler from "../command-handlers/guildConfigurationAdminHandler.js";
import type attachHealthInteractionHandler from "../command-handlers/healthInteractionHandler.js";
import type attachHelpInteractionHandler from "../command-handlers/helpInteractionHandler.js";
import type attachLatestInteractionHandler from "../command-handlers/latestInteractionHandler.js";
import type attachMaintenanceInteractionHandler from "../command-handlers/maintenanceInteractionHandler.js";
import type attachModerationInteractionHandler from "../command-handlers/moderationInteractionHandler.js";
import type attachPlayerCountAnalyticsHandler from "../command-handlers/playerCountAnalyticsHandler.js";
import type attachPriceAlertInteractionHandler from "../command-handlers/priceAlertInteractionHandler.js";
import type attachPriceCheckInteractionHandler from "../command-handlers/priceCheckInteractionHandler.js";
import type attachReportInteractionHandler from "../command-handlers/reportInteractionHandler.js";
import type attachRolePingHandlers from "../command-handlers/rolePingHandlers.js";
import type attachSecurityInteractionHandler from "../command-handlers/securityInteractionHandler.js";
import type attachSetInteractionHandler from "../command-handlers/setInteractionHandler.js";
import type attachSimpleCommandsHandler from "../command-handlers/simpleCommandsHandler.js";
import type attachSnoozeInteractionHandler from "../command-handlers/snoozeInteractionHandler.js";
import type attachSourcesStatusHandler from "../command-handlers/sourcesStatusHandler.js";
import type attachStatusInteractionHandler from "../command-handlers/statusInteractionHandler.js";
import type attachSubscriptionNotificationHandlers from "../command-handlers/subscriptionNotificationHandlers.js";
import type attachSuggestCommandInteractionHandler from "../command-handlers/suggestCommandInteractionHandler.js";
import type attachTemplatePreviewHandler from "../command-handlers/templateAndNotificationPreviewHandler.js";
import type attachWatchlistGameSuggestionHandler from "../command-handlers/watchlistGameSuggestionHandler.js";
import type attachYouTubeInteractionHandler from "../command-handlers/youtubeInteractionHandler.js";

import type { CommandDomainDeps } from "./commandDomainDeps.js";

type HandlerDeps<T> = T extends { buildCommandHandler: (context: infer D) => unknown } ? D : never;
type Missing<Deps, Listed extends string> = Exclude<Extract<keyof Deps, string>, Listed>;
type Extra<Deps, Listed extends string> = Exclude<Listed, Extract<keyof Deps, string>>;
type Exact<Absente, Straine> = [Absente] extends [never] ? ([Straine] extends [never] ? true : ["chei in plus", Straine]) : ["chei lipsa", Absente];

export const SOURCE_STATUS_HANDLER_KEYS = [
  "MessageFlags",
  "enforceCooldown",
  "loadDealsFetchSnapshots",
  "loadFetchSnapshot",
  "loadSourceHealth",
  "logger",
  "safeDefer",
  "safeEdit",
  "startCommandLog"
] as const;

type SourceStatusMissing = Missing<HandlerDeps<typeof attachSourcesStatusHandler>, (typeof SOURCE_STATUS_HANDLER_KEYS)[number] & string>;
type SourceStatusExtra = Extra<HandlerDeps<typeof attachSourcesStatusHandler>, (typeof SOURCE_STATUS_HANDLER_KEYS)[number] & string>;
const sourceStatusComplete: Exact<SourceStatusMissing, SourceStatusExtra> = true;

export const CONFIGURATION_ADMIN_HANDLER_KEYS = [
  "GuildModerationModel",
  "GuildSecurityModel",
  "GuildYoutubeStateModel",
  "DEFAULT_CURRENCY",
  "GuildAuditLogModel",
  "GuildDeadLetterModel",
  "GuildModel",
  "GuildYoutubeErrorModel",
  "MessageFlags",
  "NotificationDeadLetterReplayModel",
  "OperationJournalModel",
  "checkChannelPermissions",
  "logger",
  "safeDefer",
  "safeEdit"
] as const;

type ConfigurationAdminMissing = Missing<HandlerDeps<typeof attachGuildConfigurationAdminHandler>, (typeof CONFIGURATION_ADMIN_HANDLER_KEYS)[number] & string>;
type ConfigurationAdminExtra = Extra<HandlerDeps<typeof attachGuildConfigurationAdminHandler>, (typeof CONFIGURATION_ADMIN_HANDLER_KEYS)[number] & string>;
const configurationAdminComplete: Exact<ConfigurationAdminMissing, ConfigurationAdminExtra> = true;

export const SECURITY_HANDLER_KEYS = [
  "OperationJournalModel",
  "ChannelLockRecoveryModel",
  "GuildModel",
  "GuildSecurityModel",
  "NewAccountAlertDeliveryModel",
  "checkChannelPermissions",
  "formatUserError",
  "getGuildSettings",
  "logger",
  "safeDefer",
  "safeEdit"
] as const;

type SecurityMissing = Missing<HandlerDeps<typeof attachSecurityInteractionHandler>, (typeof SECURITY_HANDLER_KEYS)[number] & string>;
type SecurityExtra = Extra<HandlerDeps<typeof attachSecurityInteractionHandler>, (typeof SECURITY_HANDLER_KEYS)[number] & string>;
const securityComplete: Exact<SecurityMissing, SecurityExtra> = true;

export const BOT_ADD_HANDLER_KEYS = [
  "GuildModel",
  "getGuildSettings",
  "safeDefer",
  "safeEdit"
] as const;

type BotAddMissing = Missing<HandlerDeps<typeof attachBotAddInteractionHandler>, (typeof BOT_ADD_HANDLER_KEYS)[number] & string>;
type BotAddExtra = Extra<HandlerDeps<typeof attachBotAddInteractionHandler>, (typeof BOT_ADD_HANDLER_KEYS)[number] & string>;
const botAddComplete: Exact<BotAddMissing, BotAddExtra> = true;

export const ADMIN_ACCESS_HANDLER_KEYS = [
  "GuildAuditLogModel",
  "GuildModel",
  "MessageFlags",
  "OperationJournalModel",
  "adminAlert",
  "logger",
  "safeDefer",
  "safeEdit"
] as const;

type AdminAccessMissing = Missing<HandlerDeps<typeof attachAdminCommandAccessHandler>, (typeof ADMIN_ACCESS_HANDLER_KEYS)[number] & string>;
type AdminAccessExtra = Extra<HandlerDeps<typeof attachAdminCommandAccessHandler>, (typeof ADMIN_ACCESS_HANDLER_KEYS)[number] & string>;
const adminAccessComplete: Exact<AdminAccessMissing, AdminAccessExtra> = true;

export const MODERATION_HANDLER_KEYS = [
  "OperationJournalModel",
  "GuildModel",
  "GuildModerationModel",
  "MessageFlags",
  "getGuildSettings",
  "logger",
  "safeDefer",
  "safeEdit"
] as const;

type ModerationMissing = Missing<HandlerDeps<typeof attachModerationInteractionHandler>, (typeof MODERATION_HANDLER_KEYS)[number] & string>;
type ModerationExtra = Extra<HandlerDeps<typeof attachModerationInteractionHandler>, (typeof MODERATION_HANDLER_KEYS)[number] & string>;
const moderationComplete: Exact<ModerationMissing, ModerationExtra> = true;

export const BACKUP_HANDLER_KEYS = [
  "GuildModerationModel",
  "GuildSecurityModel",
  "GuildYoutubeStateModel",
  "GuildAuditLogModel",
  "GuildConfigBackupModel",
  "GuildModel",
  "MessageFlags",
  "OperationJournalModel",
  "formatUserError",
  "getGuildSettings",
  "logger",
  "safeDefer",
  "safeEdit"
] as const;

type BackupMissing = Missing<HandlerDeps<typeof attachBackupInteractionHandler>, (typeof BACKUP_HANDLER_KEYS)[number] & string>;
type BackupExtra = Extra<HandlerDeps<typeof attachBackupInteractionHandler>, (typeof BACKUP_HANDLER_KEYS)[number] & string>;
const backupComplete: Exact<BackupMissing, BackupExtra> = true;

export const AUDIT_LOG_HANDLER_KEYS = [
  "GuildAuditLogModel",
  "MessageFlags",
  "auditBatchIntervalMs",
  "logger",
  "safeDefer",
  "safeEdit",
  "scheduleAuditBatch"
] as const;

type AuditLogMissing = Missing<HandlerDeps<typeof attachAuditLogInteractionHandler>, (typeof AUDIT_LOG_HANDLER_KEYS)[number] & string>;
type AuditLogExtra = Extra<HandlerDeps<typeof attachAuditLogInteractionHandler>, (typeof AUDIT_LOG_HANDLER_KEYS)[number] & string>;
const auditLogComplete: Exact<AuditLogMissing, AuditLogExtra> = true;

export const MAINTENANCE_HANDLER_KEYS = [
  "ChannelLockRecoveryModel",
  "GuildConfigBackupModel",
  "GuildDeadLetterModel",
  "GuildYoutubeErrorModel",
  "MessageFlags",
  "NewAccountAlertDeliveryModel",
  "NotificationOutboxModel",
  "enforceCooldown",
  "getGuildSettings",
  "getOutboxPaused",
  "logger",
  "safeDefer",
  "safeEdit",
  "startCommandLog"
] as const;

type MaintenanceMissing = Missing<HandlerDeps<typeof attachMaintenanceInteractionHandler>, (typeof MAINTENANCE_HANDLER_KEYS)[number] & string>;
type MaintenanceExtra = Extra<HandlerDeps<typeof attachMaintenanceInteractionHandler>, (typeof MAINTENANCE_HANDLER_KEYS)[number] & string>;
const maintenanceComplete: Exact<MaintenanceMissing, MaintenanceExtra> = true;

export const HEALTH_HANDLER_KEYS = [
  "GuildModel",
  "MessageFlags",
  "enforceCooldown",
  "getCacheSizes",
  "logger",
  "redis",
  "safeDefer",
  "safeEdit",
  "startCommandLog"
] as const;

type HealthMissing = Missing<HandlerDeps<typeof attachHealthInteractionHandler>, (typeof HEALTH_HANDLER_KEYS)[number] & string>;
type HealthExtra = Extra<HandlerDeps<typeof attachHealthInteractionHandler>, (typeof HEALTH_HANDLER_KEYS)[number] & string>;
const healthComplete: Exact<HealthMissing, HealthExtra> = true;

export const SUGGEST_COMMAND_HANDLER_KEYS = [
  "GuildAuditLogModel",
  "GuildSuggestedCommandModel",
  "MessageFlags",
  "enforceCooldown",
  "logger",
  "requireGuildAdmin",
  "safeDefer",
  "safeEdit"
] as const;

type SuggestCommandMissing = Missing<HandlerDeps<typeof attachSuggestCommandInteractionHandler>, (typeof SUGGEST_COMMAND_HANDLER_KEYS)[number] & string>;
type SuggestCommandExtra = Extra<HandlerDeps<typeof attachSuggestCommandInteractionHandler>, (typeof SUGGEST_COMMAND_HANDLER_KEYS)[number] & string>;
const suggestCommandComplete: Exact<SuggestCommandMissing, SuggestCommandExtra> = true;

export const REPORT_HANDLER_KEYS = [
  "MessageFlags",
  "adminAlert",
  "enforceCooldown",
  "findGameAndSuggestion",
  "handlePagination",
  "listBugs",
  "listComplaints",
  "logger",
  "removeBug",
  "removeComplaint",
  "safeDefer",
  "safeEdit",
  "saveBug",
  "saveComplaint"
] as const;

type ReportMissing = Missing<HandlerDeps<typeof attachReportInteractionHandler>, (typeof REPORT_HANDLER_KEYS)[number] & string>;
type ReportExtra = Extra<HandlerDeps<typeof attachReportInteractionHandler>, (typeof REPORT_HANDLER_KEYS)[number] & string>;
const reportComplete: Exact<ReportMissing, ReportExtra> = true;

export const STATUS_HANDLER_KEYS = [
  "MessageFlags",
  "enforceCooldown",
  "fetchGameStatus",
  "fetchGameStatusSummary",
  "findGameAndSuggestion",
  "getGuildSettings",
  "handlePagination",
  "logger",
  "safeDefer",
  "safeEdit",
  "startCommandLog"
] as const;

type StatusMissing = Missing<HandlerDeps<typeof attachStatusInteractionHandler>, (typeof STATUS_HANDLER_KEYS)[number] & string>;
type StatusExtra = Extra<HandlerDeps<typeof attachStatusInteractionHandler>, (typeof STATUS_HANDLER_KEYS)[number] & string>;
const statusComplete: Exact<StatusMissing, StatusExtra> = true;

export const LATEST_HANDLER_KEYS = [
  "CACHE_TTL_MS",
  "DEFAULT_CURRENCY",
  "ITEMS_PER_PAGE",
  "MAX_DEALS",
  "MessageFlags",
  "SINGLE_CACHE_MAX_SIZE",
  "buildDealEmbed",
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
  "fetchSteamPriceDetails",
  "findGameAndSuggestion",
  "formatUserError",
  "getDealsCacheData",
  "getGuildSettings",
  "getLatestForAllGames",
  "getSystemTimes",
  "getUpdatesCacheData",
  "handlePagination",
  "loadFetchSnapshot",
  "logger",
  "safeDefer",
  "safeEdit",
  "saveSystemTime",
  "searchSteamGameByName",
  "setDealsCache",
  "setUpdatesCache",
  "smoothTime",
  "startCommandLog",
  "validatePendingDiscountSnapshot",
  "validateUpdateFetchSnapshot"
] as const;

type LatestMissing = Missing<HandlerDeps<typeof attachLatestInteractionHandler>, (typeof LATEST_HANDLER_KEYS)[number] & string>;
type LatestExtra = Extra<HandlerDeps<typeof attachLatestInteractionHandler>, (typeof LATEST_HANDLER_KEYS)[number] & string>;
const latestComplete: Exact<LatestMissing, LatestExtra> = true;

export const SIMPLE_HANDLER_KEYS = [
  "COMMAND_OUTPUT_MAX_CHARS",
  "MessageFlags",
  "logger"
] as const;

type SimpleMissing = Missing<HandlerDeps<typeof attachSimpleCommandsHandler>, (typeof SIMPLE_HANDLER_KEYS)[number] & string>;
type SimpleExtra = Extra<HandlerDeps<typeof attachSimpleCommandsHandler>, (typeof SIMPLE_HANDLER_KEYS)[number] & string>;
const simpleComplete: Exact<SimpleMissing, SimpleExtra> = true;

export const HELP_HANDLER_KEYS = [
  "COLORS",
  "EmbedBuilder",
  "MessageFlags",
  "buildHelpEmbed",
  "logger"
] as const;

type HelpMissing = Missing<HandlerDeps<typeof attachHelpInteractionHandler>, (typeof HELP_HANDLER_KEYS)[number] & string>;
type HelpExtra = Extra<HandlerDeps<typeof attachHelpInteractionHandler>, (typeof HELP_HANDLER_KEYS)[number] & string>;
const helpComplete: Exact<HelpMissing, HelpExtra> = true;

export const PLAYER_COUNT_HANDLER_KEYS = [
  "MessageFlags",
  "enforceCooldown",
  "fetchSteamCurrentPlayers",
  "findGameAndSuggestion",
  "getGuildSettings",
  "logger",
  "readPlayerCountHistory",
  "readPlayerCountRecords",
  "readPlayerCountSnapshots",
  "safeDefer",
  "safeEdit"
] as const;

type PlayerCountMissing = Missing<HandlerDeps<typeof attachPlayerCountAnalyticsHandler>, (typeof PLAYER_COUNT_HANDLER_KEYS)[number] & string>;
type PlayerCountExtra = Extra<HandlerDeps<typeof attachPlayerCountAnalyticsHandler>, (typeof PLAYER_COUNT_HANDLER_KEYS)[number] & string>;
const playerCountComplete: Exact<PlayerCountMissing, PlayerCountExtra> = true;

export const GAME_OVERVIEW_HANDLER_KEYS = [
  "DEFAULT_CURRENCY",
  "MessageFlags",
  "enforceCooldown",
  "executeFetchWithCircuitBreaker",
  "fetchDeals",
  "fetchGameStatusSummary",
  "fetchSteamCurrentPlayers",
  "findGameAndSuggestion",
  "formatPrice",
  "getCurrencyConfig",
  "getDealsCacheData",
  "getGuildSettings",
  "httpReq",
  "logger",
  "safeCheerioLoad",
  "safeDefer",
  "safeEdit",
  "setDealsCache"
] as const;

type GameOverviewMissing = Missing<HandlerDeps<typeof attachGameOverviewInteractionHandler>, (typeof GAME_OVERVIEW_HANDLER_KEYS)[number] & string>;
type GameOverviewExtra = Extra<HandlerDeps<typeof attachGameOverviewInteractionHandler>, (typeof GAME_OVERVIEW_HANDLER_KEYS)[number] & string>;
const gameOverviewComplete: Exact<GameOverviewMissing, GameOverviewExtra> = true;

export const COVERAGE_ALIAS_HANDLER_KEYS = [
  "GuildModel",
  "MessageFlags",
  "findGameAndSuggestion",
  "getGuildSettings",
  "handlePagination",
  "logger",
  "safeDefer",
  "safeEdit"
] as const;

type CoverageAliasMissing = Missing<HandlerDeps<typeof attachCoverageAliasHandler>, (typeof COVERAGE_ALIAS_HANDLER_KEYS)[number] & string>;
type CoverageAliasExtra = Extra<HandlerDeps<typeof attachCoverageAliasHandler>, (typeof COVERAGE_ALIAS_HANDLER_KEYS)[number] & string>;
const coverageAliasComplete: Exact<CoverageAliasMissing, CoverageAliasExtra> = true;

export const CONFIGURATION_HANDLER_KEYS = [
  "DEFAULT_CURRENCY",
  "MessageFlags",
  "enforceCooldown",
  "getGuildSettings",
  "logger",
  "safeDefer",
  "safeEdit",
  "startCommandLog"
] as const;

type ConfigurationMissing = Missing<HandlerDeps<typeof attachConfigInteractionHandler>, (typeof CONFIGURATION_HANDLER_KEYS)[number] & string>;
type ConfigurationExtra = Extra<HandlerDeps<typeof attachConfigInteractionHandler>, (typeof CONFIGURATION_HANDLER_KEYS)[number] & string>;
const configurationComplete: Exact<ConfigurationMissing, ConfigurationExtra> = true;

export const WATCHLIST_SUGGESTION_HANDLER_KEYS = [
  "GuildAuditLogModel",
  "GuildModel",
  "MessageFlags",
  "enforceCooldown",
  "getGuildSettings",
  "logger",
  "requireGuildAdmin",
  "safeDefer",
  "safeEdit"
] as const;

type WatchlistSuggestionMissing = Missing<HandlerDeps<typeof attachWatchlistGameSuggestionHandler>, (typeof WATCHLIST_SUGGESTION_HANDLER_KEYS)[number] & string>;
type WatchlistSuggestionExtra = Extra<HandlerDeps<typeof attachWatchlistGameSuggestionHandler>, (typeof WATCHLIST_SUGGESTION_HANDLER_KEYS)[number] & string>;
const watchlistSuggestionComplete: Exact<WatchlistSuggestionMissing, WatchlistSuggestionExtra> = true;

export const PRICE_CHECK_HANDLER_KEYS = [
  "DEFAULT_CURRENCY",
  "MessageFlags",
  "chooseBestSteamMatch",
  "enforceCooldown",
  "fetchDeals",
  "fetchSteamPriceDetails",
  "formatPrice",
  "getDealsCacheData",
  "getGuildSettings",
  "logger",
  "safeDefer",
  "safeEdit",
  "searchSteamGameByName",
  "setDealsCache",
  "startCommandLog"
] as const;

type PriceCheckMissing = Missing<HandlerDeps<typeof attachPriceCheckInteractionHandler>, (typeof PRICE_CHECK_HANDLER_KEYS)[number] & string>;
type PriceCheckExtra = Extra<HandlerDeps<typeof attachPriceCheckInteractionHandler>, (typeof PRICE_CHECK_HANDLER_KEYS)[number] & string>;
const priceCheckComplete: Exact<PriceCheckMissing, PriceCheckExtra> = true;

export const DEAL_SCORE_HANDLER_KEYS = [
  "DEFAULT_CURRENCY",
  "MessageFlags",
  "enforceCooldown",
  "fetchDeals",
  "formatPrice",
  "getDealsCacheData",
  "getGuildSettings",
  "logger",
  "readDealPriceHistory",
  "recordDealPriceSnapshots",
  "safeDefer",
  "safeEdit",
  "setDealsCache",
  "startCommandLog"
] as const;

type DealScoreMissing = Missing<HandlerDeps<typeof attachDealScoreInteractionHandler>, (typeof DEAL_SCORE_HANDLER_KEYS)[number] & string>;
type DealScoreExtra = Extra<HandlerDeps<typeof attachDealScoreInteractionHandler>, (typeof DEAL_SCORE_HANDLER_KEYS)[number] & string>;
const dealScoreComplete: Exact<DealScoreMissing, DealScoreExtra> = true;

export const GAME_INFO_HANDLER_KEYS = [
  "DEFAULT_CURRENCY",
  "MessageFlags",
  "chooseBestSteamMatch",
  "enforceCooldown",
  "enrichDealData",
  "fetchDeals",
  "fetchSteamCurrentPlayers",
  "fetchSteamLatestUpdateSize",
  "fetchSteamPriceDetails",
  "fetchSteamReviewData",
  "formatPrice",
  "getDealsCacheData",
  "getGuildSettings",
  "logger",
  "readPlayerCountHistory",
  "readPlayerCountSnapshots",
  "readReviewTrendHistory",
  "recordReviewTrendSnapshot",
  "safeCheerioLoad",
  "safeDefer",
  "safeEdit",
  "searchSteamGameByName",
  "setDealsCache",
  "startCommandLog"
] as const;

type GameInfoMissing = Missing<HandlerDeps<typeof attachGameInfoInteractionHandler>, (typeof GAME_INFO_HANDLER_KEYS)[number] & string>;
type GameInfoExtra = Extra<HandlerDeps<typeof attachGameInfoInteractionHandler>, (typeof GAME_INFO_HANDLER_KEYS)[number] & string>;
const gameInfoComplete: Exact<GameInfoMissing, GameInfoExtra> = true;

export const SNOOZE_HANDLER_KEYS = [
  "GuildModel",
  "MessageFlags",
  "logger",
  "safeDefer",
  "safeEdit"
] as const;

type SnoozeMissing = Missing<HandlerDeps<typeof attachSnoozeInteractionHandler>, (typeof SNOOZE_HANDLER_KEYS)[number] & string>;
type SnoozeExtra = Extra<HandlerDeps<typeof attachSnoozeInteractionHandler>, (typeof SNOOZE_HANDLER_KEYS)[number] & string>;
const snoozeComplete: Exact<SnoozeMissing, SnoozeExtra> = true;

export const SET_HANDLER_KEYS = [
  "GuildModel",
  "MessageFlags",
  "SUPPORTED_CURRENCIES",
  "checkReadMessageHistory",
  "formatUserError",
  "getGuildSettings",
  "logger",
  "safeDefer",
  "safeEdit"
] as const;

type SetMissing = Missing<HandlerDeps<typeof attachSetInteractionHandler>, (typeof SET_HANDLER_KEYS)[number] & string>;
type SetExtra = Extra<HandlerDeps<typeof attachSetInteractionHandler>, (typeof SET_HANDLER_KEYS)[number] & string>;
const setComplete: Exact<SetMissing, SetExtra> = true;

export const ROLE_PING_HANDLER_KEYS = [
  "GuildModel",
  "MessageFlags",
  "formatUserError",
  "logger",
  "safeDefer",
  "safeEdit"
] as const;

type RolePingMissing = Missing<HandlerDeps<typeof attachRolePingHandlers>, (typeof ROLE_PING_HANDLER_KEYS)[number] & string>;
type RolePingExtra = Extra<HandlerDeps<typeof attachRolePingHandlers>, (typeof ROLE_PING_HANDLER_KEYS)[number] & string>;
const rolePingComplete: Exact<RolePingMissing, RolePingExtra> = true;

export const GAME_FILTER_HANDLER_KEYS = [
  "GuildModel",
  "MessageFlags",
  "formatUserError",
  "getGuildSettings",
  "logger",
  "safeDefer",
  "safeEdit"
] as const;

type GameFilterMissing = Missing<HandlerDeps<typeof attachGameFilterHandlers>, (typeof GAME_FILTER_HANDLER_KEYS)[number] & string>;
type GameFilterExtra = Extra<HandlerDeps<typeof attachGameFilterHandlers>, (typeof GAME_FILTER_HANDLER_KEYS)[number] & string>;
const gameFilterComplete: Exact<GameFilterMissing, GameFilterExtra> = true;

export const TEMPLATE_PREVIEW_HANDLER_KEYS = [
  "GuildModel",
  "MessageFlags",
  "getGuildSettings",
  "logger",
  "safeDefer",
  "safeEdit"
] as const;

type TemplatePreviewMissing = Missing<HandlerDeps<typeof attachTemplatePreviewHandler>, (typeof TEMPLATE_PREVIEW_HANDLER_KEYS)[number] & string>;
type TemplatePreviewExtra = Extra<HandlerDeps<typeof attachTemplatePreviewHandler>, (typeof TEMPLATE_PREVIEW_HANDLER_KEYS)[number] & string>;
const templatePreviewComplete: Exact<TemplatePreviewMissing, TemplatePreviewExtra> = true;

export const DLC_HANDLER_KEYS = [
  "CACHE_TTL_MS",
  "COLORS",
  "DEFAULT_CURRENCY",
  "DLC_CACHE_MAX_SIZE",
  "DLC_ITEMS_PER_PAGE",
  "EmbedBuilder",
  "MessageFlags",
  "cache",
  "cacheGetLRU",
  "cacheSetLRU",
  "chooseBestSteamMatch",
  "enforceCooldown",
  "fetchSteamPriceDetails",
  "getCurrencyConfig",
  "getGuildSettings",
  "handlePagination",
  "httpReq",
  "logger",
  "safeCheerioLoad",
  "safeDefer",
  "safeEdit",
  "searchSteamGameByName",
  "startCommandLog",
  "truncate"
] as const;

type DlcMissing = Missing<HandlerDeps<typeof attachDlcInteractionHandler>, (typeof DLC_HANDLER_KEYS)[number] & string>;
type DlcExtra = Extra<HandlerDeps<typeof attachDlcInteractionHandler>, (typeof DLC_HANDLER_KEYS)[number] & string>;
const dlcComplete: Exact<DlcMissing, DlcExtra> = true;

export const PRICE_ALERT_HANDLER_KEYS = [
  "GuildModel",
  "MessageFlags",
  "SUPPORTED_CURRENCIES",
  "formatUserError",
  "getGuildSettings",
  "logger",
  "safeDefer",
  "safeEdit"
] as const;

type PriceAlertMissing = Missing<HandlerDeps<typeof attachPriceAlertInteractionHandler>, (typeof PRICE_ALERT_HANDLER_KEYS)[number] & string>;
type PriceAlertExtra = Extra<HandlerDeps<typeof attachPriceAlertInteractionHandler>, (typeof PRICE_ALERT_HANDLER_KEYS)[number] & string>;
const priceAlertComplete: Exact<PriceAlertMissing, PriceAlertExtra> = true;

export const FUTURE_RELEASE_HANDLER_KEYS = [
  "GuildModel",
  "MessageFlags",
  "canSendEmbeds",
  "checkChannelPermissions",
  "getGuildSettings",
  "listMissingChannelPerms",
  "logger",
  "makeActivationId",
  "missingChannelPermsMessage",
  "safeDefer",
  "safeEdit"
] as const;

type FutureReleaseMissing = Missing<HandlerDeps<typeof attachFutureReleaseInteractionHandler>, (typeof FUTURE_RELEASE_HANDLER_KEYS)[number] & string>;
type FutureReleaseExtra = Extra<HandlerDeps<typeof attachFutureReleaseInteractionHandler>, (typeof FUTURE_RELEASE_HANDLER_KEYS)[number] & string>;
const futureReleaseComplete: Exact<FutureReleaseMissing, FutureReleaseExtra> = true;

export const YOUTUBE_HANDLER_KEYS = [
  "OperationJournalModel",
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
] as const;

type YoutubeMissing = Missing<HandlerDeps<typeof attachYouTubeInteractionHandler>, (typeof YOUTUBE_HANDLER_KEYS)[number] & string>;
type YoutubeExtra = Extra<HandlerDeps<typeof attachYouTubeInteractionHandler>, (typeof YOUTUBE_HANDLER_KEYS)[number] & string>;
const youtubeComplete: Exact<YoutubeMissing, YoutubeExtra> = true;

export const SUBSCRIPTION_HANDLER_KEYS = [
  "DEALS_HISTORY_LIMIT",
  "DEFAULT_CURRENCY",
  "GuildModel",
  "MessageFlags",
  "OP_UPDATE_OPTS",
  "canSendEmbeds",
  "dealHash",
  "fetchDeals",
  "fetchSteamCurrentPlayers",
  "formatUserError",
  "getGuildSettings",
  "getLatestForAllGames",
  "listMissingChannelPerms",
  "logger",
  "makeActivationId",
  "missingChannelPermsMessage",
  "safeDefer",
  "safeEdit",
  "seedBaselineDlc",
  "seedSeenDiscounts",
  "seedSeenUpdates",
  "setDealsCache"
] as const;

type SubscriptionMissing = Missing<HandlerDeps<typeof attachSubscriptionNotificationHandlers>, (typeof SUBSCRIPTION_HANDLER_KEYS)[number] & string>;
type SubscriptionExtra = Extra<HandlerDeps<typeof attachSubscriptionNotificationHandlers>, (typeof SUBSCRIPTION_HANDLER_KEYS)[number] & string>;
const subscriptionComplete: Exact<SubscriptionMissing, SubscriptionExtra> = true;

export const AUTOCOMPLETE_HANDLER_KEYS = [
  "getGuildSettings",
  "logger"
] as const;

type AutocompleteMissing = Missing<HandlerDeps<typeof attachAutocompleteInteractionHandler>, (typeof AUTOCOMPLETE_HANDLER_KEYS)[number] & string>;
type AutocompleteExtra = Extra<HandlerDeps<typeof attachAutocompleteInteractionHandler>, (typeof AUTOCOMPLETE_HANDLER_KEYS)[number] & string>;
const autocompleteComplete: Exact<AutocompleteMissing, AutocompleteExtra> = true;

export const FALLBACK_HANDLER_KEYS = [
  "MessageFlags",
  "logger"
] as const;

type FallbackMissing = Missing<HandlerDeps<typeof attachFallbackInteractionHandler>, (typeof FALLBACK_HANDLER_KEYS)[number] & string>;
type FallbackExtra = Extra<HandlerDeps<typeof attachFallbackInteractionHandler>, (typeof FALLBACK_HANDLER_KEYS)[number] & string>;
const fallbackComplete: Exact<FallbackMissing, FallbackExtra> = true;

export const HANDLER_KEY_COVERAGE = [sourceStatusComplete, configurationAdminComplete, securityComplete, botAddComplete, adminAccessComplete, moderationComplete, backupComplete, auditLogComplete, maintenanceComplete, healthComplete, suggestCommandComplete, reportComplete, statusComplete, latestComplete, simpleComplete, helpComplete, playerCountComplete, gameOverviewComplete, coverageAliasComplete, configurationComplete, watchlistSuggestionComplete, priceCheckComplete, dealScoreComplete, gameInfoComplete, snoozeComplete, setComplete, rolePingComplete, gameFilterComplete, templatePreviewComplete, dlcComplete, priceAlertComplete, futureReleaseComplete, youtubeComplete, subscriptionComplete, autocompleteComplete, fallbackComplete] as const;
