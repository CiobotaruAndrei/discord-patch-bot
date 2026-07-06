import type { LoggerFunction } from "../../types";

const { createClient } = require("redis") as typeof import("redis");
const { errorMessage } = require("../../shared/errors") as typeof import("../../shared/errors");
const redisMetrics = require("./redisMetrics") as typeof import("./redisMetrics");

interface RedisClientLike {
  on(event: "error", listener: (err: unknown) => void): unknown;
  connect(): Promise<unknown>;
  quit(): Promise<unknown>;
  ping(): Promise<unknown>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
  readonly isOpen: boolean;
}

type RedisClientFactory = (options: { url: string }) => RedisClientLike;

type RedisStatus = "disabled" | "connected" | "disconnected";

interface RedisRuntimeEnv {
  REDIS_URL?: string;
}

interface RedisRuntime {
  readonly enabled: boolean;
  getClient(): RedisClientLike | null;
  status(): RedisStatus;
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
      status: () => "disabled",
      connect: async () => {
        logger("INFO", "REDIS", "REDIS_URL nu e setat — Redis dezactivat, botul continua fara cache extern.");
      },
      close: async () => undefined
    };
  }

  const client = createClientImpl({ url });
  client.on("error", err => {
    redisMetrics.recordRedisError();
    logger("ERROR", "REDIS", "Eroare client Redis", errorMessage(err));
  });

  return {
    enabled: true,
    getClient: () => client,
    status: () => (client.isOpen ? "connected" : "disconnected"),
    connect: async () => {
      try {
        await client.connect();
      } catch (err) {
        redisMetrics.recordRedisConnectFailure();
        throw err;
      }
      redisMetrics.recordRedisConnectSuccess();
      logger("INFO", "REDIS", "Redis conectat");
    },
    close: async () => {
      if (!client.isOpen) return;
      await client.quit();
    }
  };
}

export { createRedisRuntime };
export type { RedisRuntime, RedisStatus, RedisClientLike, RedisClientFactory, RedisRuntimeEnv };
