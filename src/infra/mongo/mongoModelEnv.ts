import type { RuntimeEnv } from "../../config/runtimeEnvTypes.js";

export type MongoModelEnv = Pick<RuntimeEnv,
  | "GUILD_SEEN_DISCOUNT_TTL_DAYS"
  | "GUILD_AUDIT_LOG_TTL_DAYS"
  | "NOTIFICATION_OUTBOX_SENT_TTL_HOURS"
  | "NOTIFICATION_HISTORY_TTL_DAYS"
  | "FEEDBACK_REPORT_TTL_DAYS"
  | "NOTIFICATION_DEAD_LETTER_REPLAY_TTL_DAYS"
>;
