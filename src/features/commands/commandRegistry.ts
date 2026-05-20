const ctx = require("./runtime") as any;

require("./cache")(ctx);
require("../../domain/deals/filters")(ctx);
require("./ui")(ctx);
// V11: interactions.ts destructureaza `fetchGameStatus` direct din ctx, deci
// globalThis-ul nu mai e necesar. ui.ts ataseaza functia pe ctx la fel ca pe
// celelalte handler-e (vezi ui.ts: Object.assign(ctx, { ..., fetchGameStatus })).
require("../notifications/notificationWorkflows")(ctx);
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
