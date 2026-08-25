import type * as Mongoose from "mongoose";
import type { MongoModelEnv } from "./mongoModelEnv.js";
import { PERMISSION_REQUEST_STATUSES, PERMISSION_REQUEST_TYPES } from "../../features/command-security/permissionRequestTypes.js";
import { PROTECTED_RESOURCE_TYPES } from "../../features/command-security/protectedResourceTypes.js";
import { RAID_STAGES } from "../../features/command-security/antiRaidIncidentTypes.js";
import { AD_REQUEST_STATUSES } from "../../features/command-security/adRequestTypes.js";

export interface OperationalSchemasDeps {
  mongoose: typeof Mongoose;
  ONE_DAY_MS: number;
  env: MongoModelEnv;
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

  const reviewTrendSnapshotSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    appId: { type: String, required: true },
    gameKey: { type: String, default: "" },
    totalReviews: { type: Number, required: true, min: 0 },
    qualityPercent: { type: Number, required: true, min: 0, max: 100 },
    fetchedAt: { type: Date, required: true, expires: 45 * ONE_DAY_MS / 1000 }
  }, { minimize: false });
  reviewTrendSnapshotSchema.index({ appId: 1, fetchedAt: 1 }, { background: true });
  reviewTrendSnapshotSchema.index({ gameKey: 1, fetchedAt: 1 }, { background: true });

  const dealPriceSnapshotSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    gameKey: { type: String, required: true },
    title: { type: String, default: "" },
    store: { type: String, required: true },
    currency: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    fetchedAt: { type: Date, required: true, expires: 400 * ONE_DAY_MS / 1000 }
  }, { minimize: false });
  dealPriceSnapshotSchema.index({ gameKey: 1, store: 1, currency: 1, fetchedAt: 1 }, { background: true });

  const newAccountAlertDeliverySchema = new mongoose.Schema({
    _id: { type: String, required: true },
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    status: { type: String, enum: ["claimed", "sending", "delivered", "sent-unconfirmed", "released"], required: true },
    claimToken: { type: String, default: null },
    leaseUntil: { type: Date, default: null },
    sendingAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    reconciledAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true, expires: 0 }
  }, { minimize: false });
  newAccountAlertDeliverySchema.index({ guildId: 1, userId: 1 }, { unique: true, background: true });
  newAccountAlertDeliverySchema.index({ status: 1, sendingAt: 1 }, { background: true });

  const channelLockRecoverySchema = new mongoose.Schema({
    _id: { type: String, required: true },
    guildId: { type: String, required: true },
    channelId: { type: String, required: true },
    command: { type: String, enum: ["lock-channel", "unlock-channel"], required: true },
    previousState: { type: String, enum: ["allow", "deny", "inherit"], required: true },
    divergedState: { type: String, enum: ["allow", "deny", "inherit"], required: true },
    desiredState: { type: String, enum: ["allow", "deny", "inherit"], required: true },
    desiredLocked: { type: Boolean, required: true },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    createdAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true, expires: 0 }
  }, { minimize: false });
  channelLockRecoverySchema.index({ guildId: 1, channelId: 1 }, { unique: true, background: true });
  channelLockRecoverySchema.index({ createdAt: 1 }, { background: true });

  const playerCountRecordSchema = new mongoose.Schema({
    _id: String,
    gameKey: { type: String, default: "" },
    playerCount: { type: Number, required: true, min: 0 },
    reachedAt: { type: Date, required: true }
  }, { minimize: false });

  const playerCountWatchSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    gameKey: { type: String, required: true },
    appId: { type: String, default: "" },
    playerCount: { type: Number, required: true, min: 0 },
    fetchedAt: { type: Date, required: true },
    lastNotifiedAt: { type: Date, default: null },
    lastDirection: { type: String, enum: ["up", "down", null], default: null }
  }, { minimize: false });
  playerCountWatchSchema.index({ guildId: 1, gameKey: 1 }, { unique: true });

  const permissionRequestSchema = new mongoose.Schema({
    _id: String,
    guildId: { type: String, required: true },
    type: { type: String, required: true, enum: [...PERMISSION_REQUEST_TYPES] },
    requesterId: { type: String, required: true },
    target: { type: String, default: "" },
    action: { type: String, default: "" },
    amount: { type: Number, default: null },
    permissions: { type: [String], default: undefined },
    botId: { type: String, default: null },
    reason: { type: String, default: "", maxlength: 1000 },
    status: { type: String, required: true, enum: [...PERMISSION_REQUEST_STATUSES], default: "pending" },
    approvedTarget: { type: String, default: null },
    approvedAction: { type: String, default: null },
    approvedAmount: { type: Number, default: null },
    approvedPermissions: { type: [String], default: undefined },
    approvedBotId: { type: String, default: null },
    remainingAmount: { type: Number, default: null },
    resourceKind: { type: String, default: null },
    ownerId: { type: String, default: null },
    requestedAt: { type: Date, required: true },
    respondedAt: { type: Date, default: null },
    usedAt: { type: Date, default: null },
    claimBatchId: { type: String, default: null },
    cancelReason: { type: String, default: null },
    expiresAt: { type: Date, default: null }
  }, { minimize: false, _id: false });
  permissionRequestSchema.index({ guildId: 1, status: 1, requestedAt: -1 });
  permissionRequestSchema.index({ guildId: 1, type: 1, requesterId: 1, status: 1 });
  permissionRequestSchema.index({ guildId: 1, claimBatchId: 1 });
  permissionRequestSchema.index({ requestedAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

  const protectedResourceSchema = new mongoose.Schema({
    _id: String,
    guildId: { type: String, required: true },
    resourceId: { type: String, required: true },
    type: { type: String, required: true, enum: [...PROTECTED_RESOURCE_TYPES] },
    addedBy: { type: String, required: true },
    addedAt: { type: Date, required: true },
    snapshot: { type: Object, required: true },
    snapshotAt: { type: Date, required: true },
    degraded: { type: Boolean, default: false },
    degradedReasons: { type: [String], default: [] },
    preventionApplied: { type: Boolean, default: false },
    lastRestoredAt: { type: Date, default: null },
    recreatedFromId: { type: String, default: null },
    deletedDuringRaidAt: { type: Date, default: null },
    ownerInterventionAt: { type: Date, default: null },
    preventionTargets: { type: [{ id: String, previous: String, _id: false }], default: [] }
  }, { minimize: false, _id: false });
  protectedResourceSchema.index({ guildId: 1, addedAt: 1 });
  protectedResourceSchema.index({ guildId: 1, type: 1 });

  const webhookSnapshotSchema = new mongoose.Schema({
    _id: String,
    guildId: { type: String, required: true },
    channelId: { type: String, required: true },
    entries: {
      type: [new mongoose.Schema({
        webhookId: { type: String, required: true },
        channelId: { type: String, required: true },
        name: { type: String, default: "" },
        avatar: { type: String, default: null },
        creatorId: { type: String, default: null }
      }, { _id: false })],
      default: []
    },
    capturedAt: { type: Date, required: true },
    ownerInterventionAt: { type: Date, default: null }
  }, { minimize: false, _id: false });
  webhookSnapshotSchema.index({ guildId: 1, capturedAt: -1 });

  const massModerationWindowSchema = new mongoose.Schema({
    _id: String,
    guildId: { type: String, required: true },
    actorId: { type: String, required: true },
    events: {
      type: [new mongoose.Schema({
        auditId: { type: String, default: "" },
        targetId: { type: String, required: true },
        action: { type: String, required: true, enum: ["kick", "ban"] },
        at: { type: Date, required: true }
      }, { _id: false })],
      default: []
    },
    sanctionedAt: { type: Date, default: null },
    updatedAt: { type: Date, required: true }
  }, { minimize: false, _id: false });
  massModerationWindowSchema.index({ guildId: 1, actorId: 1 });
  massModerationWindowSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

  const raidSnapshotSchema = new mongoose.Schema({
    _id: String,
    guildId: { type: String, required: true },
    snapshot: { type: Object, required: true },
    operations: { type: [Object], default: [] },
    remaps: { type: [Object], default: [] },
    capturedAt: { type: Date, required: true },
    frozenAt: { type: Date, default: null }
  }, { minimize: false, _id: false });
  raidSnapshotSchema.index({ guildId: 1, capturedAt: -1 });
  raidSnapshotSchema.index({ capturedAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

  const raidIncidentSchema = new mongoose.Schema({
    _id: String,
    guildId: { type: String, required: true },
    activeKey: { type: String, default: undefined },
    raidWebhookIds: { type: [String], default: [] },
    stage: { type: String, required: true, enum: [...RAID_STAGES], default: "suspected" },
    startedAt: { type: Date, required: true },
    confirmedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    lastActivityAt: { type: Date, required: true },
    triggerReason: { type: String, default: "", maxlength: 500 },
    manual: { type: Boolean, default: false },
    dryRun: { type: Boolean, default: false },
    participants: { type: [Object], default: [] },
    lockedChannels: { type: [Object], default: [] },
    pendingActions: { type: [String], default: [] },
    errors: { type: [String], default: [] },
    restoreProgress: { type: Number, default: 0 }
  }, { minimize: false, _id: false });
  raidIncidentSchema.index({ activeKey: 1 }, { unique: true, sparse: true });
  raidIncidentSchema.index({ guildId: 1, stage: 1, startedAt: -1 });
  raidIncidentSchema.index({ guildId: 1, startedAt: -1 });
  raidIncidentSchema.index({ startedAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

  const adRequestSchema = new mongoose.Schema({
    _id: String,
    guildId: { type: String, required: true },
    requesterId: { type: String, required: true },
    adText: { type: String, default: "", maxlength: 2000 },
    fingerprint: { type: String, required: true },
    link: { type: String, default: null },
    invite: { type: String, default: null },
    attachmentUrl: { type: String, default: null },
    target: { type: String, default: null },
    status: { type: String, required: true, enum: [...AD_REQUEST_STATUSES], default: "pending" },
    ownerId: { type: String, default: null },
    requestedAt: { type: Date, required: true },
    respondedAt: { type: Date, default: null },
    usedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null }
  }, { minimize: false, _id: false });
  adRequestSchema.index({ guildId: 1, status: 1, requestedAt: -1 });
  adRequestSchema.index({ guildId: 1, requesterId: 1, status: 1 });
  adRequestSchema.index({ requestedAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

  const adAttemptSchema = new mongoose.Schema({
    _id: String,
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    strikes: { type: Number, default: 0, min: 0 },
    totalDeleted: { type: Number, default: 0, min: 0 },
    totalDetected: { type: Number, default: 0, min: 0 },
    totalWarns: { type: Number, default: 0, min: 0 },
    lastAttemptAt: { type: Date, default: null },
    lastChannelId: { type: String, default: null },
    history: { type: [Object], default: [] }
  }, { minimize: false, _id: false });
  adAttemptSchema.index({ guildId: 1, strikes: -1 });
  adAttemptSchema.index({ guildId: 1, userId: 1 });

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
    schemaVersion: { type: Number, required: true, min: 1 },
    resourceKey: { type: String, required: true },
    resourceVersion: { type: String, required: true },
    status: { type: String, enum: ["pending", "leased", "done", "superseded", "failed"], default: "pending" },
    attempts: { type: Number, default: 0 },
    leaseVersion: { type: Number, default: 0 },
    lockedBy: { type: String, default: null },
    lockedUntil: { type: Date, default: null },
    lastError: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  }, { minimize: false });
  operationJournalSchema.index({ status: 1, updatedAt: 1 }, { background: true });
  operationJournalSchema.index({ resourceKey: 1, resourceVersion: -1 }, { background: true });
  operationJournalSchema.index(
    { updatedAt: 1 },
    {
      background: true,
      expireAfterSeconds: ONE_DAY_MS / 1000,
      partialFilterExpression: { status: { $in: ["done", "superseded", "failed"] } }
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
    reviewTrendSnapshotSchema,
    dealPriceSnapshotSchema,
    newAccountAlertDeliverySchema,
    channelLockRecoverySchema,
    playerCountRecordSchema,
    playerCountWatchSchema,
    permissionRequestSchema,
    protectedResourceSchema,
    webhookSnapshotSchema,
    massModerationWindowSchema,
    raidSnapshotSchema,
    raidIncidentSchema,
    adRequestSchema,
    adAttemptSchema,
    bugReportSchema,
    userComplaintSchema,
    feedbackReportSchema,
    operationJournalSchema
  };
}
