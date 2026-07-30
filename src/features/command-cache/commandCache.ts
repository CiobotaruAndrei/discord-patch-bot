import type { RuntimeEnv } from "../../config/runtimeEnvTypes.js";
import { createRuntimeLimits } from "./runtimeLimits.js";
import { createUserCooldowns } from "./userCooldowns.js";
import { createCommandCaches } from "./commandCaches.js";
import { createUserErrorFormatting } from "./userErrorFormatting.js";
import {
  computeMissingChannelPerms,
  createChannelPermissionChecks,
  formatMissingChannelPerms
} from "./channelPermissionChecks.js";
import type { PermissionsBitFieldLike } from "./channelPermissionChecks.js";

type Logger = (level: string, context: string, message: string, meta?: unknown) => void;

interface CommandCacheDeps {
  crypto: {
    randomBytes(size: number): { toString(encoding: BufferEncoding): string };
  };
  PermissionsBitField: PermissionsBitFieldLike;
  logger: Logger;
  DEFAULT_CURRENCY: string;
  env: RuntimeEnv;
}

function createCommandCache(deps: CommandCacheDeps) {
  const { crypto, PermissionsBitField, logger, DEFAULT_CURRENCY, env } = deps;

  const limits = createRuntimeLimits(env);
  const cooldowns = createUserCooldowns({ USER_COMMAND_COOLDOWN_MS: limits.USER_COMMAND_COOLDOWN_MS });
  const caches = createCommandCaches({
    logger,
    DEFAULT_CURRENCY,
    DEALS_CURRENCY_CACHE_MAX_SIZE: limits.DEALS_CURRENCY_CACHE_MAX_SIZE,
    SINGLE_CACHE_MAX_SIZE: limits.SINGLE_CACHE_MAX_SIZE,
    DLC_CACHE_MAX_SIZE: limits.DLC_CACHE_MAX_SIZE,
    cleanUserCooldowns: () => cooldowns.cleanUserCooldowns(),
    getUserCooldownsSize: () => cooldowns.getUserCooldownsSize()
  });
  const channelPerms = createChannelPermissionChecks({ PermissionsBitField });
  const userErrors = createUserErrorFormatting({ logger });

  function smoothTime(oldMs: number, newMs: number, alpha = 0.3): number {
    return Math.round(oldMs * (1 - alpha) + newMs * alpha);
  }

  function makeActivationId(): string {
    return crypto.randomBytes(8).toString("hex");
  }

  async function sleepIfPositive(ms: number): Promise<void> {
    if (ms > 0) await new Promise(resolve => setTimeout(resolve, ms));
  }

  return {
    ...limits,
    ...caches,
    checkUserCooldown: cooldowns.checkUserCooldown,
    cleanUserCooldowns: cooldowns.cleanUserCooldowns,
    smoothTime,
    formatUserError: userErrors.formatUserError,
    canSendEmbeds: channelPerms.canSendEmbeds,
    listMissingChannelPerms: channelPerms.listMissingChannelPerms,
    missingChannelPermsMessage: channelPerms.missingChannelPermsMessage,
    makeActivationId,
    sleepIfPositive
  };
}

const commandCacheModule = {
  createCommandCache,
  computeMissingChannelPerms,
  formatMissingChannelPerms
};

export default commandCacheModule;
