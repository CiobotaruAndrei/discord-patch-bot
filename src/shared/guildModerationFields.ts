export const MODERATION_FIELDS = [
  "moderationTimeouts",
  "moderationMutes",
  "moderationWarnings",
  "moderationWarnBanLimit"
] as const;

export type ModerationField = (typeof MODERATION_FIELDS)[number];
