"use strict";

import type { GuildSettings } from "./guildSettingsTypes.js";

export type GuildSettingsPatch = Partial<Omit<GuildSettings, "_id">>;
export type GuildSettingsField = keyof GuildSettingsPatch;

export const GUILD_SETTINGS_FIELDS: ReadonlySet<GuildSettingsField> = new Set([
  "subscribed", "notificationChannelId", "discountsSubscribed", "discountChannelId",
  "outboxRecoveryVerify", "minDiscountPercent", "includeFreeGames", "includePaidDiscounts", "notificationMode", "updateMessageTemplate",
  "discountMessageTemplate", "currency", "enabledGames", "commandSnoozes", "enabledStores", "maxAbsolutePrice", "notificationRoleId",
  "discountRoleId", "adminAlertChannelId", "priceAlerts", "youtubeChannels", "youtubeNotificationChannelId", "youtubeNotificationsEnabled",
  "youtubeHasActivated", "youtubeFilters", "youtubeMessageTemplate", "youtubeChannelRoutes", "youtubeTitleIncludeWords",
  "watchlistGameSuggestions", "futureReleaseGames", "playerCountSubscribed", "playerCountChannelId", "playerCountGames", "gameAliases",
  "timezone", "futureReleaseSubscribed", "futureReleaseChannelId", "dlcSubscribed", "dlcChannelId", "newAccountAlertChannelId",
  "newAccountAlertsEnabled", "threatAlertChannelId", "threatProtectionEnabled", "botAddAlertChannelId", "botAddProtectionEnabled",
  "botAddPermissions", "purgeAmount", "lockedChannelIds", "lockedChannelPreviousSendMessages", "pendingUpdates", "pendingDiscounts", "lastProcessedGameKey",
  "updatesInitializing", "updatesActivationId", "updatesLastError", "discountsInitializing", "discountsActivationId", "discountsLastError",
  "futureReleaseInitializing", "futureReleaseActivationId", "dlcInitializing", "dlcActivationId", "seenHashVersionUpdates", "seenHashVersionDiscounts"
]);

export function normalizeGuildSettings(value: GuildSettings): GuildSettings {
  return {
    ...value,
    settingsSchemaVersion: value.settingsSchemaVersion ?? 1,
    settingsVersion: value.settingsVersion ?? 0,
    enabledGames: Array.isArray(value.enabledGames) ? [...new Set(value.enabledGames.filter(Boolean))] : value.enabledGames,
    enabledStores: Array.isArray(value.enabledStores) ? [...new Set(value.enabledStores.filter(Boolean))] : value.enabledStores,
    playerCountGames: Array.isArray(value.playerCountGames) ? [...new Set(value.playerCountGames.filter(Boolean))] : value.playerCountGames
  };
}

export function applyGuildSettingsPatch(current: GuildSettings, patch: GuildSettingsPatch): GuildSettings {
  return normalizeGuildSettings({ ...current, ...patch, _id: current._id });
}
