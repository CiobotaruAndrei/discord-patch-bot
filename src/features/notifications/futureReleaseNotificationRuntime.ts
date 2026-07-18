"use strict";

import type { NotificationsRuntimeDeps } from "./notificationRuntimeContracts.js";
import type { OutboundChannelResolver } from "./outboxRuntimeFactory.js";
import { createFutureReleaseNotificationService } from "./futureReleaseNotificationService.js";

export function createFutureReleaseNotificationRuntime(
  deps: NotificationsRuntimeDeps,
  resolveOutboundChannel: OutboundChannelResolver
) {
  return createFutureReleaseNotificationService({
    GuildModel: deps.GuildModel,
    logger: deps.logger,
    resolveOutboundChannel,
    searchSteamGameByName: deps.searchSteamGameByName,
    chooseBestSteamMatch: deps.chooseBestSteamMatch,
    fetchSteamPriceDetails: deps.fetchSteamPriceDetails,
    DEFAULT_CURRENCY: deps.DEFAULT_CURRENCY
  });
}

export default { createFutureReleaseNotificationRuntime };
