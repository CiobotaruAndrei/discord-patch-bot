import type { CommandCacheSizes, GameConfig, FetchResult, DealInfo, GuildSettings } from "../../types";
import type { NotificationDiscordClient, OutboxDiscordClient } from "../notifications/outboundChannel";
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
  drainOutbox?: (client: OutboxDiscordClient) => MaybePromise<unknown>;
  buildOptimizedGameList?: <G extends { key: string }>(allGames: G[], subscribedGuilds: readonly GuildGameFilter[]) => G[];
  registerSlashCommands?: (token: string, clientId: string) => Promise<unknown>;
  buildSlashCommandDefinitions?: () => unknown[];
  handleInteraction?: (interaction: unknown, games: Array<{ key: string }>) => Promise<unknown>;
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
import attachDlcInteractionHandler = require("../command-handlers/dlcInteractionHandler");
import attachAutocompleteInteractionHandler = require("../command-handlers/autocompleteInteractionHandler");
import attachAdminCommandRouterGuard = require("../command-security/adminCommandRouterGuard");

const { createCommandRuntimeContext } = require("../command-runtime/commandRuntimeContext") as typeof import("../command-runtime/commandRuntimeContext");
type CommandRuntimeBootContext = ReturnType<typeof createCommandRuntimeContext>;
type RegistryInteractionHandler = NonNullable<CommandRegistryContext["handleInteraction"]>;
type RegistryHelpEmbed = NonNullable<CommandRegistryContext["buildHelpEmbed"]>;
type HandlerMutableContext = { handleInteraction?: RegistryInteractionHandler; buildHelpEmbed?: RegistryHelpEmbed };

function requireInstalled<T>(value: T | undefined, key: string): T {
  if (typeof value !== "function") {
    throw new Error(`commandRegistry: functia necesara lipseste dupa compunere: ${key}`);
  }
  return value;
}

function createCommandRegistry(): RequiredCommandRegistry {
  const base: CommandRuntimeBootContext & HandlerMutableContext = createCommandRuntimeContext();

  const withCache = Object.assign(base, attachCommandCache.createCommandCache(base));
  const withFilters = Object.assign(withCache, {
    dealPassesFilters, normalizePendingUpdateArray, normalizePendingDiscountArray, toEntries, mapToObject, rotateAfter
  });
  const withPresentation = Object.assign(withFilters, attachCommandPresentation.createCommandPresentation(withFilters));
  const withNotifications = Object.assign(withPresentation, attachNotifications.createNotificationRuntime(withPresentation));
  const feedbackRepository = attachFeedbackRepository.createFeedbackRepository(withNotifications);
  const withFeedback = Object.assign(withNotifications, {
    recordFeedbackReport: feedbackRepository.recordReport,
    getRecentFeedbackReports: feedbackRepository.getRecent
  });
  const ctx = Object.assign(withFeedback, attachSlashCommandDefinitions.createSlashCommandDefinitions(withFeedback));

  attachFallbackInteractionHandler(ctx);
  attachSimpleCommandsHandler(ctx);
  attachHelpInteractionHandler(ctx);
  attachSubscriptionNotificationHandlers(ctx);
  attachGameFilterHandlers(ctx);
  attachRolePingHandlers(ctx);
  attachSetInteractionHandler(ctx);
  attachOutboxAdminHandler(ctx);
  attachLatestInteractionHandler(ctx);
  attachStatusInteractionHandler(ctx);
  attachHistoryInteractionHandler(ctx);
  attachReportInteractionHandler(ctx);
  attachHealthInteractionHandler(ctx);
  attachDlcInteractionHandler(ctx);
  attachAutocompleteInteractionHandler(ctx);
  attachAdminCommandRouterGuard(ctx);

  return {
    cleanCache: ctx.cleanCache,
    getCacheSizes: ctx.getCacheSizes,
    setGlobalCacheTtl: ctx.setGlobalCacheTtl,
    setUpdatesCache: ctx.setUpdatesCache,
    setDealsCache: ctx.setDealsCache,
    checkForUpdates: ctx.checkForUpdates,
    checkForDiscounts: ctx.checkForDiscounts,
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
  };
}

const commands = Object.assign(createCommandRegistry(), { createCommandRegistry });

export = commands;
