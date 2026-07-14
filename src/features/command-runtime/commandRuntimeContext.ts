import {
  checkChannelPermissions,
  checkReadMessageHistory,
  createCommandRuntimeDependencies,
  createDiscordRuntimeBindings,
  flattenCommandRuntimeDependencies
} from "./commandRuntimeDependencies.js";
import type { CommandRuntimeContext } from "./commandRuntimeDependencies.js";

function createCommandRuntimeContext(): CommandRuntimeContext {
  return flattenCommandRuntimeDependencies(createCommandRuntimeDependencies());
}

export default Object.assign(createCommandRuntimeContext, {
  createCommandRuntimeContext,
  createCommandRuntimeDependencies,
  createDiscordRuntimeBindings,
  checkChannelPermissions,
  checkReadMessageHistory
});
