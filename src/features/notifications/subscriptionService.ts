"use strict";

import { errorMessage } from "../../shared/errors.js";
import { HASH_VERSION } from "../../native/fuzzy.js";
import { transitionSubscription, type SubscriptionStateSnapshot } from "./subscriptionStateMachine.js";

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
  const { GuildModel, logger, OP_UPDATE_OPTS, makeActivationId } = deps;
  const lifecycle = new Map<string, SubscriptionStateSnapshot>();
  const keyFor = (kind: SubscriptionModuleKind, guildId: string) => `${kind}:${guildId}`;

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
    lifecycle.set(keyFor(kind, guildId), transitionSubscription(lifecycle.get(keyFor(kind, guildId)) ?? { state: "inactive" }, { type: "begin", activationId }).next);
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
    lifecycle.set(keyFor(kind, guildId), transitionSubscription(lifecycle.get(keyFor(kind, guildId)) ?? { state: "initializing", activationId }, { type: "fail", activationId }).next);
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
      if (finalized) {
        const key = keyFor(kind, guildId);
        lifecycle.set(key, transitionSubscription(lifecycle.get(key) ?? { state: "initializing", activationId }, { type: "finalize", activationId }).next);
        return { status: "activated" };
      }
      const key = keyFor(kind, guildId);
      lifecycle.set(key, transitionSubscription(lifecycle.get(key) ?? { state: "initializing", activationId }, { type: "supersede", activationId }).next);
      return { status: "superseded" };
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
    lifecycle.set(keyFor(kind, guildId), { state: "inactive" });
  }

  async function startDlc(guildId: string, channelId: string): Promise<void> {
    const activationId = makeActivationId();
    await GuildModel.updateOne(
      { _id: guildId },
      { $set: { dlcSubscribed: true, dlcChannelId: channelId, dlcInitializing: false, dlcActivationId: activationId } },
      { upsert: true, ...OP_UPDATE_OPTS }
    );
  }

  async function stopDlc(guildId: string): Promise<void> {
    await GuildModel.updateOne({ _id: guildId }, {
      $set: { dlcSubscribed: false, dlcChannelId: null, dlcInitializing: false },
      $unset: { dlcActivationId: "" }
    }, OP_UPDATE_OPTS);
  }

  async function addPlayerCountGame(guildId: string, channelId: string, gameKey: string): Promise<void> {
    await GuildModel.updateOne(
      { _id: guildId },
      {
        $set: { playerCountSubscribed: true, playerCountChannelId: channelId },
        $addToSet: { playerCountGames: gameKey }
      },
      { upsert: true, ...OP_UPDATE_OPTS }
    );
  }

  async function addPlayerCountGames(guildId: string, channelId: string, gameKeys: string[]): Promise<void> {
    await GuildModel.updateOne(
      { _id: guildId },
      { $set: { playerCountSubscribed: true, playerCountChannelId: channelId, playerCountGames: [...new Set(gameKeys)] } },
      { upsert: true, ...OP_UPDATE_OPTS }
    );
  }

  async function stopPlayerCount(guildId: string): Promise<void> {
    await GuildModel.updateOne({ _id: guildId }, { $set: { playerCountSubscribed: false, playerCountChannelId: null, playerCountGames: [] } }, OP_UPDATE_OPTS);
  }

  async function setPlayerCountGames(guildId: string, remaining: string[], keepChannelId: string | null): Promise<void> {
    await GuildModel.updateOne({ _id: guildId }, {
      $set: {
        playerCountGames: remaining,
        playerCountSubscribed: remaining.length > 0,
        playerCountChannelId: remaining.length > 0 ? keepChannelId : null
      }
    }, OP_UPDATE_OPTS);
  }

  return {
    startUpdates: (guildId: string, channelId: string, seedBaseline: () => Promise<void>) =>
      startSubscription("updates", guildId, channelId, seedBaseline),
    stopUpdates: (guildId: string) => stopSubscription("updates", guildId),
    startDiscounts: (guildId: string, channelId: string, seedBaseline: () => Promise<void>) =>
      startSubscription("discounts", guildId, channelId, seedBaseline),
    stopDiscounts: (guildId: string) => stopSubscription("discounts", guildId),
    startDlc,
    stopDlc,
    addPlayerCountGame,
    addPlayerCountGames,
    stopPlayerCount,
    setPlayerCountGames,
    rollbackActivation
  };
}

export type SubscriptionService = ReturnType<typeof createSubscriptionService>;
