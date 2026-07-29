import type { CommandHandler } from "./commandHandler.js";
import type { CommandAppServices } from "./commandRegistry.js";
import type { CommandDomainDeps } from "./commandDomainDeps.js";
import { selectDomainDeps } from "./commandDomainSelection.js";
import { coreDescriptors } from "./descriptors/coreDescriptors.js";
import { adminDescriptors } from "./descriptors/adminDescriptors.js";
import { notificationsDescriptors } from "./descriptors/notificationsDescriptors.js";
import { gamesDescriptors } from "./descriptors/gamesDescriptors.js";
import { routingLeadingDescriptors, routingTrailingDescriptors } from "./descriptors/routingDescriptors.js";

export type CommandHandlerDomain = "routing" | "core" | "configuration" | "notifications" | "game-info" | "youtube" | "admin";

export interface CommandHandlerDescriptor<D extends CommandHandlerDomain = CommandHandlerDomain> {
  id: string;
  domain: D;
  scope: "global" | "guild-only";
  access: "public" | "admin" | "owner" | "mixed";
  help: readonly string[];
  autocomplete: readonly string[];
  build(context: CommandDomainDeps[D]): CommandHandler;
  buildFrom(context: CommandDomainDeps[D]): CommandHandler;
}

export type AnyCommandHandlerDescriptor = {
  [D in CommandHandlerDomain]: CommandHandlerDescriptor<D>
}[CommandHandlerDomain];

export function createCommandHandlerDescriptors(): readonly AnyCommandHandlerDescriptor[] {
  function define<D extends CommandHandlerDomain>(
    input: { id: string; domain: D; build: (context: CommandDomainDeps[D]) => CommandHandler }
      & Partial<Pick<CommandHandlerDescriptor<D>, "scope" | "access" | "help" | "autocomplete">>
  ): CommandHandlerDescriptor<D> {
    return {
      scope: "guild-only",
      access: input.domain === "admin" ? "admin" : "public",
      help: [input.id],
      autocomplete: [],
      ...input,
      buildFrom: (context: CommandDomainDeps[D]) => input.build(selectDomainDeps(input.domain, context))
    };
  }
  const descriptors: readonly AnyCommandHandlerDescriptor[] = [
    ...routingLeadingDescriptors(define),
    ...coreDescriptors(define),
    ...adminDescriptors(define),
    ...notificationsDescriptors(define),
    ...gamesDescriptors(define),
    ...routingTrailingDescriptors(define)
  ];
  const ids = new Set(descriptors.map(descriptor => descriptor.id));
  if (ids.size !== descriptors.length) throw new Error("Registrul handler-elor contine identificatori duplicati");
  return descriptors;
}
