"use strict";

import type { LockedChannelPermissionState } from "../guild-config/guildConfigRepository.js";

export type GuildSettingsLike = {
  newAccountAlertChannelId?: string | null;
  newAccountAlertsEnabled?: boolean;
  threatAlertChannelId?: string | null;
  threatProtectionEnabled?: boolean;
  botAddAlertChannelId?: string | null;
  botAddProtectionEnabled?: boolean;
  botAddPermissions?: unknown;
  permissionRequestChannelId?: string | null;
  moderationGuardEnabled?: boolean;
  antiRaidAlertChannelId?: string | null;
  antiRaidDryRunEnabled?: boolean;
  adAlertChannelId?: string | null;
  adProtectionEnabled?: boolean;
  purgeAmount?: number;
  lockedChannelIds?: string[];
  lockedChannelPermissions?: Array<{ channelId: string; sendMessages: LockedChannelPermissionState }>;
} | null;

export type ProtectionChannelField = "newAccountAlertChannelId" | "threatAlertChannelId" | "botAddAlertChannelId" | "permissionRequestChannelId"
  | "antiRaidAlertChannelId"
  | "adAlertChannelId";
export type ProtectionEnabledField = "newAccountAlertsEnabled" | "threatProtectionEnabled" | "botAddProtectionEnabled" | "moderationGuardEnabled"
  | "antiRaidDryRunEnabled"
  | "adProtectionEnabled";
