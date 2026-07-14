"use strict";

import type * as Mongoose from "mongoose";
import type { CurrencyCode, CurrencyRegistry } from "../../types.js";
import type { MongoModelEnv } from "./mongoModelEnv.js";
import { buildGuildNotificationSchemas } from "./guildNotificationSchemas.js";
import { buildGuildYoutubeSchemas } from "./guildYoutubeSchemas.js";
import { buildGuildAdminRecordSchemas } from "./guildAdminRecordSchemas.js";
import { buildOperationalSchemas } from "./operationalSchemas.js";
import { buildSeenSchemas } from "./seenSchemas.js";
import { buildOutboxSchemas } from "./outboxSchemas.js";
import { buildAuditLogSchemas } from "./auditLogSchemas.js";
import { buildConfigBackupSchemas } from "./configBackupSchemas.js";
import { buildSuggestedCommandSchemas } from "./suggestedCommandSchemas.js";
import { buildYoutubeErrorLogSchemas } from "./youtubeErrorLogSchemas.js";
import { buildDeadLetterLogSchemas } from "./deadLetterLogSchemas.js";
import { publishGuildSettingsChanged } from "./guildSettingsEvents.js";

export interface MongoModelsContext {
  mongoose: typeof Mongoose;
  SUPPORTED_CURRENCIES: CurrencyRegistry;
  DEFAULT_CURRENCY: CurrencyCode;
  ONE_DAY_MS: number;
  env: MongoModelEnv;
  [key: string]: unknown;
}

function buildMongoModelsFrom(context: MongoModelsContext) {
  const { mongoose, SUPPORTED_CURRENCIES, DEFAULT_CURRENCY, ONE_DAY_MS, env } = context;

  const {
    pendingUpdateSchema,
    pendingDiscountSchema,
    priceAlertSchema
  } = buildGuildNotificationSchemas({ mongoose, SUPPORTED_CURRENCIES });
  const {
    youtubeChannelSchema,
    youtubeChannelRouteSchema
  } = buildGuildYoutubeSchemas({ mongoose });
  const {
    watchlistGameSuggestionSchema,
    futureReleaseGameSchema,
    adminCommandAccessSchema
  } = buildGuildAdminRecordSchemas({ mongoose });

  const guildSchema = new mongoose.Schema({
    _id: String,
    subscribed: { type: Boolean, default: false },
    notificationChannelId: { type: String, default: null },
    pendingUpdates: { type: Map, of: [pendingUpdateSchema], default: {} },
    discountsSubscribed: { type: Boolean, default: false },
    discountChannelId: { type: String, default: null },
    pendingDiscounts: { type: [pendingDiscountSchema], default: [] },
    minDiscountPercent: { type: Number, default: 70 },
    includeFreeGames: { type: Boolean, default: true },
    includePaidDiscounts: { type: Boolean, default: true },
    notificationMode: { type: String, enum: ["compact", "detailed"], default: "detailed" },
    updateMessageTemplate: { type: String, default: null, maxlength: 500 },
    discountMessageTemplate: { type: String, default: null, maxlength: 500 },
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
    watchlistGameSuggestions: { type: [watchlistGameSuggestionSchema], default: [] },
    futureReleaseGames: { type: [futureReleaseGameSchema], default: [] },
    adminCommandAccess: { type: adminCommandAccessSchema, default: null },
    adminCommandAccessByCommand: { type: Map, of: adminCommandAccessSchema, default: {} },
    playerCountSubscribed: { type: Boolean, default: false },
    playerCountChannelId: { type: String, default: null },
    playerCountGames: { type: [String], default: [] },
    gameAliases: { type: Map, of: [String], default: {} },
    timezone: { type: String, default: "UTC", maxlength: 100 },
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
  guildSchema.index({ playerCountSubscribed: 1, playerCountChannelId: 1 }, { background: true });

  const publishChangedGuild = function(this: { getFilter(): { _id?: unknown } }): void {
    const guildId = this.getFilter()._id;
    if (typeof guildId === "string") publishGuildSettingsChanged(guildId);
  };
  guildSchema.post("updateOne", publishChangedGuild);
  guildSchema.post("findOneAndUpdate", publishChangedGuild);
  guildSchema.post("deleteOne", publishChangedGuild);

  const GuildModel = mongoose.model("Guild", guildSchema);

  const {
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
  } = buildOperationalSchemas({ mongoose, ONE_DAY_MS, env });
  const CircuitBreakerModel = mongoose.model("CircuitBreaker", circuitBreakerSchema);
  const SystemModel = mongoose.model("System", systemSchema);
  const JobLockModel = mongoose.model("JobLock", jobLockSchema);
  const AdminAlertCooldownModel = mongoose.model("AdminAlertCooldown", adminAlertCooldownSchema);
  const FetchSnapshotModel = mongoose.model("FetchSnapshot", fetchSnapshotSchema);
  const PlayerCountSnapshotModel = mongoose.model("PlayerCountSnapshot", playerCountSnapshotSchema, "playerCountSnapshots");
  const PlayerCountHistoryModel = mongoose.model("PlayerCountHistory", playerCountHistorySchema, "playerCountHistory");
  const PlayerCountRecordModel = mongoose.model("PlayerCountRecord", playerCountRecordSchema, "playerCountRecords");
  const BugReportModel = mongoose.model("BugReport", bugReportSchema, "bugReports");
  const UserComplaintModel = mongoose.model("UserComplaint", userComplaintSchema, "userComplaints");
  const FeedbackReportModel = mongoose.model("FeedbackReport", feedbackReportSchema, "feedbackReports");
  const OperationJournalModel = mongoose.model("OperationJournal", operationJournalSchema, "operationJournal");

  const { guildAuditLogSchema } = buildAuditLogSchemas({ mongoose, ONE_DAY_MS, env });
  const GuildAuditLogModel = mongoose.model("GuildAuditLog", guildAuditLogSchema, "guildAuditLogs");

  const { guildConfigBackupSchema } = buildConfigBackupSchemas({ mongoose });
  const GuildConfigBackupModel = mongoose.model("GuildConfigBackup", guildConfigBackupSchema, "guildConfigBackups");

  const { guildSuggestedCommandSchema } = buildSuggestedCommandSchemas({ mongoose });
  const GuildSuggestedCommandModel = mongoose.model("GuildSuggestedCommand", guildSuggestedCommandSchema, "guildSuggestedCommands");

  const { guildYoutubeErrorSchema } = buildYoutubeErrorLogSchemas({ mongoose });
  const GuildYoutubeErrorModel = mongoose.model("GuildYoutubeError", guildYoutubeErrorSchema, "guildYoutubeErrors");

  const { guildDeadLetterSchema } = buildDeadLetterLogSchemas({ mongoose });
  const GuildDeadLetterModel = mongoose.model("GuildDeadLetter", guildDeadLetterSchema, "guildDeadLetters");

  const {
    guildSeenDiscountSchema,
    guildSeenUpdateSchema,
    guildSeenYoutubeSchema
  } = buildSeenSchemas({ mongoose, ONE_DAY_MS, env });
  const GuildSeenDiscountModel = mongoose.model("GuildSeenDiscount", guildSeenDiscountSchema, "guildSeenDiscounts");
  const GuildSeenUpdateModel = mongoose.model("GuildSeenUpdate", guildSeenUpdateSchema, "guildSeenUpdates");
  const GuildSeenYoutubeModel = mongoose.model("GuildSeenYoutube", guildSeenYoutubeSchema, "guildSeenYoutube");

  const {
    notificationOutboxSchema,
    notificationOutboxSentSchema,
    notificationHistorySchema,
    deadLetterReplaySchema
  } = buildOutboxSchemas({ mongoose, ONE_DAY_MS, env });
  const NotificationOutboxModel = mongoose.model("NotificationOutbox", notificationOutboxSchema, "notificationOutbox");
  const NotificationOutboxSentModel = mongoose.model("NotificationOutboxSent", notificationOutboxSentSchema, "notificationOutboxSent");
  const NotificationHistoryModel = mongoose.model("NotificationHistory", notificationHistorySchema, "notificationHistory");
  const NotificationDeadLetterReplayModel = mongoose.model("NotificationDeadLetterReplay", deadLetterReplaySchema, "notificationDeadLetterReplay");

  return {
    GuildModel,
    GuildAuditLogModel,
    GuildConfigBackupModel,
    GuildSuggestedCommandModel,
    GuildYoutubeErrorModel,
    GuildDeadLetterModel,
    CircuitBreakerModel,
    SystemModel,
    JobLockModel,
    AdminAlertCooldownModel,
    FetchSnapshotModel,
    PlayerCountSnapshotModel,
    PlayerCountHistoryModel,
    PlayerCountRecordModel,
    BugReportModel,
    OperationJournalModel,
    UserComplaintModel,
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

const mongoModelsModule = {
  buildFrom: buildMongoModelsFrom
};

export default mongoModelsModule;

