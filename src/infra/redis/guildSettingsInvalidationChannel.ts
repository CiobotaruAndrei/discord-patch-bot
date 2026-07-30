import type { LoggerFunction } from "../../types.js";
import type { RedisRuntime, RedisSubscriberLike } from "./redisClient.js";
import type { GuildSettingsEventBus } from "../mongo/guildSettingsEventBus.js";
import { errorMessage } from "../../shared/errors.js";

const CHANNEL = "guild-settings-changed";

interface GuildSettingsInvalidationChannelDeps {
  redis: RedisRuntime;
  logger: LoggerFunction;
  bus: GuildSettingsEventBus;
}

interface GuildSettingsInvalidationChannel {
  start(): Promise<void>;
  stop(): Promise<void>;
}

function createGuildSettingsInvalidationChannel(deps: GuildSettingsInvalidationChannelDeps): GuildSettingsInvalidationChannel {
  const { redis, logger } = deps;
  const bus = deps.bus;
  let subscriber: RedisSubscriberLike | null = null;

  async function start(): Promise<void> {
    if (!redis.enabled) {
      logger("INFO", "GUILD_EVENTS", "Redis dezactivat — invalidarea cache-ului intre procese ramane pe TTL (GUILD_CACHE_TTL_MS).");
      return;
    }
    const client = redis.getClient();
    if (!client || typeof client.publish !== "function" || typeof client.duplicate !== "function") {
      logger("WARN", "GUILD_EVENTS", "Clientul Redis nu expune publish/duplicate — invalidarea intre procese ramane pe TTL.");
      return;
    }
    const publish = client.publish.bind(client);
    subscriber = client.duplicate();
    subscriber.on("error", err => logger("ERROR", "GUILD_EVENTS", "Eroare pe conexiunea de subscribe Redis", errorMessage(err)));
    await subscriber.connect();
    await subscriber.subscribe(CHANNEL, guildId => {
      bus.dispatchLocally(guildId);
    });
    bus.setRemotePublisher(guildId => {
      void publish(CHANNEL, guildId).catch(err =>
        logger("WARN", "GUILD_EVENTS", `Publish invalidare guild ${guildId} a esuat (raman pe TTL)`, errorMessage(err)));
    });
    logger("INFO", "GUILD_EVENTS", "Invalidarea cache-ului guild se propaga intre procese prin Redis pub/sub.");
  }

  async function stop(): Promise<void> {
    bus.setRemotePublisher(null);
    if (subscriber && subscriber.isOpen) {
      await subscriber.quit();
    }
    subscriber = null;
  }

  return { start, stop };
}

export { createGuildSettingsInvalidationChannel, CHANNEL as GUILD_SETTINGS_CHANNEL };
export type { GuildSettingsInvalidationChannel, GuildSettingsInvalidationChannelDeps };
