"use strict";

export type {
  DiscordEmbed,
  DiscordEmbedField,
  FormatPrice,
  SafeCheerioLoad
} from "./gameInfoEmbedPrimitives";
export {
  DEAL_COLOR,
  INFO_COLOR,
  RESULT_LIMIT_DEFAULT,
  RESULT_LIMIT_MAX,
  WARNING_COLOR,
  clampResultLimit,
  extractInstallSize,
  hasCategory,
  htmlToText,
  normalizeText,
  numericPrice,
  parseDateMs,
  platformList,
  requirementValue
} from "./gameInfoEmbedPrimitives";

export type { EndingDealsEmbedDeps } from "./dealsEmbeds";
export {
  buildBestDealsEmbed,
  buildEndingDealsEmbed,
  dealDiscount,
  dealScore,
  endText,
  findExternalStores,
  formatDealLine
} from "./dealsEmbeds";

export {
  buildCoopEmbed,
  buildCrossplayEmbed,
  buildPlatformsEmbed,
  buildReviewTrendEmbed
} from "./comparisonEmbeds";

export {
  buildGameSizeEmbed,
  buildSystemRequirementsEmbed
} from "./steamMetadataEmbeds";

export {
  buildPlayerCountEmbed,
  buildTopActiveGamesEmbed,
  formatPlayerCount,
  selectTopActiveGames
} from "./playerCountEmbeds";
