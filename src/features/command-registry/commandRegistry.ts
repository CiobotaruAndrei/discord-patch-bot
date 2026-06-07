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
  [key: string]: unknown;
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

const { createCommandRuntimeContext } = require("../command-runtime/commandRuntimeContext") as {
  createCommandRuntimeContext: () => CommandRegistryContext;
};
const defaultInstallers: CommandModuleInstaller[] = [
  require("../command-cache/commandCache") as CommandModuleInstaller,
  require("../../domain/deals/filters") as CommandModuleInstaller,
  require("../command-presentation/commandPresentation") as CommandModuleInstaller,
  require("../notifications") as CommandModuleInstaller,
  require("../feedback/feedbackRepository") as CommandModuleInstaller,
  require("../command-definitions/slashCommandDefinitions") as CommandModuleInstaller,
  require("../command-handlers/fallbackInteractionHandler") as CommandModuleInstaller,
  require("../command-handlers/simpleCommandsHandler") as CommandModuleInstaller,
  require("../command-handlers/helpInteractionHandler") as CommandModuleInstaller,
  require("../command-handlers/subscriptionNotificationHandlers") as CommandModuleInstaller,
  require("../command-handlers/gameFilterHandlers") as CommandModuleInstaller,
  require("../command-handlers/rolePingHandlers") as CommandModuleInstaller,
  require("../command-handlers/setInteractionHandler") as CommandModuleInstaller,
  require("../command-handlers/outboxAdminHandler") as CommandModuleInstaller,
  require("../command-handlers/latestInteractionHandler") as CommandModuleInstaller,
  require("../command-handlers/statusInteractionHandler") as CommandModuleInstaller,
  require("../command-handlers/historyInteractionHandler") as CommandModuleInstaller,
  require("../command-handlers/reportInteractionHandler") as CommandModuleInstaller,
  require("../command-handlers/dlcInteractionHandler") as CommandModuleInstaller,
  require("../command-handlers/autocompleteInteractionHandler") as CommandModuleInstaller,
  require("../command-security/adminCommandRouterGuard") as CommandModuleInstaller
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
