import {
  checkChannelPermissions,
  checkReadMessageHistory,
  createCommandRuntimeDependencies,
  createDiscordRuntimeBindings
} from "./commandRuntimeDependencies.js";
import type { CommandRuntimeDependencies } from "./commandRuntimeDependencies.js";

function createCommandRuntimeContext(): CommandRuntimeDependencies {
  return createCommandRuntimeDependencies();
}

export default Object.assign(createCommandRuntimeContext, {
  createCommandRuntimeContext,
  createCommandRuntimeDependencies,
  createDiscordRuntimeBindings,
  checkChannelPermissions,
  checkReadMessageHistory
});
