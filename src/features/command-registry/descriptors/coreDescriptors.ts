import type { CommandHandler } from "../commandHandler.js";
import { HELP_HANDLER_KEYS } from "../../command-handlers/helpInteractionHandler.js";
import { LATEST_HANDLER_KEYS } from "../../command-handlers/latestInteractionHandler.js";
import { REPORT_HANDLER_KEYS } from "../../command-handlers/reportInteractionHandler.js";
import { SIMPLE_HANDLER_KEYS } from "../../command-handlers/simpleCommandsHandler.js";
import { STATUS_HANDLER_KEYS } from "../../command-handlers/statusInteractionHandler.js";
import { SUGGEST_COMMAND_HANDLER_KEYS } from "../../command-handlers/suggestCommandInteractionHandler.js";
import type { CommandDomainDeps } from "../commandDomainDeps.js";
import type { DefineDescriptor, AnyCommandHandlerDescriptor } from "../commandHandlerDescriptors.js";
import attachHelpInteractionHandler from "../../command-handlers/helpInteractionHandler.js";
import attachLatestInteractionHandler from "../../command-handlers/latestInteractionHandler.js";
import attachReportInteractionHandler from "../../command-handlers/reportInteractionHandler.js";
import attachSimpleCommandsHandler from "../../command-handlers/simpleCommandsHandler.js";
import attachStatusInteractionHandler from "../../command-handlers/statusInteractionHandler.js";
import attachSuggestCommandInteractionHandler from "../../command-handlers/suggestCommandInteractionHandler.js";


export function coreDescriptors(
  define: DefineDescriptor
): readonly AnyCommandHandlerDescriptor[] {
  return [
    define({ id: "suggest-command", needs: SUGGEST_COMMAND_HANDLER_KEYS, domain: "core", help: ["suggest-command"], build: context => attachSuggestCommandInteractionHandler.buildCommandHandler(context) }),
    define({ id: "report", needs: REPORT_HANDLER_KEYS, domain: "core", help: ["report"], build: context => attachReportInteractionHandler.buildCommandHandler(context) }),
    define({ id: "status", needs: STATUS_HANDLER_KEYS, domain: "core", help: ["status"], build: context => attachStatusInteractionHandler.buildCommandHandler(context) }),
    define({ id: "latest", needs: LATEST_HANDLER_KEYS, domain: "core", help: ["latest"], build: context => attachLatestInteractionHandler.buildCommandHandler(context) }),
    define({ id: "simple", needs: SIMPLE_HANDLER_KEYS, domain: "core", scope: "global", help: ["ping", "games"], build: context => attachSimpleCommandsHandler.buildCommandHandler(context) }),
    define({ id: "help", needs: HELP_HANDLER_KEYS, domain: "core", scope: "global", help: ["help"], autocomplete: ["help command"], build: context => attachHelpInteractionHandler.buildCommandHandler(context) }),
  ];
}
