"use strict";

import type { NotificationsRuntimeDeps } from "./notificationRuntimeContracts";

import { createSeenRepository } from "./seenRepository";

export function createSeenServices(deps: NotificationsRuntimeDeps) {
  const { GuildModel, GuildSeenDiscountModel, GuildSeenUpdateModel, withMongoRetry, SEEN_PER_GAME_LIMIT, DEALS_HISTORY_LIMIT, OP_UPDATE_OPTS } = deps;
  return createSeenRepository({
    GuildModel, GuildSeenDiscountModel, GuildSeenUpdateModel, withMongoRetry,
    SEEN_PER_GAME_LIMIT, DEALS_HISTORY_LIMIT, OP_UPDATE_OPTS, adminAlert: deps.adminAlert
  });
}

export type SeenServices = ReturnType<typeof createSeenServices>;
