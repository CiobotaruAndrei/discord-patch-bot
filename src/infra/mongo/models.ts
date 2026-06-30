"use strict";

import type * as Mongoose from "mongoose";
import type { CurrencyCode, CurrencyRegistry, RuntimeEnv } from "../../types";

interface MongoModelsContext {
  mongoose: typeof Mongoose;
  SUPPORTED_CURRENCIES: CurrencyRegistry;
  DEFAULT_CURRENCY: CurrencyCode;
  ONE_DAY_MS: number;
  env: RuntimeEnv;
  [key: string]: unknown;
}

function buildMongoModelsFrom(context: MongoModelsContext) {
  const { mongoose, SUPPORTED_CURRENCIES, DEFAULT_CURRENCY, ONE_DAY_MS, env } = context;

const pendingUpdateSchema = new mongoose.Schema({
  id: { type: String, required: true },
  title: { type: String, default: "" },
  link: { type: String, default: "" },
  excerpt: { type: String, default: "" },
  thumbnail: { type: String, default: null },
  image: { type: String, default: null },
  timestamp: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
  attempts: { type: Number, default: 0 }
}, { _id: false });

const pendingDiscountSchema = new mongoose.Schema({
  hash: { type: String, required: true },
  snapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  lastSeenAt: { type: Date, default: Date.now },
  attempts: { type: Number, default: 0 }
}, { _id: false });

const deadLetterEntrySchema = new mongoose.Schema({
  kind: { type: String, enum: ["update", "discount", "youtube"], required: true },
  itemId: { type: String, default: "" },
  title: { type: String, default: "" },
  channelId: { type: String, default: "" },
  dedupeKey: { type: String, default: "" },
  reason: { type: String, default: "" },
  attempts: { type: Number, default: 0 },
  failedAt: { type: Date, default: Date.now }
}, { _id: false });

const priceAlertSchema = new mongoose.Schema({
  gameKey: { type: String, required: true },
  gameName: { type: String, required: true },
  appId: { type: String, default: "" },
  aliases: { type: [String], default: [] },
  threshold: { type: Number, required: true, min: 0.01, max: 10000 },
  currency: { type: String, enum: Object.keys(SUPPORTED_CURRENCIES), required: true },
  triggeredAt: { type: Date, default: null },
  lastObservedPrice: { type: Number, default: null },
  lastObservedAt: { type: Date, default: null },
  absentCycles: { type: Number, default: 0 }
}, { _id: false });

const youtubeLastErrorSchema = new mongoose.Schema({
  message: { type: String, default: "" },
  channelId: { type: String, default: null },
  at: { type: Date, default: null }
}, { _id: false });

const youtubeChannelSchema = new mongoose.Schema({
  channelId: { type: String, required: true },
  channelName: { type: String, required: true },
  channelUrl: { type: String, required: true },
  subscribedAt: { type: Date, default: Date.now },
  lastCheckedAt: { type: Date, default: null },
  lastVideoId: { type: String, default: "" },
  lastError: { type: youtubeLastErrorSchema, default: () => ({}) }
}, { _id: false });

const youtubeErrorSchema = new mongoose.Schema({
  channelId: { type: String, required: true },
  channelName: { type: String, default: "" },
  message: { type: String, required: true },
  at: { type: Date, default: Date.now }
}, { _id: false });

const youtubeChannelRouteSchema = new mongoose.Schema({
  channelId: { type: String, required: true },
  discordChannelIds: { type: [String], default: [] }
}, { _id: false });

const configBackupSchema = new mongoose.Schema({
  name: { type: String, required: true },
  createdBy: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true }
}, { _id: false });

const botAuditLogSchema = new mongoose.Schema({
  userId: { type: String, default: "" },
  command: { type: String, required: true },
  result: { type: String, required: true },
  serverId: { type: String, default: "" },
  details: { type: String, default: "" },
  at: { type: Date, default: Date.now }
}, { _id: false });

const serverAuditLogSchema = new mongoose.Schema({
  userId: { type: String, default: "" },
  action: { type: String, required: true },
  serverId: { type: String, default: "" },
  details: { type: String, default: "" },
  at: { type: Date, default: Date.now }
}, { _id: false });

const suggestedCommandSchema = new mongoose.Schema({
  commandName: { type: String, required: true },
  description: { type: String, required: true },
  createdBy: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const watchlistGameSuggestionSchema = new mongoose.Schema({
  gameName: { type: String, required: true },
  createdBy: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const futureReleaseGameSchema = new mongoose.Schema({
  gameName: { type: String, required: true },
  addedBy: { type: String, default: "" },
  addedAt: { type: Date, default: Date.now },
  releaseDate: { type: String, default: "" },
  preorderPrice: { type: String, default: "" }
}, { _id: false });

const adminCommandAccessSchema = new mongoose.Schema({
  mode: { type: String, enum: ["role", "role-or-higher"], required: true },
  roleId: { type: String, required: true },
  updatedBy: { type: String, default: "" },
  updatedAt: { type: Date, default: Date.now }
}, { _id: false });

const guildSchema = new mongoose.Schema({
  _id: String,
  subscribed: { type: Boolean, default: false },
  notificationChannelId: { type: String, default: null },
  pendingUpdates: { type: Map, of: [pendingUpdateSchema], default: {} },
  discountsSubscribed: { type: Boolean, default: false },
  discountChannelId: { type: String, default: null },
  pendingDiscounts: { type: [pendingDiscountSchema], default: [] },
  notificationDeadLetter: { type: [deadLetterEntrySchema], default: [] },
  minDiscountPercent: { type: Number, default: 70 },
  includeFreeGames: { type: Boolean, default: true },
  includePaidDiscounts: { type: Boolean, default: true },
  notificationMode: { type: String, enum: ["compact", "detailed"], default: "detailed" },
  currency: { type: String, enum: Object.keys(SUPPORTED_CURRENCIES), default: DEFAULT_CURRENCY },
  outboxRecoveryVerify: { type: Boolean, default: false },
  lastProcessedGameKey: { type: String, default: null },
  seenHashVersionUpdates: { type: Number, default: 0 },
  seenHashVersionDiscounts: { type: Number, default: 0 },

  updatesInitializing: { type: Boolean, default: false },
  updatesActivationId: { type: String, default: null },
  updatesLastError: {
    message: { type: String, default: "" },
    channelId: { type: String, default: null },
    at: { type: Date, default: null }
  },
  discountsInitializing: { type: Boolean, default: false },
  discountsActivationId: { type: String, default: null },
  discountsLastError: {
    message: { type: String, default: "" },
    channelId: { type: String, default: null },
    at: { type: Date, default: null }
  },

  enabledGames: { type: [String], default: [] },
  commandSnoozes: { type: Map, of: Date, default: {} },
  enabledStores: { type: [String], default: [] },
  maxAbsolutePrice: { type: Number, default: 0 },
  notificationRoleId: { type: String, default: null },
  discountRoleId: { type: String, default: null },
  adminAlertChannelId: { type: String, default: null },
  priceAlerts: { type: [priceAlertSchema], default: [] },
  youtubeChannels: { type: [youtubeChannelSchema], default: [] },
  youtubeNotificationChannelId: { type: String, default: null },
  youtubeNotificationsEnabled: { type: Boolean, default: false },
  youtubeHasActivated: { type: Boolean, default: false },
  youtubeFilters: {
    excludeShorts: { type: Boolean, default: true },
    excludeLives: { type: Boolean, default: true },
    excludePremieres: { type: Boolean, default: true },
    minDurationSeconds: { type: Number, default: 0, min: 0, max: 86400 }
  },
  youtubeMessageTemplate: { type: String, default: null, maxlength: 1000 },
  youtubeChannelRoutes: { type: [youtubeChannelRouteSchema], default: [] },
  youtubeTitleIncludeWords: { type: [String], default: [] },
  youtubeErrors: { type: [youtubeErrorSchema], default: [] },
  configBackups: { type: [configBackupSchema], default: [] },
  botAuditLog: { type: [botAuditLogSchema], default: [] },
  serverAuditLog: { type: [serverAuditLogSchema], default: [] },
  suggestedCommands: { type: [suggestedCommandSchema], default: [] },
  watchlistGameSuggestions: { type: [watchlistGameSuggestionSchema], default: [] },
  futureReleaseGames: { type: [futureReleaseGameSchema], default: [] },
  adminCommandAccess: { type: adminCommandAccessSchema, default: null },
  futureReleaseSubscribed: { type: Boolean, default: false },
  futureReleaseChannelId: { type: String, default: null },
  futureReleaseInitializing: { type: Boolean, default: false },
  futureReleaseActivationId: { type: String, default: null },
  dlcSubscribed: { type: Boolean, default: false },
  dlcChannelId: { type: String, default: null },
  dlcInitializing: { type: Boolean, default: false },
  dlcActivationId: { type: String, default: null }
}, { minimize: false });

guildSchema.index({ subscribed: 1, notificationChannelId: 1 }, { background: true });
guildSchema.index({ discountsSubscribed: 1, discountChannelId: 1 }, { background: true });
guildSchema.index({ youtubeNotificationsEnabled: 1, youtubeNotificationChannelId: 1 }, { background: true });
guildSchema.index({ futureReleaseSubscribed: 1, futureReleaseChannelId: 1 }, { background: true });
guildSchema.index({ dlcSubscribed: 1, dlcChannelId: 1 }, { background: true });

const GuildModel = mongoose.model("Guild", guildSchema);

const circuitBreakerSchema = new mongoose.Schema({
  _id: String,
  fails: { type: Number, default: 0 },
  cooldownUntil: { type: Date, default: null },
  alertSent: { type: Boolean, default: false },
  schemaDriftFails: { type: Number, default: 0 },
  schemaDriftAlertSent: { type: Boolean, default: false }
}, { minimize: false });
const CircuitBreakerModel = mongoose.model("CircuitBreaker", circuitBreakerSchema);

const systemSchema = new mongoose.Schema({
  _id: { type: String, default: "system_state" },
  executionTimes: {
    all: { type: Number, default: 35000 },
    single: { type: Number, default: 2000 },
    reduceri: { type: Number, default: 10000 }
  },
  outboxPaused: { type: Boolean, default: false }
}, { minimize: false });
const SystemModel = mongoose.model("System", systemSchema);

const jobLockSchema = new mongoose.Schema({
  _id: String,
  lockedUntil: { type: Date, default: null, index: true },
  ownerToken: { type: String, default: null }
}, { minimize: false });
const JobLockModel = mongoose.model("JobLock", jobLockSchema);

const adminAlertCooldownSchema = new mongoose.Schema({
  _id: String,
  lastSentAt: { type: Date, default: Date.now, expires: 7 * ONE_DAY_MS / 1000 }
}, { minimize: false });
const AdminAlertCooldownModel = mongoose.model("AdminAlertCooldown", adminAlertCooldownSchema);

const fetchSnapshotSchema = new mongoose.Schema({
  _id: String,
  payload: { type: mongoose.Schema.Types.Mixed, default: null },
  fetchedAt: { type: Date, default: Date.now, expires: ONE_DAY_MS / 1000 }
}, { minimize: false });
const FetchSnapshotModel = mongoose.model("FetchSnapshot", fetchSnapshotSchema);

const GUILD_SEEN_DISCOUNT_TTL_DAYS = env.GUILD_SEEN_DISCOUNT_TTL_DAYS;
const guildSeenDiscountSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  dealHash: { type: String, required: true },
  seenAt: { type: Date, default: Date.now, expires: GUILD_SEEN_DISCOUNT_TTL_DAYS * ONE_DAY_MS / 1000 }
}, { minimize: false });
guildSeenDiscountSchema.index({ guildId: 1, dealHash: 1 }, { unique: true, background: true });
const GuildSeenDiscountModel = mongoose.model("GuildSeenDiscount", guildSeenDiscountSchema, "guildSeenDiscounts");

const guildSeenUpdateSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  gameKey: { type: String, required: true },
  updateId: { type: String, required: true },
  seenAt: { type: Date, default: Date.now }
}, { minimize: false });
guildSeenUpdateSchema.index({ guildId: 1, gameKey: 1, updateId: 1 }, { unique: true, background: true });
const GuildSeenUpdateModel = mongoose.model("GuildSeenUpdate", guildSeenUpdateSchema, "guildSeenUpdates");

const guildSeenYoutubeSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  channelId: { type: String, required: true },
  videoId: { type: String, required: true },
  seenAt: { type: Date, default: Date.now }
}, { minimize: false });
guildSeenYoutubeSchema.index({ guildId: 1, channelId: 1, videoId: 1 }, { unique: true, background: true });
const GuildSeenYoutubeModel = mongoose.model("GuildSeenYoutube", guildSeenYoutubeSchema, "guildSeenYoutube");

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
  attempts: { type: Number, default: 0 },
  deliveries: { type: Number, default: 0 },
  availableAt: { type: Date, default: Date.now },
  lockedUntil: { type: Date, default: null },
  lockedBy: { type: String, default: null },
  dedupeKey: { type: String },
  recoveryVerify: { type: Boolean, default: null },
  manual: { type: Boolean, default: false },
  history: { type: [outboxHistoryEntrySchema], default: [] },
  createdAt: { type: Date, default: Date.now, expires: 7 * ONE_DAY_MS / 1000 }
}, { minimize: false });
notificationOutboxSchema.index({ availableAt: 1, lockedUntil: 1 }, { background: true });
notificationOutboxSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true, background: true });
const NotificationOutboxModel = mongoose.model("NotificationOutbox", notificationOutboxSchema, "notificationOutbox");

const OUTBOX_SENT_TTL_HOURS = env.NOTIFICATION_OUTBOX_SENT_TTL_HOURS;
const notificationOutboxSentSchema = new mongoose.Schema({
  dedupeKey: { type: String, required: true, unique: true },
  sentAt: { type: Date, default: Date.now, expires: OUTBOX_SENT_TTL_HOURS * 3600 }
}, { minimize: false });
const NotificationOutboxSentModel = mongoose.model("NotificationOutboxSent", notificationOutboxSentSchema, "notificationOutboxSent");

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
const NotificationHistoryModel = mongoose.model("NotificationHistory", notificationHistorySchema, "notificationHistory");

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
const FeedbackReportModel = mongoose.model("FeedbackReport", feedbackReportSchema, "feedbackReports");

const DEAD_LETTER_REPLAY_TTL_DAYS = env.NOTIFICATION_DEAD_LETTER_REPLAY_TTL_DAYS;
const deadLetterReplaySchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  kind: { type: String, enum: ["update", "discount", "youtube"], required: true },
  channelId: { type: String, required: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
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
const NotificationDeadLetterReplayModel = mongoose.model("NotificationDeadLetterReplay", deadLetterReplaySchema, "notificationDeadLetterReplay");

  return {
    GuildModel,
    CircuitBreakerModel,
    SystemModel,
    JobLockModel,
    AdminAlertCooldownModel,
    FetchSnapshotModel,
    GuildSeenDiscountModel,
    GuildSeenUpdateModel,
    GuildSeenYoutubeModel,
    NotificationOutboxModel,
    NotificationOutboxSentModel,
    NotificationHistoryModel,
    FeedbackReportModel,
    NotificationDeadLetterReplayModel
  };
}

function attachMongoModels(target: MongoModelsContext): void {
  Object.assign(target, buildMongoModelsFrom(target));
}

attachMongoModels.buildFrom = buildMongoModelsFrom;

export = attachMongoModels;
