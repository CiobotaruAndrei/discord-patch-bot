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
type HandlerKeys<D extends keyof CommandDomainDeps> = readonly (keyof CommandDomainDeps[D])[];
type Missing<Deps, Listed extends string> = Exclude<Extract<keyof Deps, string>, Listed>;

export const SOURCE_STATUS_HANDLER_KEYS: HandlerKeys<"admin"> = [
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
const sourceStatusComplete: [SourceStatusMissing] extends [never] ? true : SourceStatusMissing = true;

export const CONFIGURATION_ADMIN_HANDLER_KEYS: HandlerKeys<"admin"> = [
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
const configurationAdminComplete: [ConfigurationAdminMissing] extends [never] ? true : ConfigurationAdminMissing = true;

export const SECURITY_HANDLER_KEYS: HandlerKeys<"admin"> = [
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
const securityComplete: [SecurityMissing] extends [never] ? true : SecurityMissing = true;

export const BOT_ADD_HANDLER_KEYS: HandlerKeys<"admin"> = [
  "GuildModel",
  "getGuildSettings",
  "safeDefer",
  "safeEdit"
] as const;

type BotAddMissing = Missing<HandlerDeps<typeof attachBotAddInteractionHandler>, (typeof BOT_ADD_HANDLER_KEYS)[number] & string>;
const botAddComplete: [BotAddMissing] extends [never] ? true : BotAddMissing = true;

export const ADMIN_ACCESS_HANDLER_KEYS: HandlerKeys<"admin"> = [
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
const adminAccessComplete: [AdminAccessMissing] extends [never] ? true : AdminAccessMissing = true;

export const MODERATION_HANDLER_KEYS: HandlerKeys<"admin"> = [
  "GuildModel",
  "GuildModerationModel",
  "MessageFlags",
  "getGuildSettings",
  "logger",
  "safeDefer",
  "safeEdit"
] as const;

type ModerationMissing = Missing<HandlerDeps<typeof attachModerationInteractionHandler>, (typeof MODERATION_HANDLER_KEYS)[number] & string>;
const moderationComplete: [ModerationMissing] extends [never] ? true : ModerationMissing = true;

export const BACKUP_HANDLER_KEYS: HandlerKeys<"admin"> = [
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
const backupComplete: [BackupMissing] extends [never] ? true : BackupMissing = true;

export const AUDIT_LOG_HANDLER_KEYS: HandlerKeys<"admin"> = [
  "GuildAuditLogModel",
  "MessageFlags",
  "auditBatchIntervalMs",
  "logger",
  "safeDefer",
  "safeEdit",
  "scheduleAuditBatch"
] as const;

type AuditLogMissing = Missing<HandlerDeps<typeof attachAuditLogInteractionHandler>, (typeof AUDIT_LOG_HANDLER_KEYS)[number] & string>;
const auditLogComplete: [AuditLogMissing] extends [never] ? true : AuditLogMissing = true;

export const MAINTENANCE_HANDLER_KEYS: HandlerKeys<"admin"> = [
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
const maintenanceComplete: [MaintenanceMissing] extends [never] ? true : MaintenanceMissing = true;

export const HEALTH_HANDLER_KEYS: HandlerKeys<"admin"> = [
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
const healthComplete: [HealthMissing] extends [never] ? true : HealthMissing = true;

export const SUGGEST_COMMAND_HANDLER_KEYS: HandlerKeys<"core"> = [
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
const suggestCommandComplete: [SuggestCommandMissing] extends [never] ? true : SuggestCommandMissing = true;

export const REPORT_HANDLER_KEYS: HandlerKeys<"core"> = [
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
const reportComplete: [ReportMissing] extends [never] ? true : ReportMissing = true;

export const STATUS_HANDLER_KEYS: HandlerKeys<"core"> = [
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
const statusComplete: [StatusMissing] extends [never] ? true : StatusMissing = true;

export const LATEST_HANDLER_KEYS: HandlerKeys<"core"> = [
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
const latestComplete: [LatestMissing] extends [never] ? true : LatestMissing = true;

export const SIMPLE_HANDLER_KEYS: HandlerKeys<"core"> = [
  "COMMAND_OUTPUT_MAX_CHARS",
  "MessageFlags",
  "logger"
] as const;

type SimpleMissing = Missing<HandlerDeps<typeof attachSimpleCommandsHandler>, (typeof SIMPLE_HANDLER_KEYS)[number] & string>;
const simpleComplete: [SimpleMissing] extends [never] ? true : SimpleMissing = true;

export const HELP_HANDLER_KEYS: HandlerKeys<"core"> = [
  "COLORS",
  "EmbedBuilder",
  "MessageFlags",
  "buildHelpEmbed",
  "logger"
] as const;

type HelpMissing = Missing<HandlerDeps<typeof attachHelpInteractionHandler>, (typeof HELP_HANDLER_KEYS)[number] & string>;
const helpComplete: [HelpMissing] extends [never] ? true : HelpMissing = true;

export const PLAYER_COUNT_HANDLER_KEYS: HandlerKeys<"game-info"> = [
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
const playerCountComplete: [PlayerCountMissing] extends [never] ? true : PlayerCountMissing = true;

export const GAME_OVERVIEW_HANDLER_KEYS: HandlerKeys<"game-info"> = [
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
const gameOverviewComplete: [GameOverviewMissing] extends [never] ? true : GameOverviewMissing = true;

export const COVERAGE_ALIAS_HANDLER_KEYS: HandlerKeys<"configuration"> = [
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
const coverageAliasComplete: [CoverageAliasMissing] extends [never] ? true : CoverageAliasMissing = true;

export const CONFIGURATION_HANDLER_KEYS: HandlerKeys<"configuration"> = [
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
const configurationComplete: [ConfigurationMissing] extends [never] ? true : ConfigurationMissing = true;

export const WATCHLIST_SUGGESTION_HANDLER_KEYS: HandlerKeys<"configuration"> = [
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
const watchlistSuggestionComplete: [WatchlistSuggestionMissing] extends [never] ? true : WatchlistSuggestionMissing = true;

export const PRICE_CHECK_HANDLER_KEYS: HandlerKeys<"game-info"> = [
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
const priceCheckComplete: [PriceCheckMissing] extends [never] ? true : PriceCheckMissing = true;

export const DEAL_SCORE_HANDLER_KEYS: HandlerKeys<"game-info"> = [
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
const dealScoreComplete: [DealScoreMissing] extends [never] ? true : DealScoreMissing = true;

export const GAME_INFO_HANDLER_KEYS: HandlerKeys<"game-info"> = [
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
const gameInfoComplete: [GameInfoMissing] extends [never] ? true : GameInfoMissing = true;

export const SNOOZE_HANDLER_KEYS: HandlerKeys<"configuration"> = [
  "GuildModel",
  "MessageFlags",
  "logger",
  "safeDefer",
  "safeEdit"
] as const;

type SnoozeMissing = Missing<HandlerDeps<typeof attachSnoozeInteractionHandler>, (typeof SNOOZE_HANDLER_KEYS)[number] & string>;
const snoozeComplete: [SnoozeMissing] extends [never] ? true : SnoozeMissing = true;

export const SET_HANDLER_KEYS: HandlerKeys<"configuration"> = [
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
const setComplete: [SetMissing] extends [never] ? true : SetMissing = true;

export const ROLE_PING_HANDLER_KEYS: HandlerKeys<"configuration"> = [
  "GuildModel",
  "MessageFlags",
  "formatUserError",
  "logger",
  "safeDefer",
  "safeEdit"
] as const;

type RolePingMissing = Missing<HandlerDeps<typeof attachRolePingHandlers>, (typeof ROLE_PING_HANDLER_KEYS)[number] & string>;
const rolePingComplete: [RolePingMissing] extends [never] ? true : RolePingMissing = true;

export const GAME_FILTER_HANDLER_KEYS: HandlerKeys<"configuration"> = [
  "GuildModel",
  "MessageFlags",
  "formatUserError",
  "getGuildSettings",
  "logger",
  "safeDefer",
  "safeEdit"
] as const;

type GameFilterMissing = Missing<HandlerDeps<typeof attachGameFilterHandlers>, (typeof GAME_FILTER_HANDLER_KEYS)[number] & string>;
const gameFilterComplete: [GameFilterMissing] extends [never] ? true : GameFilterMissing = true;

export const TEMPLATE_PREVIEW_HANDLER_KEYS: HandlerKeys<"notifications"> = [
  "GuildModel",
  "MessageFlags",
  "getGuildSettings",
  "logger",
  "safeDefer",
  "safeEdit"
] as const;

type TemplatePreviewMissing = Missing<HandlerDeps<typeof attachTemplatePreviewHandler>, (typeof TEMPLATE_PREVIEW_HANDLER_KEYS)[number] & string>;
const templatePreviewComplete: [TemplatePreviewMissing] extends [never] ? true : TemplatePreviewMissing = true;

export const DLC_HANDLER_KEYS: HandlerKeys<"notifications"> = [
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
const dlcComplete: [DlcMissing] extends [never] ? true : DlcMissing = true;

export const PRICE_ALERT_HANDLER_KEYS: HandlerKeys<"notifications"> = [
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
const priceAlertComplete: [PriceAlertMissing] extends [never] ? true : PriceAlertMissing = true;

export const FUTURE_RELEASE_HANDLER_KEYS: HandlerKeys<"notifications"> = [
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
const futureReleaseComplete: [FutureReleaseMissing] extends [never] ? true : FutureReleaseMissing = true;

export const YOUTUBE_HANDLER_KEYS: HandlerKeys<"youtube"> = [
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
const youtubeComplete: [YoutubeMissing] extends [never] ? true : YoutubeMissing = true;

export const SUBSCRIPTION_HANDLER_KEYS: HandlerKeys<"notifications"> = [
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
const subscriptionComplete: [SubscriptionMissing] extends [never] ? true : SubscriptionMissing = true;

export const AUTOCOMPLETE_HANDLER_KEYS: HandlerKeys<"routing"> = [
  "getGuildSettings",
  "logger"
] as const;

type AutocompleteMissing = Missing<HandlerDeps<typeof attachAutocompleteInteractionHandler>, (typeof AUTOCOMPLETE_HANDLER_KEYS)[number] & string>;
const autocompleteComplete: [AutocompleteMissing] extends [never] ? true : AutocompleteMissing = true;

export const FALLBACK_HANDLER_KEYS: HandlerKeys<"routing"> = [
  "MessageFlags",
  "logger"
] as const;

type FallbackMissing = Missing<HandlerDeps<typeof attachFallbackInteractionHandler>, (typeof FALLBACK_HANDLER_KEYS)[number] & string>;
const fallbackComplete: [FallbackMissing] extends [never] ? true : FallbackMissing = true;

export const HANDLER_KEY_COVERAGE = [sourceStatusComplete, configurationAdminComplete, securityComplete, botAddComplete, adminAccessComplete, moderationComplete, backupComplete, auditLogComplete, maintenanceComplete, healthComplete, suggestCommandComplete, reportComplete, statusComplete, latestComplete, simpleComplete, helpComplete, playerCountComplete, gameOverviewComplete, coverageAliasComplete, configurationComplete, watchlistSuggestionComplete, priceCheckComplete, dealScoreComplete, gameInfoComplete, snoozeComplete, setComplete, rolePingComplete, gameFilterComplete, templatePreviewComplete, dlcComplete, priceAlertComplete, futureReleaseComplete, youtubeComplete, subscriptionComplete, autocompleteComplete, fallbackComplete] as const;
