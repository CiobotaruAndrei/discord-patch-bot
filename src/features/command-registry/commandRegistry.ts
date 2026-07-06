import type { CommandCacheSizes, GameConfig, FetchResult, DealInfo, GuildSettings } from "../../types";
import type { NotificationDiscordClient, OutboxDiscordClient } from "../notifications/outboundChannel";
import type { CommandHandler, CommandGame } from "./commandHandler";
import {
  dealPassesFilters,
  mapToObject,
  normalizePendingDiscountArray,
  normalizePendingUpdateArray,
  rotateAfter,
  toEntries
} from "../../domain/deals/filtersCore";

type MaybePromise<T> = T | Promise<T>;
type GuildGameFilter = Pick<GuildSettings, "enabledGames">;

interface CommandRegistryContext {
  cleanCache?: () => void;
  getCacheSizes?: () => CommandCacheSizes;
  setGlobalCacheTtl?: (ms: number) => void;
  setUpdatesCache?: (data: FetchResult[] | null) => void;
  setDealsCache?: (currency: unknown, data: DealInfo[]) => void;
  checkForUpdates?: (client: NotificationDiscordClient, games: GameConfig[], shouldAbort?: (() => boolean) | null) => Promise<void>;
  checkForDiscounts?: (client: NotificationDiscordClient, shouldAbort?: (() => boolean) | null) => Promise<void>;
  checkForYouTube?: (client: NotificationDiscordClient, shouldAbort?: (() => boolean) | null) => Promise<void>;
  refreshPlayerCountSnapshots?: (games: GameConfig[], shouldAbort?: (() => boolean) | null) => Promise<{ refreshed: number; failed: number }>;
  drainOutbox?: (client: OutboxDiscordClient) => MaybePromise<unknown>;
  buildOptimizedGameList?: <G extends { key: string }>(allGames: G[], subscribedGuilds: readonly GuildGameFilter[]) => G[];
  registerSlashCommands?: (token: string, clientId: string) => Promise<unknown>;
  buildSlashCommandDefinitions?: () => unknown[];
  handleInteraction?: (interaction: unknown, games: CommandGame[]) => Promise<unknown>;
  buildHelpEmbed?: () => unknown;
  findGameAndSuggestion?: (input: string, games: GameConfig[]) => unknown;
  getFindGameCacheSize?: () => number;
  clearFindGameCache?: () => void;
  formatUserError?: (err: unknown, fallback: string, code?: string) => string;
  canSendEmbeds?: (channel: unknown, botId: string) => boolean;
}

type RequiredCommandRegistryKey =
  | "cleanCache"
  | "getCacheSizes"
  | "setGlobalCacheTtl"
  | "setUpdatesCache"
  | "setDealsCache"
  | "checkForUpdates"
  | "checkForDiscounts"
  | "checkForYouTube"
  | "refreshPlayerCountSnapshots"
  | "drainOutbox"
  | "buildOptimizedGameList"
  | "registerSlashCommands"
  | "buildSlashCommandDefinitions"
  | "handleInteraction"
  | "buildHelpEmbed"
  | "findGameAndSuggestion"
  | "getFindGameCacheSize"
  | "clearFindGameCache"
  | "formatUserError"
  | "canSendEmbeds";

type RequiredCommandRegistry = {
  [K in RequiredCommandRegistryKey]: NonNullable<CommandRegistryContext[K]>;
};

import attachCommandCache = require("../command-cache/commandCache");
import attachDealFilters = require("../../domain/deals/filters");
import attachCommandPresentation = require("../command-presentation/commandPresentation");
import attachNotifications = require("../notifications");
import attachPlayerCountSnapshots = require("../player-count/playerCountSnapshotService");
import attachCachedSteamPlayerCount = require("../player-count/cachedSteamPlayerCount");
import playerCountCache = require("../../infra/redis/redisCacheContext");
import attachFeedbackRepository = require("../feedback/feedbackRepository");
import attachSlashCommandDefinitions = require("../command-definitions/slashCommandDefinitions");
import attachFallbackInteractionHandler = require("../command-handlers/fallbackInteractionHandler");
import attachSimpleCommandsHandler = require("../command-handlers/simpleCommandsHandler");
import attachHelpInteractionHandler = require("../command-handlers/helpInteractionHandler");
import attachSubscriptionNotificationHandlers = require("../command-handlers/subscriptionNotificationHandlers");
import attachGameFilterHandlers = require("../command-handlers/gameFilterHandlers");
import attachRolePingHandlers = require("../command-handlers/rolePingHandlers");
import attachSetInteractionHandler = require("../command-handlers/setInteractionHandler");
import attachOutboxAdminHandler = require("../command-handlers/outboxAdminHandler");
import attachLatestInteractionHandler = require("../command-handlers/latestInteractionHandler");
import attachStatusInteractionHandler = require("../command-handlers/statusInteractionHandler");
import attachHistoryInteractionHandler = require("../command-handlers/historyInteractionHandler");
import attachReportInteractionHandler = require("../command-handlers/reportInteractionHandler");
import attachHealthInteractionHandler = require("../command-handlers/healthInteractionHandler");
import attachConfigInteractionHandler = require("../command-handlers/configInteractionHandler");
import attachGuildConfigurationAdminHandler = require("../command-handlers/guildConfigurationAdminHandler");
import attachAdminCommandAccessHandler = require("../command-handlers/adminCommandAccessHandler");
import attachPriceAlertInteractionHandler = require("../command-handlers/priceAlertInteractionHandler");
import attachBackupInteractionHandler = require("../command-handlers/backupInteractionHandler");
import attachAuditLogInteractionHandler = require("../command-handlers/auditLogInteractionHandler");
import attachSuggestCommandInteractionHandler = require("../command-handlers/suggestCommandInteractionHandler");
import attachWatchlistGameSuggestionHandler = require("../command-handlers/watchlistGameSuggestionHandler");
import attachPriceCheckInteractionHandler = require("../command-handlers/priceCheckInteractionHandler");
import attachDealScoreInteractionHandler = require("../command-handlers/dealScoreInteractionHandler");
import attachGameInfoInteractionHandler = require("../command-handlers/gameInfoInteractionHandler");
import attachMaintenanceInteractionHandler = require("../command-handlers/maintenanceInteractionHandler");
import attachFutureReleaseInteractionHandler = require("../command-handlers/futureReleaseInteractionHandler");
import attachYouTubeInteractionHandler = require("../command-handlers/youtubeInteractionHandler");
import attachSnoozeInteractionHandler = require("../command-handlers/snoozeInteractionHandler");
import attachSourcesStatusHandler = require("../command-handlers/sourcesStatusHandler");
import attachSourcesRefreshHandler = require("../command-handlers/sourcesRefreshHandler");
import attachDlcInteractionHandler = require("../command-handlers/dlcInteractionHandler");
import attachAutocompleteInteractionHandler = require("../command-handlers/autocompleteInteractionHandler");
import attachCommandSnoozeGuard = require("../command-security/commandSnoozeGuard");
import attachAdminCommandRouterGuard = require("../command-security/adminCommandRouterGuard");

const { createCommandRuntimeContext } = require("../command-runtime/commandRuntimeContext") as typeof import("../command-runtime/commandRuntimeContext");
type CommandRuntimeBootContext = ReturnType<typeof createCommandRuntimeContext>;
type RegistryInteractionHandler = NonNullable<CommandRegistryContext["handleInteraction"]>;
type RegistryHelpEmbed = NonNullable<CommandRegistryContext["buildHelpEmbed"]>;
type HandlerMutableContext = { handleInteraction?: RegistryInteractionHandler; buildHelpEmbed?: RegistryHelpEmbed };

const PLAYER_COUNT_CACHE_TTL_SECONDS = 60;

function requireInstalled<T>(value: T | undefined, key: string): T {
  if (typeof value !== "function") {
    throw new Error(`commandRegistry: functia necesara lipseste dupa compunere: ${key}`);
  }
  return value;
}

function createAppServices(
  overrides: Partial<CommandRuntimeBootContext & HandlerMutableContext> = {}
) {
  const runtime = { ...createCommandRuntimeContext(), ...overrides };
  const cache = { ...runtime, ...attachCommandCache.createCommandCache(runtime) };
  const filters = {
    ...cache,
    dealPassesFilters, normalizePendingUpdateArray, normalizePendingDiscountArray, toEntries, mapToObject, rotateAfter
  };
  const presentation = { ...filters, ...attachCommandPresentation.createCommandPresentation(filters) };
  const notifications = { ...presentation, ...attachNotifications.createNotificationRuntime(presentation) };
  const cachedFetchSteamCurrentPlayers = attachCachedSteamPlayerCount.createCachedSteamPlayerCount({
    fetchSteamCurrentPlayers: notifications.fetchSteamCurrentPlayers,
    cache: playerCountCache,
    ttlSeconds: PLAYER_COUNT_CACHE_TTL_SECONDS
  });
  const playerCounts = {
    ...notifications,
    ...attachPlayerCountSnapshots.createPlayerCountSnapshotService({ ...notifications, fetchSteamCurrentPlayers: cachedFetchSteamCurrentPlayers })
  };
  const feedbackRepository = attachFeedbackRepository.createFeedbackRepository(playerCounts);
  const feedback = {
    ...playerCounts,
    recordFeedbackReport: feedbackRepository.recordReport,
    getRecentFeedbackReports: feedbackRepository.getRecent,
    resolveFeedbackReport: feedbackRepository.resolveReport
  };
  return { ...feedback, ...attachSlashCommandDefinitions.createSlashCommandDefinitions(feedback) };
}

function buildCommandHandlerList(ctx: ReturnType<typeof createAppServices>): { commandHandlers: CommandHandler[]; helpCommand: ReturnType<typeof attachHelpInteractionHandler.buildCommandHandler> } {
  const helpCommand = attachHelpInteractionHandler.buildCommandHandler(ctx);
  const commandHandlers: CommandHandler[] = [
    attachAutocompleteInteractionHandler.buildCommandHandler(ctx),
    attachDlcInteractionHandler.buildCommandHandler(ctx),
    attachSourcesStatusHandler.buildCommandHandler(ctx),
    attachSourcesRefreshHandler.buildCommandHandler(ctx),
    attachConfigInteractionHandler.buildCommandHandler(ctx),
    attachGuildConfigurationAdminHandler.buildCommandHandler(ctx),
    attachAdminCommandAccessHandler.buildCommandHandler(ctx),
    attachPriceAlertInteractionHandler.buildCommandHandler(ctx),
    attachBackupInteractionHandler.buildCommandHandler(ctx),
    attachAuditLogInteractionHandler.buildCommandHandler(ctx),
    attachSuggestCommandInteractionHandler.buildCommandHandler(ctx),
    attachWatchlistGameSuggestionHandler.buildCommandHandler(ctx),
    attachPriceCheckInteractionHandler.buildCommandHandler(ctx),
    attachDealScoreInteractionHandler.buildCommandHandler(ctx),
    attachGameInfoInteractionHandler.buildCommandHandler(ctx),
    attachMaintenanceInteractionHandler.buildCommandHandler(ctx),
    attachFutureReleaseInteractionHandler.buildCommandHandler(ctx),
    attachYouTubeInteractionHandler.buildCommandHandler(ctx),
    attachSnoozeInteractionHandler.buildCommandHandler(ctx),
    attachHealthInteractionHandler.buildCommandHandler(ctx),
    attachReportInteractionHandler.buildCommandHandler(ctx),
    attachHistoryInteractionHandler.buildCommandHandler(ctx),
    attachStatusInteractionHandler.buildCommandHandler(ctx),
    attachLatestInteractionHandler.buildCommandHandler(ctx),
    attachOutboxAdminHandler.buildCommandHandler(ctx),
    attachSetInteractionHandler.buildCommandHandler(ctx),
    attachRolePingHandlers.buildCommandHandler(ctx),
    attachGameFilterHandlers.buildCommandHandler(ctx),
    attachSubscriptionNotificationHandlers.buildCommandHandler(ctx),
    helpCommand,
    attachSimpleCommandsHandler.buildCommandHandler(ctx),
    attachFallbackInteractionHandler.buildCommandHandler(ctx)
  ];
  return { commandHandlers, helpCommand };
}

function createCommandRegistry(
  overrides: Partial<CommandRuntimeBootContext & HandlerMutableContext> = {}
): RequiredCommandRegistry {
  const ctx = createAppServices(overrides);
  const { commandHandlers, helpCommand } = buildCommandHandlerList(ctx);

  async function dispatchCommand(interaction: unknown, games: CommandGame[]): Promise<unknown> {
    for (const handler of commandHandlers) {
      if (handler.canHandle(interaction)) return handler.handle(interaction, games);
    }
    return undefined;
  }

  const snoozeGuard = attachCommandSnoozeGuard.createCommandSnoozeGuard({
    getGuildSettings: ctx.getGuildSettings,
    MessageFlags: ctx.MessageFlags,
    logger: ctx.logger
  });
  const adminGuard = attachAdminCommandRouterGuard.createAdminCommandGuard({
    requireGuildAdmin: interaction => attachAdminCommandRouterGuard.requireGuildAdminWithConfiguredAccess(ctx, interaction),
    authorizeGuildAdmin: interaction => attachAdminCommandRouterGuard.authorizeGuildAdminWithConfiguredAccess(ctx, interaction)
  }, ctx);

  type SnoozeInteraction = Parameters<typeof snoozeGuard.handleSnoozedCommand>[0];
  type AdminInteraction = Parameters<typeof adminGuard.handleAdminProtectedCommand>[0];
  type AdminNext = Parameters<typeof adminGuard.handleAdminProtectedCommand>[2];

  async function dispatchWithSnoozeGuard(interaction: unknown, games: CommandGame[]): Promise<unknown> {
    return snoozeGuard.handleSnoozedCommand(interaction as SnoozeInteraction, games, dispatchCommand);
  }

  async function handleInteraction(interaction: unknown, games: CommandGame[]): Promise<unknown> {
    if (attachAdminCommandRouterGuard.isAdminProtectedCommand(interaction as AdminInteraction)) {
      return adminGuard.handleAdminProtectedCommand(interaction as AdminInteraction, games, dispatchWithSnoozeGuard as AdminNext);
    }
    return dispatchWithSnoozeGuard(interaction, games);
  }

  ctx.handleInteraction = handleInteraction;
  ctx.buildHelpEmbed = helpCommand.buildHelpEmbed;

  return Object.freeze({
    cleanCache: ctx.cleanCache,
    getCacheSizes: ctx.getCacheSizes,
    setGlobalCacheTtl: ctx.setGlobalCacheTtl,
    setUpdatesCache: ctx.setUpdatesCache,
    setDealsCache: ctx.setDealsCache,
    checkForUpdates: ctx.checkForUpdates,
    checkForDiscounts: ctx.checkForDiscounts,
    checkForYouTube: ctx.checkForYouTube,
    refreshPlayerCountSnapshots: ctx.refreshPlayerCountSnapshots,
    drainOutbox: ctx.drainOutbox,
    buildOptimizedGameList: ctx.buildOptimizedGameList,
    registerSlashCommands: ctx.registerSlashCommands,
    buildSlashCommandDefinitions: ctx.buildSlashCommandDefinitions,
    handleInteraction: requireInstalled(ctx.handleInteraction, "handleInteraction"),
    buildHelpEmbed: requireInstalled(ctx.buildHelpEmbed, "buildHelpEmbed"),
    findGameAndSuggestion: ctx.findGameAndSuggestion,
    getFindGameCacheSize: ctx.getFindGameCacheSize,
    clearFindGameCache: ctx.clearFindGameCache,
    formatUserError: ctx.formatUserError,
    canSendEmbeds: ctx.canSendEmbeds
  });
}

const commands = Object.freeze({ ...createCommandRegistry(), createCommandRegistry, createAppServices, buildCommandHandlerList });

export = commands;
