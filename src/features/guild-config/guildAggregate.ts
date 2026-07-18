"use strict";

import type { GuildSettings } from "./guildSettingsTypes.js";

export type GuildSettingsPatch = Partial<Omit<GuildSettings, "_id">>;

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
