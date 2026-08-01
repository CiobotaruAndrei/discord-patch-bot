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
import attachHelpInteractionHandler from "../command-handlers/helpInteractionHandler.js";
import attachModerationInteractionHandler from "../command-handlers/moderationInteractionHandler.js";
import attachSecurityInteractionHandler from "../command-handlers/securityInteractionHandler.js";
import attachBotAddInteractionHandler from "../command-handlers/botAddInteractionHandler.js";
import attachPermissionRequestInteractionHandler from "../command-handlers/permissionRequestInteractionHandler.js";
import attachProtectedResourceInteractionHandler from "../command-handlers/protectedResourceInteractionHandler.js";
import attachAntiRaidInteractionHandler from "../command-handlers/antiRaidInteractionHandler.js";

type HandlerDeps<T> = T extends { buildCommandHandler: (context: infer D) => unknown } ? D : never;

export type GameInfoCommandDeps =
  HandlerDeps<typeof attachPlayerCountAnalyticsHandler>
  & HandlerDeps<typeof attachGameOverviewInteractionHandler>
  & HandlerDeps<typeof attachPriceCheckInteractionHandler>
  & HandlerDeps<typeof attachDealScoreInteractionHandler>
  & HandlerDeps<typeof attachGameInfoInteractionHandler>;

export type AdminCommandDeps =
  HandlerDeps<typeof attachSourcesStatusHandler>
  & HandlerDeps<typeof attachGuildConfigurationAdminHandler>
  & HandlerDeps<typeof attachSecurityInteractionHandler>
  & HandlerDeps<typeof attachBotAddInteractionHandler>
  & HandlerDeps<typeof attachPermissionRequestInteractionHandler>
  & HandlerDeps<typeof attachProtectedResourceInteractionHandler>
  & HandlerDeps<typeof attachAntiRaidInteractionHandler>
  & HandlerDeps<typeof attachAdminCommandAccessHandler>
  & HandlerDeps<typeof attachModerationInteractionHandler>
  & HandlerDeps<typeof attachBackupInteractionHandler>
  & HandlerDeps<typeof attachAuditLogInteractionHandler>
  & HandlerDeps<typeof attachMaintenanceInteractionHandler>
  & HandlerDeps<typeof attachHealthInteractionHandler>;

export type NotificationCommandDeps =
  HandlerDeps<typeof attachTemplatePreviewHandler>
  & HandlerDeps<typeof attachDlcInteractionHandler>
  & HandlerDeps<typeof attachPriceAlertInteractionHandler>
  & HandlerDeps<typeof attachFutureReleaseInteractionHandler>
  & HandlerDeps<typeof attachSubscriptionNotificationHandlers>;

export type ConfigurationCommandDeps =
  HandlerDeps<typeof attachCoverageAliasHandler>
  & HandlerDeps<typeof attachConfigInteractionHandler>
  & HandlerDeps<typeof attachWatchlistGameSuggestionHandler>
  & HandlerDeps<typeof attachSnoozeInteractionHandler>
  & HandlerDeps<typeof attachSetInteractionHandler>
  & HandlerDeps<typeof attachRolePingHandlers>
  & HandlerDeps<typeof attachGameFilterHandlers>;

export type CoreCommandDeps =
  HandlerDeps<typeof attachSuggestCommandInteractionHandler>
  & HandlerDeps<typeof attachReportInteractionHandler>
  & HandlerDeps<typeof attachStatusInteractionHandler>
  & HandlerDeps<typeof attachLatestInteractionHandler>
  & HandlerDeps<typeof attachSimpleCommandsHandler>
  & HandlerDeps<typeof attachHelpInteractionHandler>;

export type YouTubeCommandDeps = HandlerDeps<typeof attachYouTubeInteractionHandler>;

export type RoutingCommandDeps =
  HandlerDeps<typeof attachAutocompleteInteractionHandler>
  & HandlerDeps<typeof attachFallbackInteractionHandler>;

export type CommandDomainDeps = {
  "game-info": GameInfoCommandDeps;
  admin: AdminCommandDeps;
  notifications: NotificationCommandDeps;
  configuration: ConfigurationCommandDeps;
  core: CoreCommandDeps;
  youtube: YouTubeCommandDeps;
  routing: RoutingCommandDeps;
};

export type CommandDomain = keyof CommandDomainDeps;

type AssignableFromServices<D> = CommandAppServices extends D ? true : never;
type StrictlySmallerThanServices<D> = CommandAppServices extends D ? (D extends CommandAppServices ? never : true) : never;

export type DomainBundlesAreServiceSlices = {
  [K in CommandDomain]: AssignableFromServices<CommandDomainDeps[K]> extends true ? true : never;
};

export type DomainBundlesAreStrictSlices = {
  [K in CommandDomain]: StrictlySmallerThanServices<CommandDomainDeps[K]> extends true ? true : never;
};
