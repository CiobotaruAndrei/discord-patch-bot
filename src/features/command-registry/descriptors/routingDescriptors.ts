import type { CommandHandler } from "../commandHandler.js";
import type { CommandDomainDeps } from "../commandDomainDeps.js";
import type { CommandHandlerDomain, CommandHandlerDescriptor, AnyCommandHandlerDescriptor } from "../commandHandlerDescriptors.js";
import attachAutocompleteInteractionHandler from "../../command-handlers/autocompleteInteractionHandler.js";
import attachFallbackInteractionHandler from "../../command-handlers/fallbackInteractionHandler.js";

type Define = <D extends CommandHandlerDomain>(
  input: { id: string; domain: D; build: (context: CommandDomainDeps[D]) => CommandHandler }
    & Partial<Pick<CommandHandlerDescriptor<D>, "scope" | "access" | "help" | "autocomplete">>
) => CommandHandlerDescriptor<D>;

export function routingLeadingDescriptors(define: Define): readonly AnyCommandHandlerDescriptor[] {
  return [
    define({ id: "autocomplete", domain: "routing", scope: "global", help: [], autocomplete: ["slash-options"], build: context => attachAutocompleteInteractionHandler.buildCommandHandler(context) })
  ];
}

export function routingTrailingDescriptors(define: Define): readonly AnyCommandHandlerDescriptor[] {
  return [
    define({ id: "fallback", domain: "routing", scope: "global", access: "mixed", help: [], build: context => attachFallbackInteractionHandler.buildCommandHandler(context) })
  ];
}
