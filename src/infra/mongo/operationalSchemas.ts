import type * as Mongoose from "mongoose";
import type { RuntimeEnv } from "../../types.js";

export interface OperationalSchemasDeps {
  mongoose: typeof Mongoose;
  ONE_DAY_MS: number;
  env: RuntimeEnv;
}

export function buildOperationalSchemas({ mongoose, ONE_DAY_MS, env }: OperationalSchemasDeps) {
  const circuitBreakerSchema = new mongoose.Schema({
    _id: String,
    fails: { type: Number, default: 0 },
    cooldownUntil: { type: Date, default: null },
    alertSent: { type: Boolean, default: false },
    schemaDriftFails: { type: Number, default: 0 },
    schemaDriftAlertSent: { type: Boolean, default: false }
  }, { minimize: false });

  const systemSchema = new mongoose.Schema({
    _id: { type: String, default: "system_state" },
    executionTimes: {
      all: { type: Number, default: 35000 },
      single: { type: Number, default: 2000 },
      reduceri: { type: Number, default: 10000 }
    },
    outboxPaused: { type: Boolean, default: false }
  }, { minimize: false });

  const jobLockSchema = new mongoose.Schema({
    _id: String,
    lockedUntil: { type: Date, default: null, index: true },
    ownerToken: { type: String, default: null }
  }, { minimize: false });

  const adminAlertCooldownSchema = new mongoose.Schema({
    _id: String,
    lastSentAt: { type: Date, default: Date.now, expires: 7 * ONE_DAY_MS / 1000 }
  }, { minimize: false });

  const fetchSnapshotSchema = new mongoose.Schema({
    _id: String,
    payload: { type: mongoose.Schema.Types.Mixed, default: null },
    fetchedAt: { type: Date, default: Date.now, expires: ONE_DAY_MS / 1000 }
  }, { minimize: false });

  const playerCountSnapshotSchema = new mongoose.Schema({
    _id: String,
    gameKey: { type: String, default: "" },
    playerCount: { type: Number, default: 0 },
    fetchedAt: { type: Date, default: Date.now, expires: ONE_DAY_MS / 1000 }
  }, { minimize: false });

  const playerCountHistorySchema = new mongoose.Schema({
    appId: { type: String, required: true },
    gameKey: { type: String, default: "" },
    playerCount: { type: Number, required: true, min: 0 },
    fetchedAt: { type: Date, default: Date.now, expires: 31 * ONE_DAY_MS / 1000 }
  }, { minimize: false });
  playerCountHistorySchema.index({ appId: 1, fetchedAt: 1 }, { background: true });
  playerCountHistorySchema.index({ gameKey: 1, fetchedAt: 1 }, { background: true });

  const playerCountRecordSchema = new mongoose.Schema({
    _id: String,
    gameKey: { type: String, default: "" },
    playerCount: { type: Number, required: true, min: 0 },
    reachedAt: { type: Date, required: true }
  }, { minimize: false });

  const bugReportSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    reportType: { type: String, required: true },
    gameKey: { type: String, required: true },
    description: { type: String, required: true, maxlength: 1000 },
    authorId: { type: String, required: true },
    dedupeKey: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
  }, { minimize: false });
  bugReportSchema.index({ guildId: 1, dedupeKey: 1 }, { unique: true, background: true });
  bugReportSchema.index({ guildId: 1, createdAt: -1 }, { background: true });

  const userComplaintSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    reporterId: { type: String, required: true },
    targetId: { type: String, required: true },
    reason: { type: String, required: true, maxlength: 1000 },
    dedupeKey: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
  }, { minimize: false });
  userComplaintSchema.index({ guildId: 1, dedupeKey: 1 }, { unique: true, background: true });
  userComplaintSchema.index({ guildId: 1, createdAt: -1 }, { background: true });

  const FEEDBACK_REPORT_TTL_DAYS = env.FEEDBACK_REPORT_TTL_DAYS;
  const feedbackReportSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    userId: { type: String, default: "" },
    type: { type: String, required: true },
    gameKey: { type: String, default: "" },
    detail: { type: String, default: "" },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now, expires: FEEDBACK_REPORT_TTL_DAYS * ONE_DAY_MS / 1000 }
  }, { minimize: false });
  feedbackReportSchema.index({ guildId: 1, createdAt: -1 }, { background: true });

  const operationJournalSchema = new mongoose.Schema({
    _id: String,
    kind: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: null },
    status: { type: String, enum: ["pending", "done"], default: "pending" },
    attempts: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  }, { minimize: false });
  operationJournalSchema.index({ status: 1, updatedAt: 1 }, { background: true });
  operationJournalSchema.index(
    { updatedAt: 1 },
    {
      background: true,
      expireAfterSeconds: ONE_DAY_MS / 1000,
      partialFilterExpression: { status: "done" }
    }
  );

  return {
    circuitBreakerSchema,
    systemSchema,
    jobLockSchema,
    adminAlertCooldownSchema,
    fetchSnapshotSchema,
    playerCountSnapshotSchema,
    playerCountHistorySchema,
    playerCountRecordSchema,
    bugReportSchema,
    userComplaintSchema,
    feedbackReportSchema,
    operationJournalSchema
  };
}
