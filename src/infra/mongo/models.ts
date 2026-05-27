"use strict";

module.exports = (ctx: any) => {
  const { mongoose, SUPPORTED_CURRENCIES, DEFAULT_CURRENCY, ONE_DAY_MS } = ctx;

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

const guildSchema = new mongoose.Schema({
  _id: String,
  subscribed: { type: Boolean, default: false },
  notificationChannelId: { type: String, default: null },
  seen: { type: Map, of: [String], default: {} },
  pendingUpdates: { type: Map, of: [pendingUpdateSchema], default: {} },
  discountsSubscribed: { type: Boolean, default: false },
  discountChannelId: { type: String, default: null },
  seenDiscounts: { type: [String], default: [] },
  pendingDiscounts: { type: [pendingDiscountSchema], default: [] },
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

  enabledGames: { type: [String], default: [] },   // [] = toate jocurile active
  enabledStores: { type: [String], default: [] },  // [] = toate store-urile active
  maxAbsolutePrice: { type: Number, default: 0 },  // 0 = fara limita superioara
  notificationRoleId: { type: String, default: null }, // ping rol pe updates
  discountRoleId: { type: String, default: null }      // ping rol pe reduceri
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
  _id: String, // alert kind (ex. "cb:dbd", "cron:fatal")
  lastSentAt: { type: Date, default: Date.now, expires: 7 * ONE_DAY_MS / 1000 }
}, { minimize: false });
const AdminAlertCooldownModel = mongoose.model("AdminAlertCooldown", adminAlertCooldownSchema);

  Object.assign(ctx, {
    GuildModel,
    CircuitBreakerModel,
    SystemModel,
    JobLockModel,
    AdminAlertCooldownModel
  });
};

export {};
