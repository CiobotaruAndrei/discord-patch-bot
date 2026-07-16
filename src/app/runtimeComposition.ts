import mongoContext from "../infra/mongo/mongoContext.js";
import { composeMongoContextBundles } from "../infra/mongo/mongoContextBundles.js";
import { createRedisRuntime } from "../infra/redis/redisClient.js";
import { createRedisCache } from "../infra/redis/redisCache.js";
import { createSourceRegistry } from "../sources/sourceRegistryFactory.js";
import { createCircuitBreakerStore } from "../sources/updates/circuitBreakerStore.js";
import type { SourceRuntimeDeps } from "../sources/runtime.js";
import type { CommandRuntimeInput } from "../features/command-runtime/commandRuntimeDependencies.js";

const redisRuntime = createRedisRuntime(mongoContext.env, mongoContext.logger);
const redisCache = createRedisCache({ runtime: redisRuntime, logger: mongoContext.logger });
const sourceRuntimeDeps: SourceRuntimeDeps = {
  env: mongoContext.env,
  logger: mongoContext.logger,
  getAbortSignal: mongoContext.getAbortSignal,
  getCurrencyConfig: mongoContext.getCurrencyConfig,
  formatPrice: mongoContext.formatPrice,
  runConcurrent: mongoContext.runConcurrent,
  adminAlert: mongoContext.adminAlert,
  SchemaDriftError: mongoContext.SchemaDriftError,
  circuitBreakerStore: createCircuitBreakerStore(mongoContext.CircuitBreakerModel)
};
const sourceRegistry = createSourceRegistry(sourceRuntimeDeps);

const commandRuntimeInput: CommandRuntimeInput = {
  mongo: mongoContext,
  sources: sourceRegistry,
  redis: redisRuntime,
  redisCache
};

const mongoContextBundles = composeMongoContextBundles(mongoContext);

export { redisRuntime, redisCache, sourceRuntimeDeps, sourceRegistry, commandRuntimeInput, mongoContextBundles };
