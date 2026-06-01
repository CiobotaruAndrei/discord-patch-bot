"use strict";

import type * as Mongoose from "mongoose";

interface MongoModelsContext {
  mongoose: typeof Mongoose;
  SUPPORTED_CURRENCIES: Record<string, unknown>;
  DEFAULT_CURRENCY: string;
  ONE_DAY_MS: number;
  [key: string]: unknown;
}

function attachMongoModels(target: MongoModelsContext): void {
  const { mongoose, SUPPORTED_CURRENCIES, DEFAULT_CURRENCY, ONE_DAY_MS } = target;

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
  kind: { type: String, enum: ["update", "discount"], required: true },
  itemId: { type: String, default: "" },
  title: { type: String, default: "" },
  reason: { type: String, default: "" },
  attempts: { type: Number, default: 0 },
  failedAt: { type: Date, default: Date.now }
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
  lastProcessedGameKey: { type: String, default: null },

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
  enabledStores: { type: [String], default: [] },
  maxAbsolutePrice: { type: Number, default: 0 },
  notificationRoleId: { type: String, default: null },
  discountRoleId: { type: String, default: null }
}, { minimize: false });

guildSchema.index({ subscribed: 1, notificationChannelId: 1 }, { background: true });
guildSchema.index({ discountsSubscribed: 1, discountChannelId: 1 }, { background: true });

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
  }
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

const guildSeenDiscountSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  dealHash: { type: String, required: true },
  seenAt: { type: Date, default: Date.now }
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

const notificationOutboxSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  channelId: { type: String, required: true },
  kind: { type: String, enum: ["update", "discount"], required: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  attempts: { type: Number, default: 0 },
  deliveries: { type: Number, default: 0 },
  availableAt: { type: Date, default: Date.now },
  lockedUntil: { type: Date, default: null },
  lockedBy: { type: String, default: null },
  dedupeKey: { type: String, default: null },
  createdAt: { type: Date, default: Date.now, expires: 7 * ONE_DAY_MS / 1000 }
}, { minimize: false });
notificationOutboxSchema.index({ availableAt: 1, lockedUntil: 1 }, { background: true });
const NotificationOutboxModel = mongoose.model("NotificationOutbox", notificationOutboxSchema, "notificationOutbox");

const OUTBOX_SENT_TTL_HOURS = Math.min(168, Math.max(1, Number(process.env.NOTIFICATION_OUTBOX_SENT_TTL_HOURS) || 24));
const notificationOutboxSentSchema = new mongoose.Schema({
  dedupeKey: { type: String, required: true, unique: true },
  sentAt: { type: Date, default: Date.now, expires: OUTBOX_SENT_TTL_HOURS * 3600 }
}, { minimize: false });
const NotificationOutboxSentModel = mongoose.model("NotificationOutboxSent", notificationOutboxSentSchema, "notificationOutboxSent");

  Object.assign(target, {
    GuildModel,
    CircuitBreakerModel,
    SystemModel,
    JobLockModel,
    AdminAlertCooldownModel,
    FetchSnapshotModel,
    GuildSeenDiscountModel,
    GuildSeenUpdateModel,
    NotificationOutboxModel,
    NotificationOutboxSentModel
  });
}

export = attachMongoModels;
