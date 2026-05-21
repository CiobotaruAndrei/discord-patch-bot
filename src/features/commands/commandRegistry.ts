interface CommandRegistryContext {
  startCacheCleaner?: (...args: unknown[]) => unknown;
  cleanCache?: (...args: unknown[]) => unknown;
  getCacheSizes?: (...args: unknown[]) => unknown;
  setGlobalCacheTtl?: (...args: unknown[]) => unknown;
  checkForUpdates?: (...args: unknown[]) => unknown;
  checkForDiscounts?: (...args: unknown[]) => unknown;
  buildOptimizedGameList?: (...args: unknown[]) => unknown;
  registerSlashCommands?: (...args: unknown[]) => unknown;
  buildSlashCommandDefinitions?: (...args: unknown[]) => unknown;
  handleInteraction?: (...args: unknown[]) => unknown;
  buildHelpEmbed?: (...args: unknown[]) => unknown;
  findGameAndSuggestion?: (...args: unknown[]) => unknown;
  getFindGameCacheSize?: (...args: unknown[]) => unknown;
  clearFindGameCache?: (...args: unknown[]) => unknown;
  formatUserError?: (...args: unknown[]) => unknown;
  [key: string]: unknown;
}

const ctx = require("./runtime") as CommandRegistryContext;

require("./cache")(ctx);
require("../../domain/deals/filters")(ctx);
require("./ui")(ctx);
// V11: interactions.ts destructureaza `fetchGameStatus` direct din ctx, deci
// globalThis-ul nu mai e necesar. ui.ts ataseaza functia pe ctx la fel ca pe
// celelalte handler-e (vezi ui.ts: Object.assign(ctx, { ..., fetchGameStatus })).
require("../notifications")(ctx);
require("./slashCommands")(ctx);
require("./interactions")(ctx);

function requireRegistryFunction<K extends keyof CommandRegistryContext>(key: K): NonNullable<CommandRegistryContext[K]> {
  const value = ctx[key];
  if (typeof value !== "function") {
    throw new Error(`commandRegistry nu a primit functia necesara din ctx: ${String(key)}`);
  }
  return value as NonNullable<CommandRegistryContext[K]>;
}

const commands = {
  startCacheCleaner: requireRegistryFunction("startCacheCleaner"),
  cleanCache: requireRegistryFunction("cleanCache"),
  getCacheSizes: requireRegistryFunction("getCacheSizes"),
  setGlobalCacheTtl: requireRegistryFunction("setGlobalCacheTtl"),
  checkForUpdates: requireRegistryFunction("checkForUpdates"),
  checkForDiscounts: requireRegistryFunction("checkForDiscounts"),
  buildOptimizedGameList: requireRegistryFunction("buildOptimizedGameList"),
  registerSlashCommands: requireRegistryFunction("registerSlashCommands"),
  buildSlashCommandDefinitions: requireRegistryFunction("buildSlashCommandDefinitions"),
  handleInteraction: requireRegistryFunction("handleInteraction"),
  buildHelpEmbed: requireRegistryFunction("buildHelpEmbed"),
  findGameAndSuggestion: requireRegistryFunction("findGameAndSuggestion"),
  getFindGameCacheSize: requireRegistryFunction("getFindGameCacheSize"),
  clearFindGameCache: requireRegistryFunction("clearFindGameCache"),
  formatUserError: requireRegistryFunction("formatUserError")
};

export = commands;
