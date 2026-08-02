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
    warningId: { type: String },
    userId: { type: String, required: true },
    username: { type: String, default: "" },
    moderatorId: { type: String, default: "" },
    warnedAt: { type: Date, required: true }
  }, { _id: false });

  const lockedChannelPermissionSchema = new mongoose.Schema({
    channelId: { type: String, required: true },
    sendMessages: { type: String, enum: ["allow", "deny", "inherit"], required: true }
  }, { _id: false });

  const botObservationEventSchema = new mongoose.Schema({
    key: { type: String, required: true },
    kind: { type: String, required: true },
    at: { type: Date, required: true },
    confirmed: { type: Boolean, required: true }
  }, { _id: false });

  const botObservationSchema = new mongoose.Schema({
    botId: { type: String, required: true },
    requesterId: { type: String, default: "" },
    approval: { type: String, enum: ["owner", "one-time", "unapproved-removal-failed"], required: true },
    initialRisk: { type: String, enum: ["normal", "suspicious", "dangerous"], required: true },
    joinedAt: { type: Date, required: true },
    observeUntil: { type: Date, required: true },
    lastActivityAt: { type: Date, required: true },
    eventKeys: { type: [String], default: [] },
    recentEvents: { type: [botObservationEventSchema], default: [] },
    lastBurstAlertAt: { type: Date, default: null }
  }, { _id: false });

  const guildModerationStateSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    schemaVersion: { type: Number, default: MODERATION_RECORD_SCHEMA_VERSION },
    moderationTimeouts: { type: [moderationRecordSchema], default: [] },
    moderationMutes: { type: [moderationRecordSchema], default: [] },
    moderationWarnings: { type: [warningRecordSchema], default: [] },
    moderationWarnBanLimit: { type: Number, default: 0, min: 0 }
  }, { versionKey: false, timestamps: true });

  return { moderationRecordSchema, warningRecordSchema, lockedChannelPermissionSchema, botObservationSchema, guildModerationStateSchema };
}
