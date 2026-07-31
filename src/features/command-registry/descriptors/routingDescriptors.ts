import type { CommandHandler } from "../commandHandler.js";
import {
  AUTOCOMPLETE_HANDLER_KEYS,
  FALLBACK_HANDLER_KEYS
} from "../commandHandlerKeys.js";
import type { CommandDomainDeps } from "../commandDomainDeps.js";
import type { DefineDescriptor, AnyCommandHandlerDescriptor } from "../commandHandlerDescriptors.js";
import attachAutocompleteInteractionHandler from "../../command-handlers/autocompleteInteractionHandler.js";
import attachFallbackInteractionHandler from "../../command-handlers/fallbackInteractionHandler.js";


export function routingLeadingDescriptors(define: DefineDescriptor): readonly AnyCommandHandlerDescriptor[] {
  return [
    define({ id: "autocomplete", needs: AUTOCOMPLETE_HANDLER_KEYS, domain: "routing", scope: "global", help: [], autocomplete: ["slash-options"], build: context => attachAutocompleteInteractionHandler.buildCommandHandler(context) })
  ];
}

export function routingTrailingDescriptors(define: DefineDescriptor): readonly AnyCommandHandlerDescriptor[] {
  return [
    define({ id: "fallback", needs: FALLBACK_HANDLER_KEYS, domain: "routing", scope: "global", access: "mixed", help: [], build: context => attachFallbackInteractionHandler.buildCommandHandler(context) })
  ];
}
