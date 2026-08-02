"use strict";

import type { ProtectionChannelField, ProtectionEnabledField } from "./securitySettingsContracts.js";

export const SET_CHANNEL_FIELDS: Record<string, string> = {
  "new-account-alert-channel": "newAccountAlertChannelId",
  "threat-alert-channel": "threatAlertChannelId",
  "permission-request-channel": "permissionRequestChannelId",
  "anti-raid-alert-channel": "antiRaidAlertChannelId",
  "ad-alert-channel": "adAlertChannelId",
  "warn-channel": "warningChannelId"
};

export const START_STOP_TOGGLE_FIELDS: Record<string, { channel: ProtectionChannelField; enabled: ProtectionEnabledField }> = {
  "new-account-alerts": { channel: "newAccountAlertChannelId", enabled: "newAccountAlertsEnabled" },
  "threat-protection": { channel: "threatAlertChannelId", enabled: "threatProtectionEnabled" },
  "moderation-guard": { channel: "permissionRequestChannelId", enabled: "moderationGuardEnabled" },
  "anti-raid": { channel: "antiRaidAlertChannelId", enabled: "antiRaidEnabled" },
  "anti-raid-dry-run": { channel: "antiRaidAlertChannelId", enabled: "antiRaidDryRunEnabled" },
  "ad-protection": { channel: "adAlertChannelId", enabled: "adProtectionEnabled" }
};

export const SECURITY_THRESHOLD_SUBCOMMANDS: readonly string[] = ["anti-raid-thresholds"];

export function isSecuritySetSubcommand(subcommand: string): boolean {
  return Object.hasOwn(SET_CHANNEL_FIELDS, subcommand) || SECURITY_THRESHOLD_SUBCOMMANDS.includes(subcommand);
}
