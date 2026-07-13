"use strict";

export type {
  DiscordEmbed,
  DiscordEmbedField,
  FormatPrice,
  SafeCheerioLoad
} from "./gameInfoEmbedPrimitives.js";
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
} from "./gameInfoEmbedPrimitives.js";

export type { EndingDealsEmbedDeps } from "./dealsEmbeds.js";
export {
  buildBestDealsEmbed,
  buildEndingDealsEmbed,
  dealDiscount,
  dealScore,
  endText,
  findExternalStores,
  formatDealLine
} from "./dealsEmbeds.js";

export {
  buildCoopEmbed,
  buildCrossplayEmbed,
  buildPlatformsEmbed,
  buildReviewTrendEmbed
} from "./comparisonEmbeds.js";

export {
  buildGameSizeEmbed,
  buildSystemRequirementsEmbed
} from "./steamMetadataEmbeds.js";

export {
  buildPlayerCountEmbed,
  buildTopActiveGamesEmbed,
  formatPlayerCount,
  selectTopActiveGames
} from "./playerCountEmbeds.js";
