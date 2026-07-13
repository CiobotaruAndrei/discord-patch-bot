"use strict";

import type { LoggerFunction } from "../types.js";

import { createRedisRuntime } from "../infra/redis/redisClient.js";
import { runRedisConnectivityCheck } from "../infra/redis/redisConnectivityCheck.js";

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
