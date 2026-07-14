import type { CommandHandler } from "./commandHandler.js";
import type { CommandAppServices } from "./commandRegistry.js";
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

export type CommandHandlerDomain = "routing" | "core" | "configuration" | "notifications" | "game-info" | "youtube" | "admin";

export interface CommandHandlerDescriptor {
  id: string;
  domain: CommandHandlerDomain;
  build(context: CommandAppServices): CommandHandler;
}

export function createCommandHandlerDescriptors(): readonly CommandHandlerDescriptor[] {
  const descriptors: readonly CommandHandlerDescriptor[] = [
    { id: "autocomplete", domain: "routing", build: context => attachAutocompleteInteractionHandler.buildCommandHandler(context) },
    { id: "player-count", domain: "game-info", build: context => attachPlayerCountAnalyticsHandler.buildCommandHandler(context) },
    { id: "game-overview", domain: "game-info", build: context => attachGameOverviewInteractionHandler.buildCommandHandler(context) },
    { id: "coverage-alias", domain: "configuration", build: context => attachCoverageAliasHandler.buildCommandHandler(context) },
    { id: "template-preview", domain: "notifications", build: context => attachTemplatePreviewHandler.buildCommandHandler(context) },
    { id: "dlc", domain: "notifications", build: context => attachDlcInteractionHandler.buildCommandHandler(context) },
    { id: "source-status", domain: "admin", build: context => attachSourcesStatusHandler.buildCommandHandler(context) },
    { id: "configuration", domain: "configuration", build: context => attachConfigInteractionHandler.buildCommandHandler(context) },
    { id: "configuration-admin", domain: "admin", build: context => attachGuildConfigurationAdminHandler.buildCommandHandler(context) },
    { id: "admin-access", domain: "admin", build: context => attachAdminCommandAccessHandler.buildCommandHandler(context) },
    { id: "price-alert", domain: "notifications", build: context => attachPriceAlertInteractionHandler.buildCommandHandler(context) },
    { id: "backup", domain: "admin", build: context => attachBackupInteractionHandler.buildCommandHandler(context) },
    { id: "audit-log", domain: "admin", build: context => attachAuditLogInteractionHandler.buildCommandHandler(context) },
    { id: "suggest-command", domain: "core", build: context => attachSuggestCommandInteractionHandler.buildCommandHandler(context) },
    { id: "watchlist-suggestion", domain: "configuration", build: context => attachWatchlistGameSuggestionHandler.buildCommandHandler(context) },
    { id: "price-check", domain: "game-info", build: context => attachPriceCheckInteractionHandler.buildCommandHandler(context) },
    { id: "deal-score", domain: "game-info", build: context => attachDealScoreInteractionHandler.buildCommandHandler(context) },
    { id: "game-info", domain: "game-info", build: context => attachGameInfoInteractionHandler.buildCommandHandler(context) },
    { id: "maintenance", domain: "admin", build: context => attachMaintenanceInteractionHandler.buildCommandHandler(context) },
    { id: "future-release", domain: "notifications", build: context => attachFutureReleaseInteractionHandler.buildCommandHandler(context) },
    { id: "youtube", domain: "youtube", build: context => attachYouTubeInteractionHandler.buildCommandHandler(context) },
    { id: "snooze", domain: "configuration", build: context => attachSnoozeInteractionHandler.buildCommandHandler(context) },
    { id: "health", domain: "admin", build: context => attachHealthInteractionHandler.buildCommandHandler(context) },
    { id: "report", domain: "core", build: context => attachReportInteractionHandler.buildCommandHandler(context) },
    { id: "status", domain: "core", build: context => attachStatusInteractionHandler.buildCommandHandler(context) },
    { id: "latest", domain: "core", build: context => attachLatestInteractionHandler.buildCommandHandler(context) },
    { id: "set", domain: "configuration", build: context => attachSetInteractionHandler.buildCommandHandler(context) },
    { id: "role-ping", domain: "configuration", build: context => attachRolePingHandlers.buildCommandHandler(context) },
    { id: "game-filter", domain: "configuration", build: context => attachGameFilterHandlers.buildCommandHandler(context) },
    { id: "subscription", domain: "notifications", build: context => attachSubscriptionNotificationHandlers.buildCommandHandler(context) },
    { id: "simple", domain: "core", build: context => attachSimpleCommandsHandler.buildCommandHandler(context) },
    { id: "fallback", domain: "routing", build: context => attachFallbackInteractionHandler.buildCommandHandler(context) }
  ];
  const ids = new Set(descriptors.map(descriptor => descriptor.id));
  if (ids.size !== descriptors.length) throw new Error("Registrul handler-elor contine identificatori duplicati");
  return descriptors;
}
