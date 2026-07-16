"use strict";

import { createCommandHandlerDescriptors } from "./commandHandlerDescriptors.js";
import type { CommandHandlerDescriptor } from "./commandHandlerDescriptors.js";
import type { SlashCommandJson } from "../command-definitions/slashDefinitionTools.js";

export interface CommandManifestEntry {
  id: string;
  domain: CommandHandlerDescriptor["domain"];
  scope: CommandHandlerDescriptor["scope"];
  access: CommandHandlerDescriptor["access"];
  help: readonly string[];
  autocomplete: readonly string[];
  priority: number;
}

export interface CommandManifest {
  handlers: readonly CommandManifestEntry[];
  slash: readonly SlashCommandJson[];
}

function createCommandManifest(slash: readonly SlashCommandJson[] = []): CommandManifest {
  const handlers = createCommandHandlerDescriptors().map(({ id, domain, scope, access, help, autocomplete, priority }) => ({ id, domain, scope, access, help, autocomplete, priority }));
  return Object.freeze({ handlers: Object.freeze(handlers), slash: Object.freeze([...slash]) });
}

export { createCommandManifest };
