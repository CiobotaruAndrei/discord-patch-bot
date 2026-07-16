import type * as Mongoose from "mongoose";

export interface GuildModerationSchemasDeps {
  mongoose: typeof Mongoose;
}

export const BOT_ADD_PERMISSION_STATUSES = ["pending", "approved", "used", "rejected", "expired", "cancelled"] as const;
export const MODERATION_RECORD_SCHEMA_VERSION = 1;

export function buildGuildModerationSchemas({ mongoose }: GuildModerationSchemasDeps) {
  const moderationRecordSchema = new mongoose.Schema({
    schemaVersion: { type: Number, default: MODERATION_RECORD_SCHEMA_VERSION },
    userId: { type: String, required: true },
    username: { type: String, default: "" },
    moderatorId: { type: String, default: "" },
    appliedAt: { type: Date, required: true },
    expiresAt: { type: Date, default: null },
    reason: { type: String }
  }, { _id: false });

  const warningRecordSchema = new mongoose.Schema({
    schemaVersion: { type: Number, default: MODERATION_RECORD_SCHEMA_VERSION },
    userId: { type: String, required: true },
    username: { type: String, default: "" },
    moderatorId: { type: String, default: "" },
    warnedAt: { type: Date, required: true },
    reason: { type: String }
  }, { _id: false });

  const botAddPermissionSchema = new mongoose.Schema({
    schemaVersion: { type: Number, default: MODERATION_RECORD_SCHEMA_VERSION },
    requestId: { type: String, required: true },
    botId: { type: String, required: true },
    requesterId: { type: String, required: true },
    requestedAt: { type: Date, required: true },
    ownerId: { type: String, default: null },
    respondedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    usedAt: { type: Date, default: null },
    status: { type: String, enum: BOT_ADD_PERMISSION_STATUSES, required: true }
  }, { _id: false });

  return { moderationRecordSchema, warningRecordSchema, botAddPermissionSchema };
}
