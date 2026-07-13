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

  return {
    circuitBreakerSchema,
    systemSchema,
    jobLockSchema,
    adminAlertCooldownSchema,
    fetchSnapshotSchema,
    playerCountSnapshotSchema,
    feedbackReportSchema
  };
}
