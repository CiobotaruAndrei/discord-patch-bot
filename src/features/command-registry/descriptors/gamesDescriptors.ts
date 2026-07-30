import type { CommandHandler } from "../commandHandler.js";
import {
  CONFIGURATION_HANDLER_KEYS,
  COVERAGE_ALIAS_HANDLER_KEYS,
  DEAL_SCORE_HANDLER_KEYS,
  GAME_FILTER_HANDLER_KEYS,
  GAME_INFO_HANDLER_KEYS,
  GAME_OVERVIEW_HANDLER_KEYS,
  PLAYER_COUNT_HANDLER_KEYS,
  PRICE_CHECK_HANDLER_KEYS,
  ROLE_PING_HANDLER_KEYS,
  SET_HANDLER_KEYS,
  SNOOZE_HANDLER_KEYS,
  WATCHLIST_SUGGESTION_HANDLER_KEYS
} from "../commandHandlerKeys.js";
import type { CommandDomainDeps } from "../commandDomainDeps.js";
import type { CommandHandlerDomain, CommandHandlerDescriptor, AnyCommandHandlerDescriptor } from "../commandHandlerDescriptors.js";
import attachConfigInteractionHandler from "../../command-handlers/configInteractionHandler.js";
import attachCoverageAliasHandler from "../../command-handlers/watchlistCoverageAndAliasHandler.js";
import attachDealScoreInteractionHandler from "../../command-handlers/dealScoreInteractionHandler.js";
import attachGameFilterHandlers from "../../command-handlers/gameFilterHandlers.js";
import attachGameInfoInteractionHandler from "../../command-handlers/gameInfoInteractionHandler.js";
import attachGameOverviewInteractionHandler from "../../command-handlers/gameOverviewInteractionHandler.js";
import attachPlayerCountAnalyticsHandler from "../../command-handlers/playerCountAnalyticsHandler.js";
import attachPriceCheckInteractionHandler from "../../command-handlers/priceCheckInteractionHandler.js";
import attachRolePingHandlers from "../../command-handlers/rolePingHandlers.js";
import attachSetInteractionHandler from "../../command-handlers/setInteractionHandler.js";
import attachSnoozeInteractionHandler from "../../command-handlers/snoozeInteractionHandler.js";
import attachWatchlistGameSuggestionHandler from "../../command-handlers/watchlistGameSuggestionHandler.js";

export function gamesDescriptors(
  define: <D extends CommandHandlerDomain>(
    input: {
      id: string;
      domain: D;
      needs: readonly (keyof CommandDomainDeps[D])[];
      build: (context: CommandDomainDeps[D]) => CommandHandler;
    }
      & Partial<Pick<CommandHandlerDescriptor<D>, "scope" | "access" | "help" | "autocomplete">>
  ) => CommandHandlerDescriptor<D>
): readonly AnyCommandHandlerDescriptor[] {
  return [
    define({ id: "player-count", needs: PLAYER_COUNT_HANDLER_KEYS, domain: "game-info", help: ["player-count", "top active-games"], build: context => attachPlayerCountAnalyticsHandler.buildCommandHandler(context) }),
    define({ id: "game-overview", needs: GAME_OVERVIEW_HANDLER_KEYS, domain: "game-info", help: ["game overview"], build: context => attachGameOverviewInteractionHandler.buildCommandHandler(context) }),
    define({ id: "coverage-alias", needs: COVERAGE_ALIAS_HANDLER_KEYS, domain: "configuration", help: ["watchlist coverage", "watchlist alias"], build: context => attachCoverageAliasHandler.buildCommandHandler(context) }),
    define({ id: "configuration", needs: CONFIGURATION_HANDLER_KEYS, domain: "configuration", help: ["config"], build: context => attachConfigInteractionHandler.buildCommandHandler(context) }),
    define({ id: "watchlist-suggestion", needs: WATCHLIST_SUGGESTION_HANDLER_KEYS, domain: "configuration", help: ["watchlist suggest-game"], build: context => attachWatchlistGameSuggestionHandler.buildCommandHandler(context) }),
    define({ id: "price-check", needs: PRICE_CHECK_HANDLER_KEYS, domain: "game-info", help: ["price-check"], build: context => attachPriceCheckInteractionHandler.buildCommandHandler(context) }),
    define({ id: "deal-score", needs: DEAL_SCORE_HANDLER_KEYS, domain: "game-info", help: ["deal-score"], build: context => attachDealScoreInteractionHandler.buildCommandHandler(context) }),
    define({ id: "game-info", needs: GAME_INFO_HANDLER_KEYS, domain: "game-info", help: ["game-info", "top active-games"], build: context => attachGameInfoInteractionHandler.buildCommandHandler(context) }),
    define({ id: "snooze", needs: SNOOZE_HANDLER_KEYS, domain: "configuration", help: ["snooze", "unsnooze"], build: context => attachSnoozeInteractionHandler.buildCommandHandler(context) }),
    define({ id: "set", needs: SET_HANDLER_KEYS, domain: "configuration", help: ["set"], build: context => attachSetInteractionHandler.buildCommandHandler(context) }),
    define({ id: "role-ping", needs: ROLE_PING_HANDLER_KEYS, domain: "configuration", help: ["role-ping"], build: context => attachRolePingHandlers.buildCommandHandler(context) }),
    define({ id: "game-filter", needs: GAME_FILTER_HANDLER_KEYS, domain: "configuration", help: ["set games", "watchlist"], build: context => attachGameFilterHandlers.buildCommandHandler(context) }),
  ];
}
