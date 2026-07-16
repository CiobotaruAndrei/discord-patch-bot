import type { CommandHandler } from "./commandHandler.js";
import type { CommandAppServices } from "./commandRegistry.js";
import type { CommandDomainDeps } from "./commandDomainDeps.js";
import attachFallbackInteractionHandler from "../command-handlers/fallbackInteractionHandler.js";
import attachSimpleCommandsHandler from "../command-handlers/simpleCommandsHandler.js";
import attachSubscriptionNotificationHandlers from "../command-handlers/subscriptionNotificationHandlers.js";
import attachGameFilterHandlers from "../command-handlers/gameFilterHandlers.js";
import attachRolePingHandlers from "../command-handlers/rolePingHandlers.js";
import attachSetInteractionHandler from "../command-handlers/setInteractionHandler.js";
import attachLatestInteractionHandler from "../command-handlers/latestInteractionHandler.js";
import attachStatusInteractionHandler from "../command-handlers/statusInteractionHandler.js";
import attachReportInteractionHandler from "../command-handlers/reportInteractionHandler.js";
import attachHealthInteractionHandler from "../command-handlers/healthInteractionHandler.js";
import attachConfigInteractionHandler from "../command-handlers/configInteractionHandler.js";
import attachGuildConfigurationAdminHandler from "../command-handlers/guildConfigurationAdminHandler.js";
import attachAdminCommandAccessHandler from "../command-handlers/adminCommandAccessHandler.js";
import attachPriceAlertInteractionHandler from "../command-handlers/priceAlertInteractionHandler.js";
import attachBackupInteractionHandler from "../command-handlers/backupInteractionHandler.js";
import attachAuditLogInteractionHandler from "../command-handlers/auditLogInteractionHandler.js";
import attachSuggestCommandInteractionHandler from "../command-handlers/suggestCommandInteractionHandler.js";
import attachWatchlistGameSuggestionHandler from "../command-handlers/watchlistGameSuggestionHandler.js";
import attachPriceCheckInteractionHandler from "../command-handlers/priceCheckInteractionHandler.js";
import attachDealScoreInteractionHandler from "../command-handlers/dealScoreInteractionHandler.js";
import attachGameInfoInteractionHandler from "../command-handlers/gameInfoInteractionHandler.js";
import attachMaintenanceInteractionHandler from "../command-handlers/maintenanceInteractionHandler.js";
import attachFutureReleaseInteractionHandler from "../command-handlers/futureReleaseInteractionHandler.js";
import attachYouTubeInteractionHandler from "../command-handlers/youtubeInteractionHandler.js";
import attachSnoozeInteractionHandler from "../command-handlers/snoozeInteractionHandler.js";
import attachSourcesStatusHandler from "../command-handlers/sourcesStatusHandler.js";
import attachDlcInteractionHandler from "../command-handlers/dlcInteractionHandler.js";
import attachGameOverviewInteractionHandler from "../command-handlers/gameOverviewInteractionHandler.js";
import attachPlayerCountAnalyticsHandler from "../command-handlers/playerCountAnalyticsHandler.js";
import attachCoverageAliasHandler from "../command-handlers/watchlistCoverageAndAliasHandler.js";
import attachTemplatePreviewHandler from "../command-handlers/templateAndNotificationPreviewHandler.js";
import attachAutocompleteInteractionHandler from "../command-handlers/autocompleteInteractionHandler.js";
import attachHelpInteractionHandler from "../command-handlers/helpInteractionHandler.js";
import attachModerationInteractionHandler from "../command-handlers/moderationInteractionHandler.js";
import attachSecurityInteractionHandler from "../command-handlers/securityInteractionHandler.js";
import attachBotAddInteractionHandler from "../command-handlers/botAddInteractionHandler.js";

export type CommandHandlerDomain = "routing" | "core" | "configuration" | "notifications" | "game-info" | "youtube" | "admin";

export interface CommandHandlerDescriptor {
  id: string;
  domain: CommandHandlerDomain;
  scope: "global" | "guild-only";
  access: "public" | "admin" | "owner" | "mixed";
  help: readonly string[];
  autocomplete: readonly string[];
  build(context: CommandAppServices): CommandHandler;
}

export function buildNarrowCommandHandler<Dependencies extends object, Result extends CommandHandler>(
  factory: (dependencies: Dependencies) => Result,
  services: Dependencies
): Result {
  return factory(services);
}

export function createCommandHandlerDescriptors(): readonly CommandHandlerDescriptor[] {
  function define<D extends CommandHandlerDomain>(
    input: { id: string; domain: D; build: (context: CommandDomainDeps[D]) => CommandHandler }
      & Partial<Pick<CommandHandlerDescriptor, "scope" | "access" | "help" | "autocomplete">>
  ): CommandHandlerDescriptor {
    return {
      scope: "guild-only",
      access: input.domain === "admin" ? "admin" : "public",
      help: [input.id],
      autocomplete: [],
      ...input,
      build: input.build as CommandHandlerDescriptor["build"]
    };
  }
  const descriptors: readonly CommandHandlerDescriptor[] = [
    define({ id: "autocomplete", domain: "routing", scope: "global", help: [], autocomplete: ["slash-options"], build: context => attachAutocompleteInteractionHandler.buildCommandHandler(context) }),
    define({ id: "player-count", domain: "game-info", help: ["player-count", "top active-games"], build: context => attachPlayerCountAnalyticsHandler.buildCommandHandler(context) }),
    define({ id: "game-overview", domain: "game-info", help: ["game overview"], build: context => attachGameOverviewInteractionHandler.buildCommandHandler(context) }),
    define({ id: "coverage-alias", domain: "configuration", help: ["watchlist coverage", "watchlist alias"], build: context => attachCoverageAliasHandler.buildCommandHandler(context) }),
    define({ id: "template-preview", domain: "notifications", help: ["template preview", "notification preview"], build: context => attachTemplatePreviewHandler.buildCommandHandler(context) }),
    define({ id: "dlc", domain: "notifications", help: ["dlc"], build: context => attachDlcInteractionHandler.buildCommandHandler(context) }),
    define({ id: "source-status", domain: "admin", help: ["sources status"], build: context => attachSourcesStatusHandler.buildCommandHandler(context) }),
    define({ id: "configuration", domain: "configuration", help: ["config"], build: context => attachConfigInteractionHandler.buildCommandHandler(context) }),
    define({ id: "configuration-admin", domain: "admin", help: ["reset-config", "admin-alerts"], build: context => attachGuildConfigurationAdminHandler.buildCommandHandler(context) }),
    define({ id: "security", domain: "admin", help: ["lock-channel", "unlock-channel", "purge", "purge-amount", "new-account-alerts", "threat-protection", "bot-add-protection"], build: context => attachSecurityInteractionHandler.buildCommandHandler(context) }),
    define({ id: "bot-add", domain: "admin", access: "admin", help: ["bot-add-request", "bot-add-permissions"], build: context => attachBotAddInteractionHandler.buildCommandHandler(context) }),
    define({ id: "admin-access", domain: "admin", access: "owner", help: ["admin-command-access"], build: context => attachAdminCommandAccessHandler.buildCommandHandler(context) }),
    define({ id: "moderation", domain: "admin", access: "mixed", help: ["timeout", "remove-timeout", "timeout-list", "mute", "unmute", "mute-list", "kick", "ban", "unban", "warn", "remove-warn", "warn-list", "warn-ban-limit"], build: context => attachModerationInteractionHandler.buildCommandHandler(context) }),
    define({ id: "price-alert", domain: "notifications", help: ["price-alert"], build: context => attachPriceAlertInteractionHandler.buildCommandHandler(context) }),
    define({ id: "backup", domain: "admin", help: ["backup"], build: context => attachBackupInteractionHandler.buildCommandHandler(context) }),
    define({ id: "audit-log", domain: "admin", help: ["bot-log", "server-log"], build: context => attachAuditLogInteractionHandler.buildCommandHandler(context) }),
    define({ id: "suggest-command", domain: "core", help: ["suggest-command"], build: context => attachSuggestCommandInteractionHandler.buildCommandHandler(context) }),
    define({ id: "watchlist-suggestion", domain: "configuration", help: ["watchlist suggest-game"], build: context => attachWatchlistGameSuggestionHandler.buildCommandHandler(context) }),
    define({ id: "price-check", domain: "game-info", help: ["price-check"], build: context => attachPriceCheckInteractionHandler.buildCommandHandler(context) }),
    define({ id: "deal-score", domain: "game-info", help: ["deal-score"], build: context => attachDealScoreInteractionHandler.buildCommandHandler(context) }),
    define({ id: "game-info", domain: "game-info", help: ["game-info", "top active-games"], build: context => attachGameInfoInteractionHandler.buildCommandHandler(context) }),
    define({ id: "maintenance", domain: "admin", help: ["maintenance"], build: context => attachMaintenanceInteractionHandler.buildCommandHandler(context) }),
    define({ id: "future-release", domain: "notifications", help: ["future-release"], build: context => attachFutureReleaseInteractionHandler.buildCommandHandler(context) }),
    define({ id: "youtube", domain: "youtube", help: ["youtube"], build: context => attachYouTubeInteractionHandler.buildCommandHandler(context) }),
    define({ id: "snooze", domain: "configuration", help: ["snooze", "unsnooze"], build: context => attachSnoozeInteractionHandler.buildCommandHandler(context) }),
    define({ id: "health", domain: "admin", help: ["health"], build: context => attachHealthInteractionHandler.buildCommandHandler(context) }),
    define({ id: "report", domain: "core", help: ["report"], build: context => attachReportInteractionHandler.buildCommandHandler(context) }),
    define({ id: "status", domain: "core", help: ["status"], build: context => attachStatusInteractionHandler.buildCommandHandler(context) }),
    define({ id: "latest", domain: "core", help: ["latest"], build: context => attachLatestInteractionHandler.buildCommandHandler(context) }),
    define({ id: "set", domain: "configuration", help: ["set"], build: context => attachSetInteractionHandler.buildCommandHandler(context) }),
    define({ id: "role-ping", domain: "configuration", help: ["role-ping"], build: context => attachRolePingHandlers.buildCommandHandler(context) }),
    define({ id: "game-filter", domain: "configuration", help: ["set games", "watchlist"], build: context => attachGameFilterHandlers.buildCommandHandler(context) }),
    define({ id: "subscription", domain: "notifications", help: ["start", "stop"], build: context => attachSubscriptionNotificationHandlers.buildCommandHandler(context) }),
    define({ id: "simple", domain: "core", scope: "global", help: ["ping", "games"], build: context => attachSimpleCommandsHandler.buildCommandHandler(context) }),
    define({ id: "help", domain: "core", scope: "global", help: ["help"], autocomplete: ["help command"], build: context => attachHelpInteractionHandler.buildCommandHandler(context) }),
    define({ id: "fallback", domain: "routing", scope: "global", access: "mixed", help: [], build: context => attachFallbackInteractionHandler.buildCommandHandler(context) })
  ];
  const ids = new Set(descriptors.map(descriptor => descriptor.id));
  if (ids.size !== descriptors.length) throw new Error("Registrul handler-elor contine identificatori duplicati");
  return descriptors;
}
