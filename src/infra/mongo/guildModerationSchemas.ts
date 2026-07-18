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
    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String, enum: ["protection-stopped"], default: null },
    status: { type: String, enum: BOT_ADD_PERMISSION_STATUSES, required: true }
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

  return { moderationRecordSchema, warningRecordSchema, botAddPermissionSchema, lockedChannelPermissionSchema, botObservationSchema };
}
