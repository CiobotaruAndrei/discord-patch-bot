import type { BotMetrics } from "../../types";

type HttpMetricsRef = Pick<BotMetrics, "fetchSuccess" | "fetchFail" | "httpRetries" | "rateLimitHits">;

function createInitialHttpMetrics(): HttpMetricsRef {
  return { fetchSuccess: 0, fetchFail: 0, httpRetries: 0, rateLimitHits: 0 };
}

export { createInitialHttpMetrics };
export type { HttpMetricsRef };
