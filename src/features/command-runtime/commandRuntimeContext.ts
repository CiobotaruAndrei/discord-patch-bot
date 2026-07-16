import {
  checkChannelPermissions,
  checkReadMessageHistory,
  createCommandRuntimeDependencies,
  createDiscordRuntimeBindings
} from "./commandRuntimeDependencies.js";
import type { CommandRuntimeDependencies, CommandRuntimeInput } from "./commandRuntimeDependencies.js";

function createCommandRuntimeContext(input: CommandRuntimeInput): CommandRuntimeDependencies {
  return createCommandRuntimeDependencies(input);
}

export default Object.assign(createCommandRuntimeContext, {
  createCommandRuntimeContext,
  createCommandRuntimeDependencies,
  createDiscordRuntimeBindings,
  checkChannelPermissions,
  checkReadMessageHistory
});
