"use strict";

import type { LoggerFunction } from "../types";

const { createRedisRuntime } = require("../infra/redis/redisClient") as typeof import("../infra/redis/redisClient");
const { runRedisConnectivityCheck } = require("../infra/redis/redisConnectivityCheck") as typeof import("../infra/redis/redisConnectivityCheck");

const logger: LoggerFunction = (level, context, message) => console.log(`[${level}] ${context}: ${message}`);

const runtime = createRedisRuntime({ REDIS_URL: process.env.REDIS_URL }, logger);

runRedisConnectivityCheck(runtime).then(result => {
  if (result.status === "disabled") {
    console.log(`Redis: ${result.message}`);
  } else if (result.ok) {
    console.log(`Redis OK: ${result.message}`);
  } else {
    console.error(`Redis: ${result.message}`);
  }
  process.exit(result.ok ? 0 : 1);
});

export {};
