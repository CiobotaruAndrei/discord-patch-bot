"use strict";

const ctx = require("./runtime");

require("./cache")(ctx);
require("./filters")(ctx);
require("./ui")(ctx);
require("./notifications")(ctx);
require("./slashCommands")(ctx);
require("./interactions")(ctx);

module.exports = {
  startCacheCleaner: ctx.startCacheCleaner,
  cleanCache: ctx.cleanCache,
  getCacheSizes: ctx.getCacheSizes,
  setGlobalCacheTtl: ctx.setGlobalCacheTtl,
  checkForUpdates: ctx.checkForUpdates,
  checkForDiscounts: ctx.checkForDiscounts,
  registerSlashCommands: ctx.registerSlashCommands,
  buildSlashCommandDefinitions: ctx.buildSlashCommandDefinitions,
  handleInteraction: ctx.handleInteraction,
  buildHelpEmbed: ctx.buildHelpEmbed,
  formatUserError: ctx.formatUserError
};
