import { createModerationCleanupTask } from "../scheduler/moderationCleanupTask.js";
import { createChannelLockRecoveryTask } from "../scheduler/channelLockRecoveryTask.js";
import { createChannelLockRecoveryRuntime } from "../../features/command-security/channelLockRecoveryRuntime.js";
import { setLockedChannelPermissionState } from "../../features/guild-config/guildConfigRepository.js";

import type { ScheduledTaskRunner } from "../scheduler/scheduledTaskRunner.js";
import type { BotMetrics } from "../health/metricsTypes.js";
import type { MongoContextLike, RuntimeServices } from "../appRuntimeContracts.js";

type ModerationLifecycle = ReturnType<typeof import("../../features/moderation/moderationLifecycleRuntime.js")["createModerationLifecycleRuntime"]>;

export type SchedulerFeatureTasks = {
  readonly moderationCleanup: ScheduledTaskRunner | null;
  readonly channelLockRecovery: ScheduledTaskRunner | null;
};

export type SchedulerFeatureInput = {
  readonly mongo: MongoContextLike;
  readonly client: RuntimeServices["client"];
  readonly metrics: BotMetrics;
  readonly moderationLifecycleRuntime?: ModerationLifecycle;
  readonly errorMessage: (err: unknown) => string;
  readonly errorDetail: (err: unknown) => string;
};

const NO_TASKS: SchedulerFeatureTasks = { moderationCleanup: null, channelLockRecovery: null };

export function createSchedulerFeatureTasks(input: SchedulerFeatureInput): SchedulerFeatureTasks {
  const { mongo, client, metrics, moderationLifecycleRuntime, errorMessage, errorDetail } = input;
  const { logger, adminAlert } = mongo;

  const moderationCleanup = moderationLifecycleRuntime
    ? createModerationCleanupTask({
      cleanupExpired: async () => {
        await moderationLifecycleRuntime.cleanupExpired();
        await moderationLifecycleRuntime.reconcileClient(client);
      },
      metrics, logger, adminAlert, errorMessage, errorDetail
    })
    : null;

  const lockRecoveryModel = mongo.ChannelLockRecoveryModel;
  const lockRecoveryGuildModel = mongo.GuildModel;
  const channelLockRecovery = lockRecoveryModel && lockRecoveryGuildModel
    ? createChannelLockRecoveryTask({
      runRecoveryCycle: () => createChannelLockRecoveryRuntime({
        RecoveryModel: lockRecoveryModel,
        fetchChannel: async (_guildId, channelId) => (await Promise.resolve(client.channels?.fetch(channelId))) ?? null,
        persistState: (guildId, channelId, previous, locked) =>
          setLockedChannelPermissionState(lockRecoveryGuildModel, guildId, channelId, previous, locked),
        logger
      }).runRecoveryCycle(),
      metrics, logger, adminAlert, errorMessage, errorDetail
    })
    : null;

  return { moderationCleanup, channelLockRecovery };
}

export function createIdleSchedulerFeatureTasks(): SchedulerFeatureTasks {
  return NO_TASKS;
}
