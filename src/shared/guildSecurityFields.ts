export const SECURITY_FIELDS = [
  "newAccountAlertChannelId",
  "newAccountAlertsEnabled",
  "threatAlertChannelId",
  "threatProtectionEnabled",
  "botAddAlertChannelId",
  "botAddProtectionEnabled",
  "warningChannelId",
  "botAddPermissions",
  "botObservations",
  "purgeAmount",
  "lockedChannelIds",
  "lockedChannelPermissions"
] as const;

export type SecurityField = (typeof SECURITY_FIELDS)[number];
