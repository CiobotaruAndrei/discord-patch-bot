import type { LoggerFunction } from "../../types";

const { createClient } = require("redis") as typeof import("redis");
const { errorMessage } = require("../../shared/errors") as typeof import("../../shared/errors");

interface RedisClientLike {
  on(event: "error", listener: (err: unknown) => void): unknown;
  connect(): Promise<unknown>;
  quit(): Promise<unknown>;
  readonly isOpen: boolean;
}

type RedisClientFactory = (options: { url: string }) => RedisClientLike;

interface RedisRuntimeEnv {
  REDIS_URL?: string;
}

interface RedisRuntime {
  readonly enabled: boolean;
  getClient(): RedisClientLike | null;
  connect(): Promise<void>;
  close(): Promise<void>;
}

const defaultCreateClient: RedisClientFactory = options => createClient(options);

function createRedisRuntime(
  env: RedisRuntimeEnv,
  logger: LoggerFunction,
  createClientImpl: RedisClientFactory = defaultCreateClient
): RedisRuntime {
  const url = env.REDIS_URL;
  if (!url) {
    return {
      enabled: false,
      getClient: () => null,
      connect: async () => {
        logger("INFO", "REDIS", "REDIS_URL nu e setat — Redis dezactivat, botul continua fara cache extern.");
      },
      close: async () => undefined
    };
  }

  const client = createClientImpl({ url });
  client.on("error", err => logger("ERROR", "REDIS", "Eroare client Redis", errorMessage(err)));

  return {
    enabled: true,
    getClient: () => client,
    connect: async () => {
      await client.connect();
      logger("INFO", "REDIS", "Redis conectat");
    },
    close: async () => {
      if (!client.isOpen) return;
      await client.quit();
    }
  };
}

export { createRedisRuntime };
export type { RedisRuntime, RedisClientLike, RedisClientFactory, RedisRuntimeEnv };
