import type { CommandHandler } from "../commandHandler.js";
import { ADMIN_ACCESS_HANDLER_KEYS } from "../../command-handlers/adminCommandAccessHandler.js";
import { AUDIT_LOG_HANDLER_KEYS } from "../../command-handlers/auditLogInteractionHandler.js";
import { BACKUP_HANDLER_KEYS } from "../../command-handlers/backupInteractionHandler.js";
import { BOT_ADD_HANDLER_KEYS } from "../../command-handlers/botAddInteractionHandler.js";
import { PERMISSION_REQUEST_HANDLER_KEYS } from "../../command-handlers/permissionRequestInteractionHandler.js";
import { PROTECTED_RESOURCE_HANDLER_KEYS } from "../../command-handlers/protectedResourceInteractionHandler.js";
import { ANTI_RAID_HANDLER_KEYS } from "../../command-handlers/antiRaidInteractionHandler.js";
import { CONFIGURATION_ADMIN_HANDLER_KEYS } from "../../command-handlers/guildConfigurationAdminHandler.js";
import { HEALTH_HANDLER_KEYS } from "../../command-handlers/healthInteractionHandler.js";
import { MAINTENANCE_HANDLER_KEYS } from "../../command-handlers/maintenanceInteractionHandler.js";
import { MODERATION_HANDLER_KEYS } from "../../command-handlers/moderationInteractionHandler.js";
import { SECURITY_HANDLER_KEYS } from "../../command-security/securityHandlerKeys.js";
import { SOURCE_STATUS_HANDLER_KEYS } from "../../command-handlers/sourcesStatusHandler.js";
import type { CommandDomainDeps } from "../commandDomainDeps.js";
import type { DefineDescriptor, AnyCommandHandlerDescriptor } from "../commandHandlerDescriptors.js";
import attachAdminCommandAccessHandler from "../../command-handlers/adminCommandAccessHandler.js";
import attachAuditLogInteractionHandler from "../../command-handlers/auditLogInteractionHandler.js";
import attachBackupInteractionHandler from "../../command-handlers/backupInteractionHandler.js";
import attachBotAddInteractionHandler from "../../command-handlers/botAddInteractionHandler.js";
import attachPermissionRequestInteractionHandler from "../../command-handlers/permissionRequestInteractionHandler.js";
import attachProtectedResourceInteractionHandler from "../../command-handlers/protectedResourceInteractionHandler.js";
import attachAntiRaidInteractionHandler from "../../command-handlers/antiRaidInteractionHandler.js";
import attachGuildConfigurationAdminHandler from "../../command-handlers/guildConfigurationAdminHandler.js";
import attachHealthInteractionHandler from "../../command-handlers/healthInteractionHandler.js";
import attachMaintenanceInteractionHandler from "../../command-handlers/maintenanceInteractionHandler.js";
import attachModerationInteractionHandler from "../../command-handlers/moderationInteractionHandler.js";
import attachSecurityInteractionHandler from "../../command-handlers/securityInteractionHandler.js";
import attachSourcesStatusHandler from "../../command-handlers/sourcesStatusHandler.js";

export function adminDescriptors(
  define: DefineDescriptor
): readonly AnyCommandHandlerDescriptor[] {
  return [
    define({ id: "source-status", needs: SOURCE_STATUS_HANDLER_KEYS, domain: "admin", help: ["sources status"], build: context => attachSourcesStatusHandler.buildCommandHandler(context) }),
    define({ id: "configuration-admin", needs: CONFIGURATION_ADMIN_HANDLER_KEYS, domain: "admin", help: ["reset-config", "admin-alerts"], build: context => attachGuildConfigurationAdminHandler.buildCommandHandler(context) }),
    define({ id: "security", needs: SECURITY_HANDLER_KEYS, domain: "admin", help: ["lock-channel", "unlock-channel", "purge", "purge-amount", "new-account-alerts", "threat-protection", "bot-add-protection", "moderation-guard"], build: context => attachSecurityInteractionHandler.buildCommandHandler(context) }),
    define({ id: "bot-add", needs: BOT_ADD_HANDLER_KEYS, domain: "admin", access: "admin", help: ["bot-add-request", "bot-add-permissions"], build: context => attachBotAddInteractionHandler.buildCommandHandler(context) }),
    define({ id: "permission-request", needs: PERMISSION_REQUEST_HANDLER_KEYS, domain: "admin", help: ["permission-request", "permission-requests list"], build: context => attachPermissionRequestInteractionHandler.buildCommandHandler(context) }),
    define({ id: "protected-resource", needs: PROTECTED_RESOURCE_HANDLER_KEYS, domain: "admin", help: ["protected-resource"], build: context => attachProtectedResourceInteractionHandler.buildCommandHandler(context) }),
    define({ id: "anti-raid", needs: ANTI_RAID_HANDLER_KEYS, domain: "admin", help: ["anti-raid status", "anti-raid participant-list", "anti-raid force-start", "anti-raid force-stop", "anti-raid participant-add", "anti-raid participant-remove"], build: context => attachAntiRaidInteractionHandler.buildCommandHandler(context) }),
    define({ id: "admin-access", needs: ADMIN_ACCESS_HANDLER_KEYS, domain: "admin", access: "owner", help: ["admin-command-access"], build: context => attachAdminCommandAccessHandler.buildCommandHandler(context) }),
    define({ id: "moderation", needs: MODERATION_HANDLER_KEYS, domain: "admin", access: "mixed", help: ["timeout", "remove-timeout", "timeout-list", "mute", "unmute", "mute-list", "kick", "ban", "unban", "warn", "remove-warn", "warn-list", "warn-ban-limit"], build: context => attachModerationInteractionHandler.buildCommandHandler(context) }),
    define({ id: "backup", needs: BACKUP_HANDLER_KEYS, domain: "admin", help: ["backup"], build: context => attachBackupInteractionHandler.buildCommandHandler(context) }),
    define({ id: "audit-log", needs: AUDIT_LOG_HANDLER_KEYS, domain: "admin", help: ["bot-log", "server-log"], build: context => attachAuditLogInteractionHandler.buildCommandHandler(context) }),
    define({ id: "maintenance", needs: MAINTENANCE_HANDLER_KEYS, domain: "admin", help: ["maintenance"], build: context => attachMaintenanceInteractionHandler.buildCommandHandler(context) }),
    define({ id: "health", needs: HEALTH_HANDLER_KEYS, domain: "admin", help: ["health"], build: context => attachHealthInteractionHandler.buildCommandHandler(context) }),
  ];
}
