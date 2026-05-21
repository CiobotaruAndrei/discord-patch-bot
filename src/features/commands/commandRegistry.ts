import type { GameConfig } from "../../types";

type MaybePromise<T> = T | Promise<T>;
type RegistryFunction = (...args: unknown[]) => MaybePromise<unknown>;
type CommandModuleInstaller = (context: CommandRegistryContext) => void;

interface CommandRegistryContext {
  startCacheCleaner?: RegistryFunction;
  cleanCache?: RegistryFunction;
  getCacheSizes?: RegistryFunction;
  setGlobalCacheTtl?: RegistryFunction;
  checkForUpdates?: (games?: GameConfig[]) => MaybePromise<unknown>;
  checkForDiscounts?: RegistryFunction;
  buildOptimizedGameList?: (allGames: GameConfig[], subscribedGuilds: unknown[]) => GameConfig[];
  registerSlashCommands?: (token: string, clientId: string) => MaybePromise<unknown>;
  buildSlashCommandDefinitions?: RegistryFunction;
  handleInteraction?: (interaction: unknown, games: GameConfig[]) => MaybePromise<unknown>;
  buildHelpEmbed?: RegistryFunction;
  findGameAndSuggestion?: (input: string, games: GameConfig[]) => unknown;
  getFindGameCacheSize?: RegistryFunction;
  clearFindGameCache?: RegistryFunction;
  formatUserError?: (err: unknown, fallback: string, code?: string) => string;
  [key: string]: unknown;
}

type RequiredCommandRegistryKey =
  | "startCacheCleaner"
  | "cleanCache"
  | "getCacheSizes"
  | "setGlobalCacheTtl"
  | "checkForUpdates"
  | "checkForDiscounts"
  | "buildOptimizedGameList"
  | "registerSlashCommands"
  | "buildSlashCommandDefinitions"
  | "handleInteraction"
  | "buildHelpEmbed"
  | "findGameAndSuggestion"
  | "getFindGameCacheSize"
  | "clearFindGameCache"
  | "formatUserError";

type RequiredCommandRegistry = {
  [K in RequiredCommandRegistryKey]: NonNullable<CommandRegistryContext[K]>;
};

const runtimeContext = require("./runtime") as CommandRegistryContext;
const defaultInstallers: CommandModuleInstaller[] = [
  require("./cache") as CommandModuleInstaller,
  require("../../domain/deals/filters") as CommandModuleInstaller,
  require("./ui") as CommandModuleInstaller,
  // V11: interactions.ts destructureaza `fetchGameStatus` direct din ctx, deci
  // globalThis-ul nu mai e necesar. ui.ts ataseaza functia pe ctx la fel ca pe
  // celelalte handler-e (vezi ui.ts: Object.assign(ctx, { ..., fetchGameStatus })).
  require("../notifications") as CommandModuleInstaller,
  require("./slashCommands") as CommandModuleInstaller,
  require("./interactions") as CommandModuleInstaller,
  require("./subscriptionInteractions") as CommandModuleInstaller
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
    throw new Error(`commandRegistry nu a primit functia necesara din ctx: ${String(key)}`);
  }
  return value as RequiredCommandRegistry[K];
}

function createCommandRegistry(
  baseContext: CommandRegistryContext = runtimeContext,
  installers: CommandModuleInstaller[] = defaultInstallers
): RequiredCommandRegistry {
  const context = installCommandModules(baseContext, installers);
  return {
    startCacheCleaner: requireRegistryFunction(context, "startCacheCleaner"),
    cleanCache: requireRegistryFunction(context, "cleanCache"),
    getCacheSizes: requireRegistryFunction(context, "getCacheSizes"),
    setGlobalCacheTtl: requireRegistryFunction(context, "setGlobalCacheTtl"),
    checkForUpdates: requireRegistryFunction(context, "checkForUpdates"),
    checkForDiscounts: requireRegistryFunction(context, "checkForDiscounts"),
    buildOptimizedGameList: requireRegistryFunction(context, "buildOptimizedGameList"),
    registerSlashCommands: requireRegistryFunction(context, "registerSlashCommands"),
    buildSlashCommandDefinitions: requireRegistryFunction(context, "buildSlashCommandDefinitions"),
    handleInteraction: requireRegistryFunction(context, "handleInteraction"),
    buildHelpEmbed: requireRegistryFunction(context, "buildHelpEmbed"),
    findGameAndSuggestion: requireRegistryFunction(context, "findGameAndSuggestion"),
    getFindGameCacheSize: requireRegistryFunction(context, "getFindGameCacheSize"),
    clearFindGameCache: requireRegistryFunction(context, "clearFindGameCache"),
    formatUserError: requireRegistryFunction(context, "formatUserError")
  };
}

const commands = Object.assign(createCommandRegistry(), {
  createCommandRegistry,
  installCommandModules
});

export = commands;
