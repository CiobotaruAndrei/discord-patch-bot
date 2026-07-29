import type { CommandHandler } from "../commandHandler.js";
import type { CommandDomainDeps } from "../commandDomainDeps.js";
import type { CommandHandlerDomain, CommandHandlerDescriptor, AnyCommandHandlerDescriptor } from "../commandHandlerDescriptors.js";
import attachHelpInteractionHandler from "../../command-handlers/helpInteractionHandler.js";
import attachLatestInteractionHandler from "../../command-handlers/latestInteractionHandler.js";
import attachReportInteractionHandler from "../../command-handlers/reportInteractionHandler.js";
import attachSimpleCommandsHandler from "../../command-handlers/simpleCommandsHandler.js";
import attachStatusInteractionHandler from "../../command-handlers/statusInteractionHandler.js";
import attachSuggestCommandInteractionHandler from "../../command-handlers/suggestCommandInteractionHandler.js";


export function coreDescriptors(
  define: <D extends CommandHandlerDomain>(
    input: { id: string; domain: D; build: (context: CommandDomainDeps[D]) => CommandHandler }
      & Partial<Pick<CommandHandlerDescriptor<D>, "scope" | "access" | "help" | "autocomplete">>
  ) => CommandHandlerDescriptor<D>
): readonly AnyCommandHandlerDescriptor[] {
  return [
    define({ id: "suggest-command", domain: "core", help: ["suggest-command"], build: context => attachSuggestCommandInteractionHandler.buildCommandHandler(context) }),
    define({ id: "report", domain: "core", help: ["report"], build: context => attachReportInteractionHandler.buildCommandHandler(context) }),
    define({ id: "status", domain: "core", help: ["status"], build: context => attachStatusInteractionHandler.buildCommandHandler(context) }),
    define({ id: "latest", domain: "core", help: ["latest"], build: context => attachLatestInteractionHandler.buildCommandHandler(context) }),
    define({ id: "simple", domain: "core", scope: "global", help: ["ping", "games"], build: context => attachSimpleCommandsHandler.buildCommandHandler(context) }),
    define({ id: "help", domain: "core", scope: "global", help: ["help"], autocomplete: ["help command"], build: context => attachHelpInteractionHandler.buildCommandHandler(context) }),
  ];
}
