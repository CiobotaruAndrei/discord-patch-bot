import type { GameConfig } from "../../types";

type MaybePromise<T> = T | Promise<T>;
type RegistryFunction = (...args: unknown[]) => MaybePromise<unknown>;
type CommandModuleInstaller = (context: CommandRegistryContext) => void;

interface CommandRegistryContext {
  cleanCache?: RegistryFunction;
  getCacheSizes?: RegistryFunction;
  setGlobalCacheTtl?: RegistryFunction;
  setUpdatesCache?: (data: unknown) => void;
  setDealsCache?: (currency: string, data: unknown) => void;
  checkForUpdates?: (games?: GameConfig[]) => MaybePromise<unknown>;
  checkForDiscounts?: RegistryFunction;
  drainOutbox?: (client: unknown) => MaybePromise<unknown>;
  buildOptimizedGameList?: (allGames: GameConfig[], subscribedGuilds: unknown[]) => GameConfig[];
  registerSlashCommands?: (token: string, clientId: string) => MaybePromise<unknown>;
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

const { createCommandRuntimeContext } = require("../command-runtime/commandRuntimeContext") as {
  createCommandRuntimeContext: () => CommandRegistryContext;
};
const defaultInstallers: CommandModuleInstaller[] = [
  attachCommandCache as unknown as CommandModuleInstaller,
  attachDealFilters as unknown as CommandModuleInstaller,
  attachCommandPresentation as unknown as CommandModuleInstaller,
  attachNotifications as unknown as CommandModuleInstaller,
  attachFeedbackRepository as unknown as CommandModuleInstaller,
  attachSlashCommandDefinitions as unknown as CommandModuleInstaller,
  attachFallbackInteractionHandler as unknown as CommandModuleInstaller,
  attachSimpleCommandsHandler as unknown as CommandModuleInstaller,
  attachHelpInteractionHandler as unknown as CommandModuleInstaller,
  attachSubscriptionNotificationHandlers as unknown as CommandModuleInstaller,
  attachGameFilterHandlers as unknown as CommandModuleInstaller,
  attachRolePingHandlers as unknown as CommandModuleInstaller,
  attachSetInteractionHandler as unknown as CommandModuleInstaller,
  attachOutboxAdminHandler as unknown as CommandModuleInstaller,
  attachLatestInteractionHandler as unknown as CommandModuleInstaller,
  attachStatusInteractionHandler as unknown as CommandModuleInstaller,
  attachHistoryInteractionHandler as unknown as CommandModuleInstaller,
  attachReportInteractionHandler as unknown as CommandModuleInstaller,
  attachHealthInteractionHandler as unknown as CommandModuleInstaller,
  attachDlcInteractionHandler as unknown as CommandModuleInstaller,
  attachAutocompleteInteractionHandler as unknown as CommandModuleInstaller,
  attachAdminCommandRouterGuard as unknown as CommandModuleInstaller
];

function installCommandModules(
  context: CommandRegistryContext,
  installers: CommandModuleInstaller[] = defaultInstallers
): CommandRegistryContext {
  for (const install of installers) install(context);
  return context;
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
  baseContext: CommandRegistryContext = createCommandRuntimeContext(),
  installers: CommandModuleInstaller[] = defaultInstallers
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
