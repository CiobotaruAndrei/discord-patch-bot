import type { RuntimeEnv } from "../../types";
import type { BotConfig } from "../../config/configTypes";

type Logger = (level: string, context: string, message: string, meta?: unknown) => void;
type ParseEnvNumber = (name: string, defaultValue: number, limits: { min?: number; max?: number }) => number;

export interface CronScheduleConfig {
  cronIntervalMs: number;
  lockTtlMs: number;
  heartbeatIntervalMs: number;
  cronJitterMs: number;
  cronCycleBudgetMs: number;
}

export function computeCronDelay(intervalMs: number, jitterMs: number, random: () => number = Math.random): number {
  if (jitterMs <= 0) return intervalMs;
  const offset = Math.round((random() * 2 - 1) * jitterMs);
  return Math.max(1000, intervalMs + offset);
}

export function resolveCronScheduleConfig(config: BotConfig, env: RuntimeEnv, parseEnvNumber: ParseEnvNumber, logger: Logger): CronScheduleConfig {
  const allowedIntervals = new Set([
    10 * 60 * 1000,
    15 * 60 * 1000,
    30 * 60 * 1000,
    60 * 60 * 1000
  ]);
  const configuredIntervalMinutes = config.checkIntervalMinutes;
  const configIntervalMs = typeof configuredIntervalMinutes === "number"
    && Number.isFinite(configuredIntervalMinutes)
    && configuredIntervalMinutes > 0
    ? Math.round(configuredIntervalMinutes * 60 * 1000)
    : 30 * 60 * 1000;
  const requestedIntervalMs = parseEnvNumber("CRON_INTERVAL_MS", configIntervalMs, {
    min: 10 * 60 * 1000,
    max: 60 * 60 * 1000
  });
  const cronIntervalMs = allowedIntervals.has(requestedIntervalMs) ? requestedIntervalMs : configIntervalMs;
  if (requestedIntervalMs !== cronIntervalMs) {
    logger("WARN", "CONFIG",
      `CRON_INTERVAL_MS=${requestedIntervalMs} nu este intr-o valoare suportata ` +
      `(10/15/30/60 min). Folosesc default ${configIntervalMs}.`);
  }

  const lockTtlMs = Math.max(cronIntervalMs + 60_000, 5 * 60 * 1000);
  const heartbeatIntervalMs = Math.max(15_000, Math.floor(lockTtlMs / 3));
  const cronJitterMs = parseEnvNumber("CRON_JITTER_MS", 20_000, { min: 0, max: 120_000 });
  const cronCycleBudgetMs = parseEnvNumber("CRON_CYCLE_BUDGET_MS", cronIntervalMs, { min: 0, max: lockTtlMs });

  return { cronIntervalMs, lockTtlMs, heartbeatIntervalMs, cronJitterMs, cronCycleBudgetMs };
}
