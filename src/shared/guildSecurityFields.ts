export const SECURITY_FIELDS = [
  "newAccountAlertChannelId",
  "newAccountAlertsEnabled",
  "threatAlertChannelId",
  "threatProtectionEnabled",
  "warningChannelId",
  "botObservations",
  "purgeAmount",
  "lockedChannelIds",
  "lockedChannelPermissions"
] as const;

export type SecurityField = (typeof SECURITY_FIELDS)[number];
