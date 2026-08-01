"use strict";

import type { ProtectionChannelField, ProtectionEnabledField } from "./securityInteractionContracts.js";

export const SET_CHANNEL_FIELDS: Record<string, string> = {
  "new-account-alert-channel": "newAccountAlertChannelId",
  "threat-alert-channel": "threatAlertChannelId",
  "bot-add-alert-channel": "botAddAlertChannelId",
  "permission-request-channel": "permissionRequestChannelId",
  "warn-channel": "warningChannelId"
};

export const START_STOP_TOGGLE_FIELDS: Record<string, { channel: ProtectionChannelField; enabled: ProtectionEnabledField }> = {
  "new-account-alerts": { channel: "newAccountAlertChannelId", enabled: "newAccountAlertsEnabled" },
  "threat-protection": { channel: "threatAlertChannelId", enabled: "threatProtectionEnabled" },
  "bot-add-protection": { channel: "botAddAlertChannelId", enabled: "botAddProtectionEnabled" },
  "moderation-guard": { channel: "permissionRequestChannelId", enabled: "moderationGuardEnabled" }
};
