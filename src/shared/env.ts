import type { z as ZodNamespace } from "zod";
import type { LoggerFunction, ParseEnvNumber, RuntimeEnv } from "../types";
import { BOOLEAN_ENV_PATTERN, parseBooleanEnv } from "./booleanEnv";

type ZodLike = typeof ZodNamespace;

interface EnvContext {
  z: ZodLike;
  logger: LoggerFunction;
  parseEnvNumber: ParseEnvNumber;
  RAW_LOG_LEVEL: string;
  env?: RuntimeEnv;
  isProd?: boolean;
  ONE_HOUR_MS?: number;
  ONE_DAY_MS?: number;
  THIRTY_DAYS_MS?: number;
}

interface ErrorWithDetails {
  issues?: unknown;
  message?: string;
}

function errorDetail(err: unknown): unknown {
  const maybe = err as ErrorWithDetails;
  return maybe.issues || maybe.message || String(err);
}

interface EnvProblem {
  variable: string;
  problem: string;
}

function formatEnvValidationErrors(err: unknown): EnvProblem[] {
  const issues = (err as { issues?: Array<{ path?: unknown[]; message?: string }> })?.issues;
  if (!Array.isArray(issues) || issues.length === 0) {
    return [{ variable: "(general)", problem: (err as { message?: string })?.message || String(err) }];
  }
  return issues.map(issue => ({
    variable: Array.isArray(issue.path) && issue.path.length ? String(issue.path[0]) : "(general)",
    problem: issue.message || "valoare invalida"
  }));
}

function attachEnv(target: EnvContext): void {
  const { z, logger, parseEnvNumber, RAW_LOG_LEVEL } = target;

  const isProd = process.env.NODE_ENV === "production";
  const PLACEHOLDER_METRICS_TOKEN = "change_me_to_a_long_random_value";
  const rawMetricsToken = process.env.METRICS_TOKEN || "";
  const effectiveMetricsToken = rawMetricsToken === PLACEHOLDER_METRICS_TOKEN ? "" : rawMetricsToken;
  if (isProd && String(process.env.METRICS_PUBLIC || "").toLowerCase() === "true") {
    logger("WARN", "ENV", "METRICS_PUBLIC=true este ignorat in productie - /metrics cere token (seteaza METRICS_TOKEN).");
  }
  if (rawMetricsToken === PLACEHOLDER_METRICS_TOKEN) {
    logger("WARN", "ENV", "METRICS_TOKEN are valoarea placeholder, tratat ca lipsa");
  }

  const EnvSchema = z.object({
    MONGO_URI: z.string().min(1, "MONGO_URI lipseste"),
    DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN lipseste"),
    DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID lipseste (necesar pentru slash commands)"),
    DISCORD_DEV_GUILD_ID: z.string().regex(/^\d+$/, "DISCORD_DEV_GUILD_ID trebuie sa fie snowflake numeric").optional(),
    PORT: z.string().regex(/^\d+$/, "PORT trebuie sa fie numar TCP valid")
      .refine(s => { const n = Number(s); return n >= 1 && n <= 65535; }, "PORT trebuie sa fie intre 1 si 65535")
      .optional(),
    NODE_ENV: z.string().optional(),
    METRICS_TOKEN: z.string().min(8, "METRICS_TOKEN trebuie sa aiba cel putin 8 caractere").optional(),
    METRICS_PUBLIC: z.string().optional(),
    ADMIN_WEBHOOK_URL: z.string().url("ADMIN_WEBHOOK_URL nu este URL valid")
      .refine(u => {
        try { return ["http:", "https:"].includes(new URL(u).protocol); }
        catch { return false; }
      }, "ADMIN_WEBHOOK_URL trebuie sa fie http:// sau https://")
      .optional(),
    LOG_LEVEL: z.string().optional(),
    PROXY_URLS: z.string().optional(),
    TRUST_PROXY: z.string().regex(BOOLEAN_ENV_PATTERN, "TRUST_PROXY trebuie sa fie true/false/1/0").optional(),
    TRUSTED_PROXY_COUNT: z.string().regex(/^\d+$/, "TRUSTED_PROXY_COUNT trebuie sa fie un numar intreg >= 0").optional()
  }).superRefine((env, validationContext) => {
    if (isProd) {
      const hasToken = !!env.METRICS_TOKEN;
      if (!hasToken) {
        validationContext.addIssue({
          code: z.ZodIssueCode.custom,
          message: "In NODE_ENV=production trebuie setat METRICS_TOKEN. METRICS_PUBLIC=true nu mai e acceptat ca opt-in in productie - /metrics fara token ramane permis doar in dev/local."
        });
      }
    }
  });

  try {
    EnvSchema.parse({
      MONGO_URI: process.env.MONGO_URI,
      DISCORD_TOKEN: process.env.DISCORD_TOKEN,
      DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
      DISCORD_DEV_GUILD_ID: process.env.DISCORD_DEV_GUILD_ID,
      PORT: process.env.PORT,
      NODE_ENV: process.env.NODE_ENV,
      METRICS_TOKEN: effectiveMetricsToken || undefined,
      METRICS_PUBLIC: process.env.METRICS_PUBLIC,
      ADMIN_WEBHOOK_URL: process.env.ADMIN_WEBHOOK_URL,
      LOG_LEVEL: process.env.LOG_LEVEL,
      PROXY_URLS: process.env.PROXY_URLS,
      TRUST_PROXY: process.env.TRUST_PROXY,
      TRUSTED_PROXY_COUNT: process.env.TRUSTED_PROXY_COUNT
    });
  } catch (err) {
    const problems = formatEnvValidationErrors(err);
    const summary = problems.map(p => `${p.variable} (${p.problem})`).join("; ");
    logger("ERROR", "ENV", `Pornire blocata: ${problems.length} variabila(e) de mediu lipsa sau invalida(e) — ${summary}. Completeaza-le (vezi src/.env.example) si reporneste.`, problems);
    process.exit(1);
  }

  const ONE_HOUR_MS = 60 * 60 * 1000;
  const ONE_DAY_MS = 24 * ONE_HOUR_MS;
  const THIRTY_DAYS_MS = 30 * ONE_DAY_MS;

  const env: RuntimeEnv = {
    MONGO_URI: process.env.MONGO_URI,
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
    DISCORD_DEV_GUILD_ID: process.env.DISCORD_DEV_GUILD_ID || "",
    PORT: process.env.PORT || "3000",
    NODE_ENV: process.env.NODE_ENV || "development",
    METRICS_TOKEN: effectiveMetricsToken,
    METRICS_PUBLIC: String(process.env.METRICS_PUBLIC || "").toLowerCase() === "true",
    TRUST_PROXY: parseBooleanEnv(process.env.TRUST_PROXY),
    TRUSTED_PROXY_COUNT: parseEnvNumber("TRUSTED_PROXY_COUNT", 1, { min: 0, max: 20 }),
    ADMIN_WEBHOOK_URL: process.env.ADMIN_WEBHOOK_URL || "",
    LOG_LEVEL: RAW_LOG_LEVEL,
    PROXY_URLS: process.env.PROXY_URLS || "",

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

    MAX_UPDATES_PER_CYCLE: parseEnvNumber("MAX_UPDATES_PER_CYCLE", 5, { min: 1, max: 100 }),
    MAX_DEALS_PER_CYCLE: parseEnvNumber("MAX_DEALS_PER_CYCLE", 8, { min: 1, max: 100 }),
    GUILD_PROCESS_CONCURRENCY: parseEnvNumber("GUILD_PROCESS_CONCURRENCY", 3, { min: 1, max: 50 }),

    SEEN_PER_GAME_LIMIT: parseEnvNumber("SEEN_PER_GAME_LIMIT", 20, { min: 5, max: 1000 }),
    DEALS_HISTORY_LIMIT: parseEnvNumber("DEALS_HISTORY_LIMIT", 300, { min: 50, max: 10000 }),
    PENDING_UPDATES_PER_GAME_LIMIT: parseEnvNumber("PENDING_UPDATES_PER_GAME_LIMIT", 5, { min: 1, max: 100 }),
    PENDING_DISCOUNTS_LIMIT: parseEnvNumber("PENDING_DISCOUNTS_LIMIT", 200, { min: 10, max: 10000 }),

    PENDING_UPDATE_MAX_AGE_MS: parseEnvNumber("PENDING_UPDATE_MAX_AGE_MS", ONE_DAY_MS, { min: 60_000, max: THIRTY_DAYS_MS }),
    PENDING_DISCOUNT_GRACE_CYCLES: parseEnvNumber("PENDING_DISCOUNT_GRACE_CYCLES", 3, { min: 1, max: 100 }),
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
    GLOBAL_HEALTH_MIN_RATIO: parseEnvNumber("GLOBAL_HEALTH_MIN_RATIO", 30, { min: 5, max: 90 }),

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
    HTTP_RATE_LIMIT_WINDOW_MS: parseEnvNumber("HTTP_RATE_LIMIT_WINDOW_MS", 60_000, { min: 1000, max: ONE_HOUR_MS }),

    isProd
  };

  logger("INFO", "ENV", "Configuratie de tuning incarcata", {
    LOG_LEVEL: env.LOG_LEVEL,
    FETCH_CONCURRENCY: env.FETCH_CONCURRENCY,
    GUILD_PROCESS_CONCURRENCY: env.GUILD_PROCESS_CONCURRENCY,
    DISCORD_SEND_DELAY_MS: env.DISCORD_SEND_DELAY_MS,
    MAX_UPDATES_PER_CYCLE: env.MAX_UPDATES_PER_CYCLE,
    MAX_DEALS_PER_CYCLE: env.MAX_DEALS_PER_CYCLE,
    SCHEMA_DRIFT_THRESHOLD: env.SCHEMA_DRIFT_THRESHOLD,
    GLOBAL_HEALTH_WINDOW: env.GLOBAL_HEALTH_WINDOW,
    GLOBAL_HEALTH_MIN_RATIO: env.GLOBAL_HEALTH_MIN_RATIO,
    ENRICHED_DEAL_CACHE_TTL_MS: env.ENRICHED_DEAL_CACHE_TTL_MS,
    MONGO_MAX_POOL_SIZE: env.MONGO_MAX_POOL_SIZE,
    MONGO_RETRY_ATTEMPTS: env.MONGO_RETRY_ATTEMPTS,
    SHUTDOWN_DRAIN_MS: env.SHUTDOWN_DRAIN_MS,
    PROXY_URLS_CONFIGURED: !!env.PROXY_URLS,
    METRICS_TOKEN_SET: !!env.METRICS_TOKEN
  });

  Object.assign(target, {
    env,
    isProd,
    ONE_HOUR_MS,
    ONE_DAY_MS,
    THIRTY_DAYS_MS
  });
}

attachEnv.formatEnvValidationErrors = formatEnvValidationErrors;

export = attachEnv;
