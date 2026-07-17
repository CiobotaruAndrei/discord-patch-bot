import type { z as ZodNamespace } from "zod";
import type { LoggerFunction, ParseEnvNumber, RuntimeEnv } from "../types.js";
import { BOOLEAN_ENV_PATTERN, parseBooleanEnv } from "./booleanEnv.js";
import { resolveBotRole, BOT_ROLES } from "./botRole.js";
import { buildSourcesTuningEnv, buildCycleTuningEnv, buildCacheTuningEnv } from "./envTuning.js";

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

function makeOptionalBooleanEnv(z: ZodLike, name: string) {
  return z.preprocess(
    value => (value === "" ? undefined : value),
    z.string().regex(BOOLEAN_ENV_PATTERN, `${name} trebuie sa fie true/false/1/0`).optional()
  );
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

function buildEnvFrom(context: EnvContext) {
  const { z, logger, parseEnvNumber, RAW_LOG_LEVEL } = context;

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

  const optionalBooleanEnv = (name: string) => makeOptionalBooleanEnv(z, name);

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
    METRICS_PUBLIC: optionalBooleanEnv("METRICS_PUBLIC"),
    ADMIN_WEBHOOK_URL: z.string().url("ADMIN_WEBHOOK_URL nu este URL valid")
      .refine(u => {
        try { return ["http:", "https:"].includes(new URL(u).protocol); }
        catch { return false; }
      }, "ADMIN_WEBHOOK_URL trebuie sa fie http:// sau https://")
      .optional(),
    LOG_LEVEL: z.string().optional(),
    THREAT_REPUTATION_URL: z.string().url("THREAT_REPUTATION_URL nu este URL valid")
      .refine(u => {
        try { return new URL(u).protocol === "https:"; }
        catch { return false; }
      }, "THREAT_REPUTATION_URL trebuie sa fie https://")
      .optional(),
    THREAT_REPUTATION_TOKEN: z.string().min(8, "THREAT_REPUTATION_TOKEN trebuie sa aiba cel putin 8 caractere").optional(),
    BOT_ROLE: z.string().refine(v => (BOT_ROLES as readonly string[]).includes(v), "BOT_ROLE trebuie sa fie all, web sau worker").optional(),
    PROXY_URLS: z.string().optional(),
    REDIS_URL: z.string()
      .refine(u => {
        try { return ["redis:", "rediss:"].includes(new URL(u).protocol); }
        catch { return false; }
      }, "REDIS_URL trebuie sa fie un URL redis:// sau rediss://")
      .optional(),
    TRUST_PROXY: optionalBooleanEnv("TRUST_PROXY"),
    TRUSTED_PROXY_COUNT: z.string().regex(/^\d+$/, "TRUSTED_PROXY_COUNT trebuie sa fie un numar intreg >= 0").optional(),
    NOTIFICATION_OUTBOX_ENABLED: optionalBooleanEnv("NOTIFICATION_OUTBOX_ENABLED"),
    NOTIFICATION_OUTBOX_RECOVERY_VERIFY: optionalBooleanEnv("NOTIFICATION_OUTBOX_RECOVERY_VERIFY"),
    NOTIFICATION_OUTBOX_RECOVERY_STRICT: optionalBooleanEnv("NOTIFICATION_OUTBOX_RECOVERY_STRICT"),
    MIGRATIONS_CONTINUE_ON_ERROR: optionalBooleanEnv("MIGRATIONS_CONTINUE_ON_ERROR"),
    ALLOW_DEFAULT_PROXIES: optionalBooleanEnv("ALLOW_DEFAULT_PROXIES")
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
      THREAT_REPUTATION_URL: process.env.THREAT_REPUTATION_URL,
      THREAT_REPUTATION_TOKEN: process.env.THREAT_REPUTATION_TOKEN,
      BOT_ROLE: process.env.BOT_ROLE,
      PROXY_URLS: process.env.PROXY_URLS,
      REDIS_URL: process.env.REDIS_URL,
      TRUST_PROXY: process.env.TRUST_PROXY,
      TRUSTED_PROXY_COUNT: process.env.TRUSTED_PROXY_COUNT,
      NOTIFICATION_OUTBOX_ENABLED: process.env.NOTIFICATION_OUTBOX_ENABLED,
      NOTIFICATION_OUTBOX_RECOVERY_VERIFY: process.env.NOTIFICATION_OUTBOX_RECOVERY_VERIFY,
      NOTIFICATION_OUTBOX_RECOVERY_STRICT: process.env.NOTIFICATION_OUTBOX_RECOVERY_STRICT,
      MIGRATIONS_CONTINUE_ON_ERROR: process.env.MIGRATIONS_CONTINUE_ON_ERROR,
      ALLOW_DEFAULT_PROXIES: process.env.ALLOW_DEFAULT_PROXIES
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
    NOTIFICATION_OUTBOX_ENABLED: parseBooleanEnv(process.env.NOTIFICATION_OUTBOX_ENABLED),
    NOTIFICATION_OUTBOX_DRAIN_LIMIT: parseEnvNumber("NOTIFICATION_OUTBOX_DRAIN_LIMIT", 50, { min: 1, max: 1000 }),
    NOTIFICATION_OUTBOX_MAX_AGE_MS: parseEnvNumber("NOTIFICATION_OUTBOX_MAX_AGE_MS", 6 * 24 * 3600_000, { min: 3600_000, max: 7 * 24 * 3600_000 }),
    NOTIFICATION_OUTBOX_RECOVERY_VERIFY: parseBooleanEnv(process.env.NOTIFICATION_OUTBOX_RECOVERY_VERIFY),
    NOTIFICATION_OUTBOX_RECOVERY_STRICT: parseBooleanEnv(process.env.NOTIFICATION_OUTBOX_RECOVERY_STRICT),
    NOTIFICATION_OUTBOX_RECOVERY_HISTORY_LIMIT: parseEnvNumber("NOTIFICATION_OUTBOX_RECOVERY_HISTORY_LIMIT", 25, { min: 5, max: 100 }),
    NOTIFICATION_OUTBOX_SENT_TTL_HOURS: parseEnvNumber("NOTIFICATION_OUTBOX_SENT_TTL_HOURS", 24, { min: 1, max: 168 }),
    NOTIFICATION_OUTBOX_GLOBAL_ADMIN_IDS: String(process.env.NOTIFICATION_OUTBOX_GLOBAL_ADMIN_IDS || "").split(",").map(id => id.trim()).filter(Boolean),
    BOT_SENSITIVE_USER_IDS: String(process.env.BOT_SENSITIVE_USER_IDS || "").split(",").map(id => id.trim()).filter(Boolean),
    BOT_GLOBAL_ACCESS_CODE: String(process.env.BOT_GLOBAL_ACCESS_CODE || ""),
    BOT_GLOBAL_ACCESS_CODE_HASH: String(process.env.BOT_GLOBAL_ACCESS_CODE_HASH || ""),
    NOTIFICATION_HISTORY_TTL_DAYS: parseEnvNumber("NOTIFICATION_HISTORY_TTL_DAYS", 30, { min: 7, max: 180 }),
    NOTIFICATION_DEAD_LETTER_REPLAY_TTL_DAYS: parseEnvNumber("NOTIFICATION_DEAD_LETTER_REPLAY_TTL_DAYS", 7, { min: 1, max: 30 }),
    GUILD_SEEN_DISCOUNT_TTL_DAYS: parseEnvNumber("GUILD_SEEN_DISCOUNT_TTL_DAYS", 60, { min: 30, max: 365 }),
    GUILD_AUDIT_LOG_TTL_DAYS: parseEnvNumber("GUILD_AUDIT_LOG_TTL_DAYS", 180, { min: 30, max: 730 }),
    FEEDBACK_REPORT_TTL_DAYS: parseEnvNumber("FEEDBACK_REPORT_TTL_DAYS", 90, { min: 7, max: 365 }),
    MIGRATIONS_CONTINUE_ON_ERROR: parseBooleanEnv(process.env.MIGRATIONS_CONTINUE_ON_ERROR),
    ALLOW_DEFAULT_PROXIES: parseBooleanEnv(process.env.ALLOW_DEFAULT_PROXIES),
    TRUST_PROXY: parseBooleanEnv(process.env.TRUST_PROXY),
    TRUSTED_PROXY_COUNT: parseEnvNumber("TRUSTED_PROXY_COUNT", 1, { min: 0, max: 20 }),
    ADMIN_WEBHOOK_URL: process.env.ADMIN_WEBHOOK_URL || "",
    LOG_LEVEL: RAW_LOG_LEVEL,
    THREAT_REPUTATION_URL: process.env.THREAT_REPUTATION_URL || undefined,
    THREAT_REPUTATION_TOKEN: process.env.THREAT_REPUTATION_TOKEN || undefined,
    BOT_ROLE: resolveBotRole(process.env.BOT_ROLE),
    PROXY_URLS: process.env.PROXY_URLS || "",
    REDIS_URL: process.env.REDIS_URL,

    ...buildSourcesTuningEnv(parseEnvNumber),
    ...buildCycleTuningEnv(parseEnvNumber, { ONE_HOUR_MS, ONE_DAY_MS, THIRTY_DAYS_MS }),
    ...buildCacheTuningEnv(parseEnvNumber, { ONE_HOUR_MS }),

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

  return {
    env,
    isProd,
    ONE_HOUR_MS,
    ONE_DAY_MS,
    THIRTY_DAYS_MS
  };
}

function attachEnv(target: EnvContext): void {
  Object.assign(target, buildEnvFrom(target));
}

attachEnv.buildFrom = buildEnvFrom;
attachEnv.formatEnvValidationErrors = formatEnvValidationErrors;
attachEnv.makeOptionalBooleanEnv = makeOptionalBooleanEnv;

export default attachEnv;
