"use strict";

const { errorMessage } = require("../../shared/errors") as typeof import("../../shared/errors");
const { HASH_VERSION } = require("../../native/fuzzy") as { HASH_VERSION: number };

export type SubscriptionWriteResult = { matchedCount?: number };

export type SubscriptionGuildModel = {
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>): Promise<SubscriptionWriteResult>;
};

export type SubscriptionServiceDeps = {
  GuildModel: SubscriptionGuildModel;
  logger: (level: string, context: string, message: string, meta?: unknown) => void;
  invalidateGuildCache: (guildId: string) => void;
  OP_UPDATE_OPTS: Record<string, unknown>;
  makeActivationId: () => string;
};

export type SubscriptionModuleKind = "updates" | "discounts";

export type StartSubscriptionOutcome =
  | { status: "activated" }
  | { status: "superseded" }
  | { status: "baseline-failed"; error: unknown };

type SubscriptionModuleSpec = {
  logContext: string;
  baselineWarnMessage: string;
  subscribedField: string;
  channelField: string;
  initializingField: string;
  activationField: string;
  lastErrorField: string;
  pendingField: string;
  pendingEmpty: Record<string, never> | ReadonlyArray<never>;
  seenHashVersionField: string;
};

const MODULE_SPECS: Record<SubscriptionModuleKind, SubscriptionModuleSpec> = {
  updates: {
    logContext: "START_UPDATES",
    baselineWarnMessage: "Activat, dar baseline-ul initial a esuat",
    subscribedField: "subscribed",
    channelField: "notificationChannelId",
    initializingField: "updatesInitializing",
    activationField: "updatesActivationId",
    lastErrorField: "updatesLastError",
    pendingField: "pendingUpdates",
    pendingEmpty: {},
    seenHashVersionField: "seenHashVersionUpdates"
  },
  discounts: {
    logContext: "START_DISCOUNTS",
    baselineWarnMessage: "Activat, dar baseline-ul de reduceri a esuat",
    subscribedField: "discountsSubscribed",
    channelField: "discountChannelId",
    initializingField: "discountsInitializing",
    activationField: "discountsActivationId",
    lastErrorField: "discountsLastError",
    pendingField: "pendingDiscounts",
    pendingEmpty: [],
    seenHashVersionField: "seenHashVersionDiscounts"
  }
};

export function createSubscriptionService(deps: SubscriptionServiceDeps) {
  const { GuildModel, logger, invalidateGuildCache, OP_UPDATE_OPTS, makeActivationId } = deps;

  async function beginActivation(kind: SubscriptionModuleKind, guildId: string, channelId: string): Promise<string> {
    const spec = MODULE_SPECS[kind];
    const activationId = makeActivationId();
    await GuildModel.updateOne(
      { _id: guildId },
      {
        $set: {
          [spec.subscribedField]: true,
          [spec.channelField]: channelId,
          [spec.initializingField]: true,
          [spec.activationField]: activationId,
          [spec.pendingField]: spec.pendingEmpty
        },
        $unset: { [spec.lastErrorField]: "" }
      },
      { upsert: true, ...OP_UPDATE_OPTS }
    );
    invalidateGuildCache(guildId);
    return activationId;
  }

  async function finalizeActivation(kind: SubscriptionModuleKind, guildId: string, channelId: string, activationId: string): Promise<boolean> {
    const spec = MODULE_SPECS[kind];
    const result = await GuildModel.updateOne(
      {
        _id: guildId,
        [spec.subscribedField]: true,
        [spec.channelField]: channelId,
        [spec.activationField]: activationId
      },
      {
        $set: { [spec.initializingField]: false, [spec.seenHashVersionField]: HASH_VERSION },
        $unset: { [spec.activationField]: "", [spec.lastErrorField]: "" }
      },
      OP_UPDATE_OPTS
    );
    return result.matchedCount !== 0;
  }

  async function rollbackActivation(kind: SubscriptionModuleKind, guildId: string, channelId: string, activationId: string, error: unknown): Promise<void> {
    const spec = MODULE_SPECS[kind];
    await GuildModel.updateOne(
      { _id: guildId, [spec.activationField]: activationId },
      {
        $set: {
          [spec.subscribedField]: false,
          [spec.channelField]: null,
          [spec.initializingField]: false,
          [spec.lastErrorField]: { message: errorMessage(error), channelId, at: new Date() }
        },
        $unset: { [spec.activationField]: "" }
      },
      OP_UPDATE_OPTS
    ).catch(() => null);
    logger("WARN", spec.logContext, spec.baselineWarnMessage, errorMessage(error));
    invalidateGuildCache(guildId);
  }

  async function startSubscription(
    kind: SubscriptionModuleKind,
    guildId: string,
    channelId: string,
    seedBaseline: () => Promise<void>
  ): Promise<StartSubscriptionOutcome> {
    const activationId = await beginActivation(kind, guildId, channelId);
    try {
      await seedBaseline();
      const finalized = await finalizeActivation(kind, guildId, channelId, activationId);
      return finalized ? { status: "activated" } : { status: "superseded" };
    } catch (error: unknown) {
      await rollbackActivation(kind, guildId, channelId, activationId, error);
      return { status: "baseline-failed", error };
    }
  }

  async function stopSubscription(kind: SubscriptionModuleKind, guildId: string): Promise<void> {
    const spec = MODULE_SPECS[kind];
    await GuildModel.updateOne({ _id: guildId }, {
      $set: {
        [spec.subscribedField]: false,
        [spec.channelField]: null,
        [spec.initializingField]: false,
        [spec.pendingField]: spec.pendingEmpty
      },
      $unset: { [spec.activationField]: "" }
    }, OP_UPDATE_OPTS);
    invalidateGuildCache(guildId);
  }

  return {
    startUpdates: (guildId: string, channelId: string, seedBaseline: () => Promise<void>) =>
      startSubscription("updates", guildId, channelId, seedBaseline),
    stopUpdates: (guildId: string) => stopSubscription("updates", guildId),
    startDiscounts: (guildId: string, channelId: string, seedBaseline: () => Promise<void>) =>
      startSubscription("discounts", guildId, channelId, seedBaseline),
    stopDiscounts: (guildId: string) => stopSubscription("discounts", guildId),
    rollbackActivation
  };
}

export type SubscriptionService = ReturnType<typeof createSubscriptionService>;
