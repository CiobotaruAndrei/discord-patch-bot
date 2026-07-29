"use strict";

import { errorMessage } from "../../shared/errors.js";
import { HASH_VERSION } from "../../native/fuzzy.js";
import { matchedDocument } from "../../shared/persistenceOutcome.js";

export type SubscriptionWriteResult = { matchedCount?: number };

export type SubscriptionGuildModel = {
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>): Promise<SubscriptionWriteResult>;
};

export type SubscriptionServiceDeps = {
  GuildModel: SubscriptionGuildModel;
  logger: (level: string, context: string, message: string, meta?: unknown) => void;
  OP_UPDATE_OPTS: Record<string, unknown>;
  makeActivationId: () => string;
};

export type SubscriptionModuleKind = "updates" | "discounts" | "dlc";

export type StartSubscriptionOutcome =
  | { status: "activated" }
  | { status: "superseded" }
  | { status: "baseline-failed"; error: unknown };

export type PlayerCountBaseline = {
  gameKey: string;
  appId: string;
  playerCount: number;
  fetchedAt: Date;
};

type SubscriptionModuleSpec = {
  logContext: string;
  baselineWarnMessage: string;
  subscribedField: string;
  channelField: string;
  initializingField: string;
  activationField: string;
  lastErrorField: string;
  pendingField?: string;
  pendingEmpty?: Record<string, never> | ReadonlyArray<never>;
  seenHashVersionField?: string;
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
  },
  dlc: {
    logContext: "START_DLC",
    baselineWarnMessage: "Activat, dar baseline-ul DLC a esuat",
    subscribedField: "dlcSubscribed",
    channelField: "dlcChannelId",
    initializingField: "dlcInitializing",
    activationField: "dlcActivationId",
    lastErrorField: "dlcLastError"
  }
};

export function createSubscriptionService(deps: SubscriptionServiceDeps) {
  const { GuildModel, logger, OP_UPDATE_OPTS, makeActivationId } = deps;

  async function beginActivation(kind: SubscriptionModuleKind, guildId: string, channelId: string): Promise<string> {
    const spec = MODULE_SPECS[kind];
    const activationId = makeActivationId();
    const set: Record<string, unknown> = {
      [spec.subscribedField]: true,
      [spec.channelField]: channelId,
      [spec.initializingField]: true,
      [spec.activationField]: activationId
    };
    if (spec.pendingField) set[spec.pendingField] = spec.pendingEmpty;
    await GuildModel.updateOne(
      { _id: guildId },
      { $set: set, $unset: { [spec.lastErrorField]: "" } },
      { upsert: true, ...OP_UPDATE_OPTS }
    );
    return activationId;
  }

  async function finalizeActivation(kind: SubscriptionModuleKind, guildId: string, channelId: string, activationId: string): Promise<boolean> {
    const spec = MODULE_SPECS[kind];
    const set: Record<string, unknown> = { [spec.initializingField]: false };
    if (spec.seenHashVersionField) set[spec.seenHashVersionField] = HASH_VERSION;
    const result = await GuildModel.updateOne(
      {
        _id: guildId,
        [spec.subscribedField]: true,
        [spec.channelField]: channelId,
        [spec.activationField]: activationId
      },
      {
        $set: set,
        $unset: { [spec.activationField]: "", [spec.lastErrorField]: "" }
      },
      OP_UPDATE_OPTS
    );
    return matchedDocument(result);
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
    const set: Record<string, unknown> = {
      [spec.subscribedField]: false,
      [spec.channelField]: null,
      [spec.initializingField]: false
    };
    if (spec.pendingField) set[spec.pendingField] = spec.pendingEmpty;
    await GuildModel.updateOne({ _id: guildId }, {
      $set: set,
      $unset: { [spec.activationField]: "" }
    }, OP_UPDATE_OPTS);
  }

  async function startPlayerCount(
    guildId: string,
    channelId: string,
    seedBaseline: () => Promise<PlayerCountBaseline[]>
  ): Promise<StartSubscriptionOutcome> {
    const activationId = makeActivationId();
    await GuildModel.updateOne(
      { _id: guildId },
      {
        $set: {
          playerCountSubscribed: false,
          playerCountChannelId: channelId,
          playerCountInitializing: true,
          playerCountActivationId: activationId,
          playerCountWatchState: [],
          playerCountGames: []
        }
      },
      { upsert: true, ...OP_UPDATE_OPTS }
    );
    try {
      const baseline = await seedBaseline();
      const result = await GuildModel.updateOne(
        { _id: guildId, playerCountActivationId: activationId, playerCountInitializing: true },
        {
          $set: {
            playerCountSubscribed: true,
            playerCountInitializing: false,
            playerCountWatchState: baseline
          },
          $unset: { playerCountActivationId: "" }
        },
        OP_UPDATE_OPTS
      );
      return matchedDocument(result) ? { status: "activated" } : { status: "superseded" };
    } catch (error: unknown) {
      await GuildModel.updateOne(
        { _id: guildId, playerCountActivationId: activationId },
        {
          $set: {
            playerCountSubscribed: false,
            playerCountChannelId: null,
            playerCountInitializing: false,
            playerCountWatchState: []
          },
          $unset: { playerCountActivationId: "" }
        },
        OP_UPDATE_OPTS
      ).catch(() => null);
      logger("WARN", "START_PLAYER_COUNT", "Baseline-ul player-count a esuat", errorMessage(error));
      return { status: "baseline-failed", error };
    }
  }

  async function stopPlayerCount(guildId: string): Promise<void> {
    await GuildModel.updateOne(
      { _id: guildId },
      {
        $set: {
          playerCountSubscribed: false,
          playerCountChannelId: null,
          playerCountInitializing: false,
          playerCountWatchState: [],
          playerCountGames: []
        },
        $unset: { playerCountActivationId: "" }
      },
      OP_UPDATE_OPTS
    );
  }

  return {
    startUpdates: (guildId: string, channelId: string, seedBaseline: () => Promise<void>) =>
      startSubscription("updates", guildId, channelId, seedBaseline),
    stopUpdates: (guildId: string) => stopSubscription("updates", guildId),
    startDiscounts: (guildId: string, channelId: string, seedBaseline: () => Promise<void>) =>
      startSubscription("discounts", guildId, channelId, seedBaseline),
    stopDiscounts: (guildId: string) => stopSubscription("discounts", guildId),
    startDlc: (guildId: string, channelId: string, seedBaseline: () => Promise<void>) =>
      startSubscription("dlc", guildId, channelId, seedBaseline),
    stopDlc: (guildId: string) => stopSubscription("dlc", guildId),
    startPlayerCount,
    stopPlayerCount,
    rollbackActivation
  };
}

export type SubscriptionService = ReturnType<typeof createSubscriptionService>;
