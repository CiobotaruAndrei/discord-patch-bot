import type { ParseEnvNumber } from "../types.js";

interface TuningDurations {
  ONE_HOUR_MS: number;
  ONE_DAY_MS: number;
  THIRTY_DAYS_MS: number;
}

export function buildSourcesTuningEnv(parseEnvNumber: ParseEnvNumber) {
  return {
    FETCH_CONCURRENCY: parseEnvNumber("FETCH_CONCURRENCY", 10, { min: 1, max: 50 }),
    FETCH_CONCURRENCY_STEAM: parseEnvNumber("FETCH_CONCURRENCY_STEAM", 4, { min: 1, max: 50 }),
    FETCH_CONCURRENCY_EPIC: parseEnvNumber("FETCH_CONCURRENCY_EPIC", 2, { min: 1, max: 50 }),
    FETCH_CONCURRENCY_LISTING: parseEnvNumber("FETCH_CONCURRENCY_LISTING", 8, { min: 1, max: 50 }),
    FETCH_CONCURRENCY_DRIVER: parseEnvNumber("FETCH_CONCURRENCY_DRIVER", 2, { min: 1, max: 50 }),
    MAX_HTML_BYTES: parseEnvNumber("MAX_HTML_BYTES", 500_000, { min: 50_000, max: 50_000_000 }),
    MAX_JSON_BYTES: parseEnvNumber("MAX_JSON_BYTES", 5_000_000, { min: 100_000, max: 100_000_000 }),
    MAX_DEALS: parseEnvNumber("MAX_DEALS", 50, { min: 1, max: 500 }),
    STEAM_SPECIALS_LIMIT: parseEnvNumber("STEAM_SPECIALS_LIMIT", 30, { min: 1, max: 200 }),
    EPIC_SPECIALS_LIMIT: parseEnvNumber("EPIC_SPECIALS_LIMIT", 20, { min: 1, max: 200 }),
    STEAM_REVIEW_BATCH_SIZE: parseEnvNumber("STEAM_REVIEW_BATCH_SIZE", 5, { min: 1, max: 50 }),
    STEAM_REVIEW_BATCH_DELAY_MS: parseEnvNumber("STEAM_REVIEW_BATCH_DELAY_MS", 500, { min: 0, max: 60000 }),
    DISCORD_SEND_DELAY_MS: parseEnvNumber("DISCORD_SEND_DELAY_MS", 800, { min: 0, max: 60000 }),
    DISCORD_SEND_RATE_CAPACITY: parseEnvNumber("DISCORD_SEND_RATE_CAPACITY", 5, { min: 1, max: 1000 }),
    DISCORD_SEND_RATE_PER_SEC: parseEnvNumber("DISCORD_SEND_RATE_PER_SEC", 5, { min: 1, max: 1000 }),
    DISCORD_SEND_RATE_MAX_WAIT_MS: parseEnvNumber("DISCORD_SEND_RATE_MAX_WAIT_MS", 5000, { min: 1, max: 60000 })
  };
}

export function buildCycleTuningEnv(parseEnvNumber: ParseEnvNumber, { ONE_HOUR_MS, ONE_DAY_MS, THIRTY_DAYS_MS }: TuningDurations) {
  return {
    MAX_UPDATES_PER_CYCLE: parseEnvNumber("MAX_UPDATES_PER_CYCLE", 5, { min: 1, max: 100 }),
    MAX_DEALS_PER_CYCLE: parseEnvNumber("MAX_DEALS_PER_CYCLE", 8, { min: 1, max: 100 }),
    GUILD_PROCESS_CONCURRENCY: parseEnvNumber("GUILD_PROCESS_CONCURRENCY", 3, { min: 1, max: 50 }),

    SEEN_PER_GAME_LIMIT: parseEnvNumber("SEEN_PER_GAME_LIMIT", 20, { min: 5, max: 1000 }),
    DEALS_HISTORY_LIMIT: parseEnvNumber("DEALS_HISTORY_LIMIT", 300, { min: 50, max: 10000 }),
    PENDING_UPDATES_PER_GAME_LIMIT: parseEnvNumber("PENDING_UPDATES_PER_GAME_LIMIT", 5, { min: 1, max: 100 }),
    PENDING_DISCOUNTS_LIMIT: parseEnvNumber("PENDING_DISCOUNTS_LIMIT", 200, { min: 10, max: 10000 }),

    PENDING_UPDATE_MAX_AGE_MS: parseEnvNumber("PENDING_UPDATE_MAX_AGE_MS", ONE_DAY_MS, { min: 60_000, max: THIRTY_DAYS_MS }),
    PENDING_DISCOUNT_GRACE_CYCLES: parseEnvNumber("PENDING_DISCOUNT_GRACE_CYCLES", 3, { min: 1, max: 100 }),
    PRICE_ALERT_REARM_ABSENT_CYCLES: parseEnvNumber("PRICE_ALERT_REARM_ABSENT_CYCLES", 3, { min: 1, max: 100 }),
    PENDING_UPDATE_MAX_ATTEMPTS: parseEnvNumber("PENDING_UPDATE_MAX_ATTEMPTS", 5, { min: 1, max: 100 }),
    PENDING_DISCOUNT_MAX_ATTEMPTS: parseEnvNumber("PENDING_DISCOUNT_MAX_ATTEMPTS", 10, { min: 1, max: 100 }),
    MAX_FUZZY_SEARCH_INPUT: parseEnvNumber("MAX_FUZZY_SEARCH_INPUT", 100, { min: 10, max: 500 }),

    INFLIGHT_PROMISE_TIMEOUT_MS: parseEnvNumber("INFLIGHT_PROMISE_TIMEOUT_MS", 120000, { min: 10000, max: 600000 }),
    USER_COMMAND_COOLDOWN_MS: parseEnvNumber("USER_COMMAND_COOLDOWN_MS", 10000, { min: 0, max: 300000 }),

    CIRCUIT_BREAKER_FAIL_THRESHOLD: parseEnvNumber("CIRCUIT_BREAKER_FAIL_THRESHOLD", 5, { min: 2, max: 100 }),
    CIRCUIT_BREAKER_COOLDOWN_MS: parseEnvNumber("CIRCUIT_BREAKER_COOLDOWN_MS", 45 * 60 * 1000, { min: 60_000, max: 12 * ONE_HOUR_MS }),
    CIRCUIT_BREAKER_JITTER_MS: parseEnvNumber("CIRCUIT_BREAKER_JITTER_MS", 15 * 60 * 1000, { min: 0, max: 2 * ONE_HOUR_MS }),
    SCHEMA_DRIFT_THRESHOLD: parseEnvNumber("SCHEMA_DRIFT_THRESHOLD", 3, { min: 1, max: 50 }),
    GLOBAL_HEALTH_WINDOW: parseEnvNumber("GLOBAL_HEALTH_WINDOW", 5, { min: 2, max: 50 }),
    GLOBAL_HEALTH_MIN_RATIO: parseEnvNumber("GLOBAL_HEALTH_MIN_RATIO", 30, { min: 5, max: 90 })
  };
}

export function buildCacheTuningEnv(parseEnvNumber: ParseEnvNumber, { ONE_HOUR_MS }: Pick<TuningDurations, "ONE_HOUR_MS">) {
  return {
    COLLECTOR_TIMEOUT_MS: parseEnvNumber("COLLECTOR_TIMEOUT_MS", 5 * 60 * 1000, { min: 30_000, max: ONE_HOUR_MS }),
    HOUSEKEEPING_INTERVAL_MS: parseEnvNumber("HOUSEKEEPING_INTERVAL_MS", 2 * 60 * 1000, { min: 30_000, max: ONE_HOUR_MS }),
    GUILD_CACHE_TTL_MS: parseEnvNumber("GUILD_CACHE_TTL_MS", 60_000, { min: 5_000, max: ONE_HOUR_MS }),
    GUILD_CACHE_MAX_SIZE: parseEnvNumber("GUILD_CACHE_MAX_SIZE", 1_000, { min: 10, max: 100_000 }),
    ADMIN_ALERT_COOLDOWN_MS: parseEnvNumber("ADMIN_ALERT_COOLDOWN_MS", 30 * 60 * 1000, { min: 60_000, max: 24 * ONE_HOUR_MS }),
    SHUTDOWN_DRAIN_MS: parseEnvNumber("SHUTDOWN_DRAIN_MS", 5000, { min: 0, max: 30_000 }),

    ENRICHED_DEAL_CACHE_TTL_MS: parseEnvNumber("ENRICHED_DEAL_CACHE_TTL_MS", 10 * 60 * 1000, { min: 0, max: ONE_HOUR_MS }),
    ENRICHED_DEAL_CACHE_MAX_SIZE: parseEnvNumber("ENRICHED_DEAL_CACHE_MAX_SIZE", 500, { min: 0, max: 10_000 }),

    CACHE_TTL_MS: parseEnvNumber("CACHE_TTL_MS", 3 * 60 * 1000, { min: 30_000, max: ONE_HOUR_MS }),
    SINGLE_CACHE_MAX_SIZE: parseEnvNumber("SINGLE_CACHE_MAX_SIZE", 100, { min: 10, max: 10_000 }),
    DLC_CACHE_MAX_SIZE: parseEnvNumber("DLC_CACHE_MAX_SIZE", 100, { min: 10, max: 10_000 }),
    DEALS_CURRENCY_CACHE_MAX_SIZE: parseEnvNumber("DEALS_CURRENCY_CACHE_MAX_SIZE", 8, { min: 4, max: 50 }),
    ITEMS_PER_PAGE: parseEnvNumber("ITEMS_PER_PAGE", 5, { min: 1, max: 25 }),
    DLC_ITEMS_PER_PAGE: parseEnvNumber("DLC_ITEMS_PER_PAGE", 10, { min: 1, max: 25 }),
    COMMAND_OUTPUT_MAX_CHARS: parseEnvNumber("COMMAND_OUTPUT_MAX_CHARS", 1900, { min: 500, max: 2000 }),

    MONGO_MAX_POOL_SIZE: parseEnvNumber("MONGO_MAX_POOL_SIZE", 15, { min: 1, max: 200 }),
    MONGO_RETRY_ATTEMPTS: parseEnvNumber("MONGO_RETRY_ATTEMPTS", 2, { min: 0, max: 10 }),

    HTTP_RATE_LIMIT_REQ: parseEnvNumber("HTTP_RATE_LIMIT_REQ", 60, { min: 1, max: 10000 }),
    HTTP_RATE_LIMIT_WINDOW_MS: parseEnvNumber("HTTP_RATE_LIMIT_WINDOW_MS", 60_000, { min: 1000, max: ONE_HOUR_MS })
  };
}
