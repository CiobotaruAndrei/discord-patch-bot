type HttpMetricsRef = { fetchSuccess: number; fetchFail: number; httpRetries: number; rateLimitHits: number };

function createInitialHttpMetrics(): HttpMetricsRef {
  return { fetchSuccess: 0, fetchFail: 0, httpRetries: 0, rateLimitHits: 0 };
}

export { createInitialHttpMetrics };
export type { HttpMetricsRef };
