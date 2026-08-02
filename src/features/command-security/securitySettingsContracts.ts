"use strict";

import type { LockedChannelPermissionState } from "../guild-config/guildConfigRepository.js";

export type GuildSettingsLike = {
  newAccountAlertChannelId?: string | null;
  newAccountAlertsEnabled?: boolean;
  threatAlertChannelId?: string | null;
  threatProtectionEnabled?: boolean;
  permissionRequestChannelId?: string | null;
  moderationGuardEnabled?: boolean;
  antiRaidAlertChannelId?: string | null;
  antiRaidEnabled?: boolean;
  antiRaidDryRunEnabled?: boolean;
  antiRaidThresholds?: Record<string, unknown> | null;
  adAlertChannelId?: string | null;
  adProtectionEnabled?: boolean;
  purgeAmount?: number;
  lockedChannelIds?: string[];
  lockedChannelPermissions?: Array<{ channelId: string; sendMessages: LockedChannelPermissionState }>;
} | null;

export type ProtectionChannelField = "newAccountAlertChannelId" | "threatAlertChannelId" | "permissionRequestChannelId"
  | "antiRaidAlertChannelId"
  | "adAlertChannelId";
export type ProtectionEnabledField = "newAccountAlertsEnabled" | "threatProtectionEnabled" | "moderationGuardEnabled" | "antiRaidEnabled"
  | "antiRaidDryRunEnabled"
  | "adProtectionEnabled";
