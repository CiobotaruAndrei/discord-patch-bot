import type { RuntimeEnv } from "../../types.js";
import type { CronHealthSnapshot } from "./schedulerTypes.js";

type Logger = (level: string, context: string, message: string, meta?: unknown) => void;

interface HealthEntry {
  success: boolean;
  durationMs: number;
}

export function createCronHealthWindow(env: RuntimeEnv, logger: Logger) {
  const healthWindow: HealthEntry[] = [];
  let healthSkipScheduled = false;

  function recordHealth(success: boolean, durationMs: number): void {
    healthWindow.push({ success, durationMs });
    if (healthWindow.length > env.GLOBAL_HEALTH_WINDOW) healthWindow.shift();
  }

  function shouldSkipForGlobalHealth(): boolean {
    if (healthSkipScheduled) {
      healthSkipScheduled = false;
      healthWindow.length = 0;
      return false;
    }
    if (healthWindow.length < env.GLOBAL_HEALTH_WINDOW) return false;
    const successCount = healthWindow.filter(entry => entry.success).length;
    const ratio = (successCount / healthWindow.length) * 100;
    if (ratio < env.GLOBAL_HEALTH_MIN_RATIO) {
      healthSkipScheduled = true;
      logger("WARN", "CRON_HEALTH",
        `Global health rate ${ratio.toFixed(0)}% < ${env.GLOBAL_HEALTH_MIN_RATIO}% in ultimele ${healthWindow.length} cicluri. ` +
        "Sar ciclul curent pentru backoff.");
      return true;
    }
    return false;
  }

  function getHealthSnapshot(): CronHealthSnapshot {
    if (!healthWindow.length) {
      return { successRatio: null, windowSize: 0, healthSkipScheduled };
    }
    const successCount = healthWindow.filter(entry => entry.success).length;
    const totalDurationMs = healthWindow.reduce((sum, entry) => sum + entry.durationMs, 0);
    return {
      successRatio: Math.round((successCount / healthWindow.length) * 100),
      windowSize: healthWindow.length,
      healthSkipScheduled,
      avgDurationMs: Math.round(totalDurationMs / healthWindow.length)
    };
  }

  return { recordHealth, shouldSkipForGlobalHealth, getHealthSnapshot };
}
