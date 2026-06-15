import type { CommandCacheSizes, GameConfig } from "../../types";
import type { NotificationDiscordClient, OutboxDiscordClient } from "../notifications/outboundChannel";

type MaybePromise<T> = T | Promise<T>;
type RegistryFunction = (...args: unknown[]) => MaybePromise<unknown>;

interface CommandRegistryContext {
  cleanCache?: RegistryFunction;
  getCacheSizes?: () => CommandCacheSizes;
  setGlobalCacheTtl?: (ms: number) => void;
  setUpdatesCache?: (data: unknown) => void;
  setDealsCache?: (currency: string, data: unknown) => void;
  checkForUpdates?: (client: NotificationDiscordClient, games: GameConfig[], shouldAbort?: (() => boolean) | null) => Promise<void>;
  checkForDiscounts?: (client: NotificationDiscordClient, shouldAbort?: (() => boolean) | null) => Promise<void>;
  drainOutbox?: (client: OutboxDiscordClient) => MaybePromise<unknown>;
  buildOptimizedGameList?: (allGames: GameConfig[], subscribedGuilds: unknown[]) => GameConfig[];
  registerSlashCommands?: (token: string, clientId: string) => Promise<unknown>;
  buildSlashCommandDefinitions?: RegistryFunction;
  handleInteraction?: (interaction: unknown, games: GameConfig[]) => MaybePromise<unknown>;
  buildHelpEmbed?: RegistryFunction;
  findGameAndSuggestion?: (input: string, games: GameConfig[]) => unknown;
  getFindGameCacheSize?: RegistryFunction;
  clearFindGameCache?: RegistryFunction;
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
type CommandInstallerTarget = CommandRuntimeBootContext & CommandRegistryContext;
type CommandModuleInstaller = (context: CommandInstallerTarget) => void;

const defaultInstallers = [
  attachCommandCache,
  attachDealFilters,
  attachCommandPresentation,
  attachNotifications,
  attachFeedbackRepository,
  attachSlashCommandDefinitions,
  attachFallbackInteractionHandler,
  attachSimpleCommandsHandler,
  attachHelpInteractionHandler,
  attachSubscriptionNotificationHandlers,
  attachGameFilterHandlers,
  attachRolePingHandlers,
  attachSetInteractionHandler,
  attachOutboxAdminHandler,
  attachLatestInteractionHandler,
  attachStatusInteractionHandler,
  attachHistoryInteractionHandler,
  attachReportInteractionHandler,
  attachHealthInteractionHandler,
  attachDlcInteractionHandler,
  attachAutocompleteInteractionHandler,
  attachAdminCommandRouterGuard
] as const;

function isCommandModuleInstaller(value: unknown): value is CommandModuleInstaller {
  return typeof value === "function";
}

function installCommandModules<T>(
  context: T,
  installers: readonly unknown[] = defaultInstallers
): T & CommandRegistryContext {
  const installContext = context as T & CommandInstallerTarget;
  for (const install of installers) {
    if (!isCommandModuleInstaller(install)) {
      throw new Error("commandRegistry a primit un installer invalid");
    }
    install(installContext);
  }
  return installContext;
}

function requireRegistryFunction<K extends RequiredCommandRegistryKey>(
  context: CommandRegistryContext,
  key: K
): RequiredCommandRegistry[K] {
  const value = context[key];
  if (typeof value !== "function") {
    throw new Error(`commandRegistry nu a primit functia necesara din context: ${String(key)}`);
  }
  return value as RequiredCommandRegistry[K];
}

function createCommandRegistry(
  baseContext: CommandRuntimeBootContext = createCommandRuntimeContext(),
  installers: readonly unknown[] = defaultInstallers
): RequiredCommandRegistry {
  const context = installCommandModules(baseContext, installers);
  return {
    cleanCache: requireRegistryFunction(context, "cleanCache"),
    getCacheSizes: requireRegistryFunction(context, "getCacheSizes"),
    setGlobalCacheTtl: requireRegistryFunction(context, "setGlobalCacheTtl"),
    setUpdatesCache: requireRegistryFunction(context, "setUpdatesCache"),
    setDealsCache: requireRegistryFunction(context, "setDealsCache"),
    checkForUpdates: requireRegistryFunction(context, "checkForUpdates"),
    checkForDiscounts: requireRegistryFunction(context, "checkForDiscounts"),
    drainOutbox: requireRegistryFunction(context, "drainOutbox"),
    buildOptimizedGameList: requireRegistryFunction(context, "buildOptimizedGameList"),
    registerSlashCommands: requireRegistryFunction(context, "registerSlashCommands"),
    buildSlashCommandDefinitions: requireRegistryFunction(context, "buildSlashCommandDefinitions"),
    handleInteraction: requireRegistryFunction(context, "handleInteraction"),
    buildHelpEmbed: requireRegistryFunction(context, "buildHelpEmbed"),
    findGameAndSuggestion: requireRegistryFunction(context, "findGameAndSuggestion"),
    getFindGameCacheSize: requireRegistryFunction(context, "getFindGameCacheSize"),
    clearFindGameCache: requireRegistryFunction(context, "clearFindGameCache"),
    formatUserError: requireRegistryFunction(context, "formatUserError"),
    canSendEmbeds: requireRegistryFunction(context, "canSendEmbeds")
  };
}

const commands = Object.assign(createCommandRegistry(), {
  createCommandRegistry,
  installCommandModules
});

export = commands;
