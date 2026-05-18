const ctx = require("./runtime") as any;

require("./cache")(ctx);
require("../../domain/deals/filters")(ctx);
require("./ui")(ctx);
(globalThis as any).fetchGameStatus = ctx.fetchGameStatus;
require("../notifications")(ctx);
require("./slashCommands")(ctx);
require("./interactions")(ctx);

const commands = {
  startCacheCleaner: ctx.startCacheCleaner,
  cleanCache: ctx.cleanCache,
  getCacheSizes: ctx.getCacheSizes,
  setGlobalCacheTtl: ctx.setGlobalCacheTtl,
  checkForUpdates: ctx.checkForUpdates,
  checkForDiscounts: ctx.checkForDiscounts,
  buildOptimizedGameList: ctx.buildOptimizedGameList,
  registerSlashCommands: ctx.registerSlashCommands,
  buildSlashCommandDefinitions: ctx.buildSlashCommandDefinitions,
  handleInteraction: ctx.handleInteraction,
  buildHelpEmbed: ctx.buildHelpEmbed,
  findGameAndSuggestion: ctx.findGameAndSuggestion,
  getFindGameCacheSize: ctx.getFindGameCacheSize,
  clearFindGameCache: ctx.clearFindGameCache,
  formatUserError: ctx.formatUserError
};

export = commands;
