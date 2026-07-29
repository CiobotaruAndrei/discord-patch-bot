import type { CommandHandler } from "../commandHandler.js";
import type { CommandDomainDeps } from "../commandDomainDeps.js";
import type { CommandHandlerDomain, CommandHandlerDescriptor, AnyCommandHandlerDescriptor } from "../commandHandlerDescriptors.js";
import attachAdminCommandAccessHandler from "../../command-handlers/adminCommandAccessHandler.js";
import attachAuditLogInteractionHandler from "../../command-handlers/auditLogInteractionHandler.js";
import attachBackupInteractionHandler from "../../command-handlers/backupInteractionHandler.js";
import attachBotAddInteractionHandler from "../../command-handlers/botAddInteractionHandler.js";
import attachGuildConfigurationAdminHandler from "../../command-handlers/guildConfigurationAdminHandler.js";
import attachHealthInteractionHandler from "../../command-handlers/healthInteractionHandler.js";
import attachMaintenanceInteractionHandler from "../../command-handlers/maintenanceInteractionHandler.js";
import attachModerationInteractionHandler from "../../command-handlers/moderationInteractionHandler.js";
import attachSecurityInteractionHandler from "../../command-handlers/securityInteractionHandler.js";
import attachSourcesStatusHandler from "../../command-handlers/sourcesStatusHandler.js";

export function adminDescriptors(
  define: <D extends CommandHandlerDomain>(
    input: { id: string; domain: D; build: (context: CommandDomainDeps[D]) => CommandHandler }
      & Partial<Pick<CommandHandlerDescriptor<D>, "scope" | "access" | "help" | "autocomplete">>
  ) => CommandHandlerDescriptor<D>
): readonly AnyCommandHandlerDescriptor[] {
  return [
    define({ id: "source-status", domain: "admin", help: ["sources status"], build: context => attachSourcesStatusHandler.buildCommandHandler(context) }),
    define({ id: "configuration-admin", domain: "admin", help: ["reset-config", "admin-alerts"], build: context => attachGuildConfigurationAdminHandler.buildCommandHandler(context) }),
    define({ id: "security", domain: "admin", help: ["lock-channel", "unlock-channel", "purge", "purge-amount", "new-account-alerts", "threat-protection", "bot-add-protection"], build: context => attachSecurityInteractionHandler.buildCommandHandler(context) }),
    define({ id: "bot-add", domain: "admin", access: "admin", help: ["bot-add-request", "bot-add-permissions"], build: context => attachBotAddInteractionHandler.buildCommandHandler(context) }),
    define({ id: "admin-access", domain: "admin", access: "owner", help: ["admin-command-access"], build: context => attachAdminCommandAccessHandler.buildCommandHandler(context) }),
    define({ id: "moderation", domain: "admin", access: "mixed", help: ["timeout", "remove-timeout", "timeout-list", "mute", "unmute", "mute-list", "kick", "ban", "unban", "warn", "remove-warn", "warn-list", "warn-ban-limit"], build: context => attachModerationInteractionHandler.buildCommandHandler(context) }),
    define({ id: "backup", domain: "admin", help: ["backup"], build: context => attachBackupInteractionHandler.buildCommandHandler(context) }),
    define({ id: "audit-log", domain: "admin", help: ["bot-log", "server-log"], build: context => attachAuditLogInteractionHandler.buildCommandHandler(context) }),
    define({ id: "maintenance", domain: "admin", help: ["maintenance"], build: context => attachMaintenanceInteractionHandler.buildCommandHandler(context) }),
    define({ id: "health", domain: "admin", help: ["health"], build: context => attachHealthInteractionHandler.buildCommandHandler(context) }),
  ];
}
