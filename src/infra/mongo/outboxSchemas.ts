import type * as Mongoose from "mongoose";
import type { MongoModelEnv } from "./mongoModelEnv.js";

export interface OutboxSchemasDeps {
  mongoose: typeof Mongoose;
  ONE_DAY_MS: number;
  env: MongoModelEnv;
}

export function buildOutboxSchemas({ mongoose, ONE_DAY_MS, env }: OutboxSchemasDeps) {
  const persistedEnvelopeSchema = new mongoose.Schema({
    kind: { type: String, required: true },
    schemaVersion: { type: Number, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true }
  }, { _id: false, minimize: false });
  const outboxHistoryEntrySchema = new mongoose.Schema({
    kind: { type: String, enum: ["update", "discount", "youtube"], required: true },
    gameKey: { type: String, default: "" },
    title: { type: String, default: "" },
    link: { type: String, default: "" },
    itemId: { type: String, default: "" }
  }, { _id: false });

  const notificationOutboxSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    channelId: { type: String, required: true },
    kind: { type: String, enum: ["update", "discount", "youtube"], required: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    payloadEnvelope: { type: persistedEnvelopeSchema, default: null },
    attempts: { type: Number, default: 0 },
    deliveries: { type: Number, default: 0 },
    availableAt: { type: Date, default: Date.now },
    lockedUntil: { type: Date, default: null },
    lockedBy: { type: String, default: null },
    leaseVersion: { type: Number, default: 0 },
    dedupeKey: { type: String },
    recoveryVerify: { type: Boolean, default: null },
    manual: { type: Boolean, default: false },
    history: { type: [outboxHistoryEntrySchema], default: [] },
    deliveryAcceptedAt: { type: Date, default: null },
    status: { type: String, enum: ["queued", "leased", "delivered-pending", "delivered", "dead-lettered", "dropped"], default: "queued" },
    statusChangedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now }
  }, { minimize: false });
  notificationOutboxSchema.index({ availableAt: 1, lockedUntil: 1 }, { background: true });
  notificationOutboxSchema.index(
    { createdAt: 1 },
    {
      background: true,
      expireAfterSeconds: 7 * ONE_DAY_MS / 1000,
      partialFilterExpression: { status: { $in: ["queued", "leased"] } }
    }
  );
  notificationOutboxSchema.index(
    { statusChangedAt: 1 },
    {
      background: true,
      expireAfterSeconds: env.NOTIFICATION_OUTBOX_SENT_TTL_HOURS * 3600,
      partialFilterExpression: { status: { $in: ["delivered", "dead-lettered", "dropped"] } }
    }
  );
  notificationOutboxSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true, background: true });

  const OUTBOX_SENT_TTL_HOURS = env.NOTIFICATION_OUTBOX_SENT_TTL_HOURS;
  const notificationOutboxSentSchema = new mongoose.Schema({
    dedupeKey: { type: String, required: true, unique: true },
    sentAt: { type: Date, default: Date.now, expires: OUTBOX_SENT_TTL_HOURS * 3600 }
  }, { minimize: false });

  const NOTIFICATION_HISTORY_TTL_DAYS = env.NOTIFICATION_HISTORY_TTL_DAYS;
  const notificationHistorySchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    kind: { type: String, enum: ["update", "discount", "youtube"], required: true },
    gameKey: { type: String, default: "" },
    title: { type: String, default: "" },
    link: { type: String, default: "" },
    dedupeKey: { type: String, default: "" },
    sentAt: { type: Date, default: Date.now, expires: NOTIFICATION_HISTORY_TTL_DAYS * ONE_DAY_MS / 1000 }
  }, { minimize: false });
  notificationHistorySchema.index({ guildId: 1, sentAt: -1 }, { background: true });
  notificationHistorySchema.index({ guildId: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $gt: "" } }, background: true });

  const DEAD_LETTER_REPLAY_TTL_DAYS = env.NOTIFICATION_DEAD_LETTER_REPLAY_TTL_DAYS;
  const deadLetterReplaySchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    kind: { type: String, enum: ["update", "discount", "youtube"], required: true },
    channelId: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    payloadEnvelope: { type: persistedEnvelopeSchema, default: null },
    dedupeKey: { type: String, default: "" },
    recoveryVerify: { type: Boolean, default: false },
    reason: { type: String, default: "" },
    itemId: { type: String, default: "" },
    history: { type: [mongoose.Schema.Types.Mixed], default: [] },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now, expires: DEAD_LETTER_REPLAY_TTL_DAYS * ONE_DAY_MS / 1000 }
  }, { minimize: false });
  deadLetterReplaySchema.index({ guildId: 1, createdAt: 1 }, { background: true });
  deadLetterReplaySchema.index({ guildId: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $gt: "" } }, background: true });

  return {
    outboxHistoryEntrySchema,
    notificationOutboxSchema,
    notificationOutboxSentSchema,
    notificationHistorySchema,
    deadLetterReplaySchema
  };
}
