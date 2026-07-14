import type { DealInfo, FetchResult } from "../../types.js";
import type { AppRuntimeDeps, DiscordClientLike, HttpServerLike } from "../appRuntimeContracts.js";
import { runCacheHydrationPhase, runDatabaseStartupPhase, runDiscordStartupPhase, runHttpStartupPhase } from "../lifecycle/bootPhases.js";

import { ensureNativeFuzzy } from "../../native/fuzzy.js";

const MONGO_CONNECT_MAX_ATTEMPTS = 5;
const MONGO_CONNECT_INITIAL_BACKOFF_MS = 1000;
const MONGO_CONNECT_MAX_BACKOFF_MS = 16000;
const SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000;
const BOOT_ALERT_BUDGET_MS = 3000;

type ConnectMongoDeps = {
  mongoose: Pick<AppRuntimeDeps["mongoose"], "connect">;
  errorMessage: AppRuntimeDeps["errorMessage"];
  mongo: {
    logger: AppRuntimeDeps["mongo"]["logger"];
    env: Pick<AppRuntimeDeps["mongo"]["env"], "MONGO_URI" | "MONGO_MAX_POOL_SIZE">;
  };
};

type HydrateCachesDeps = {
  commands: Pick<AppRuntimeDeps["commands"], "setUpdatesCache" | "setDealsCache">;
  mongo: Pick<AppRuntimeDeps["mongo"], "logger" | "loadFetchSnapshot" | "loadDealsFetchSnapshots">;
};

async function connectMongoWithRetry(deps: ConnectMongoDeps): Promise<void> {
  const { mongoose, errorMessage, mongo } = deps;
  const { logger, env } = mongo;
  let backoff = MONGO_CONNECT_INITIAL_BACKOFF_MS;
  for (let attempt = 1; attempt <= MONGO_CONNECT_MAX_ATTEMPTS; attempt++) {
    try {
      await mongoose.connect(env.MONGO_URI, { maxPoolSize: env.MONGO_MAX_POOL_SIZE });
      if (attempt > 1) logger("INFO", "BOOT", `Mongo conectat la incercarea ${attempt}/${MONGO_CONNECT_MAX_ATTEMPTS}`);
      return;
    } catch (err) {
      if (attempt === MONGO_CONNECT_MAX_ATTEMPTS) throw err;
      const jitter = Math.round(backoff * (0.5 + Math.random() * 0.5));
      logger("WARN", "BOOT", `Mongo connect a esuat (incercarea ${attempt}/${MONGO_CONNECT_MAX_ATTEMPTS}), reincerc in ${jitter}ms`, errorMessage(err));
      await new Promise(resolve => setTimeout(resolve, jitter));
      backoff = Math.min(backoff * 2, MONGO_CONNECT_MAX_BACKOFF_MS);
    }
  }
}

async function hydrateStartupCaches(deps: HydrateCachesDeps): Promise<void> {
  const { commands, mongo } = deps;
  const { logger, loadFetchSnapshot, loadDealsFetchSnapshots } = mongo;
  const now = Date.now();
  let hydratedUpdates = false;
  let hydratedDeals = 0;
  const updatesSnapshot = await loadFetchSnapshot("updates");
  if (updatesSnapshot && Array.isArray(updatesSnapshot.payload) && now - updatesSnapshot.fetchedAt.getTime() < SNAPSHOT_MAX_AGE_MS) {
    commands.setUpdatesCache(updatesSnapshot.payload as FetchResult[]);
    hydratedUpdates = true;
  }
  for (const snapshot of await loadDealsFetchSnapshots()) {
    if (Array.isArray(snapshot.payload) && now - snapshot.fetchedAt.getTime() < SNAPSHOT_MAX_AGE_MS) {
      commands.setDealsCache(snapshot.currency, snapshot.payload as DealInfo[]);
      hydratedDeals++;
    }
  }
  if (hydratedUpdates || hydratedDeals) logger("INFO", "BOOT", `Cache hidratat din snapshot DB: updates=${hydratedUpdates}, deals=${hydratedDeals}`);
}

function createBootSequence(deps: AppRuntimeDeps, context: { client: DiscordClientLike; httpServer: HttpServerLike; guildInvalidationChannel: { start(): Promise<void> }; recoverOperationJournal?: () => Promise<{ recovered: number; failed: number }> }): () => Promise<void> {
  const { errorMessage, errorDetail, redis, mongo } = deps;
  const { logger, env, adminAlert, waitForMongoReady, runMigrations } = mongo;
  const { client, httpServer, guildInvalidationChannel, recoverOperationJournal } = context;
  return async function start(): Promise<void> {
    try {
      if (!ensureNativeFuzzy()) logger("WARN", "BOOT", "Addon Rust indisponibil; rulez cu fallback TypeScript permis de configuratia mediului.");
      await runDatabaseStartupPhase({
        connectMongo: () => connectMongoWithRetry(deps), waitForMongoReady, runMigrations,
        migrationsContinueOnError: env.MIGRATIONS_CONTINUE_ON_ERROR,
        recoverOperationJournal,
        logger, adminAlert, errorMessage, errorDetail
      });
      await redis.connect();
      await guildInvalidationChannel.start();
      await runCacheHydrationPhase({ hydrateCaches: () => hydrateStartupCaches(deps), logger, errorMessage });
      runHttpStartupPhase({ httpServer, port: env.PORT, logger, adminAlert, errorMessage, errorDetail });
      await runDiscordStartupPhase({ client, token: env.DISCORD_TOKEN });
    } catch (err) {
      logger("ERROR", "BOOT", "Eroare la pornire", errorDetail(err));
      await Promise.race([
        adminAlert("boot:fatal", "Botul nu a putut porni", errorMessage(err)).catch(() => null),
        new Promise<void>(resolve => {
          const timer = setTimeout(resolve, BOOT_ALERT_BUDGET_MS);
          if (typeof timer.unref === "function") timer.unref();
        })
      ]);
      throw err;
    }
  };
}

export { createBootSequence, connectMongoWithRetry, hydrateStartupCaches };

