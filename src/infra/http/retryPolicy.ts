const RETRY_ABLE_4XX = new Set([408, 425, 429]);

function parseRetryAfter(raw: unknown, nowMs: number = Date.now()): number | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    const seconds = parseInt(trimmed, 10);
    if (seconds >= 0 && Number.isFinite(seconds)) return seconds * 1000;
    return null;
  }
  const asDate = Date.parse(trimmed);
  if (!isNaN(asDate)) {
    const delta = asDate - nowMs;
    if (delta >= 0) return delta;
  }
  return null;
}

interface HttpFailureClass {
  isRateLimit: boolean;
  isRetryable4xx: boolean;
  is5xx: boolean;
  isNetworkErr: boolean;
  isFatalClient: boolean;
}

function classifyHttpFailure(status: number | string, isIdempotent: boolean): HttpFailureClass {
  const isRateLimit = status === 429;
  const isRetryable4xx = isRateLimit || (isIdempotent && typeof status === "number" && RETRY_ABLE_4XX.has(status));
  const is5xx = typeof status === "number" && status >= 500;
  const isNetworkErr = typeof status !== "number";
  const isFatalClient = typeof status === "number" && status >= 400 && status < 500 && !isRetryable4xx;
  return { isRateLimit, isRetryable4xx, is5xx, isNetworkErr, isFatalClient };
}

function computeBackoffWaitMs(baseBackoffMs: number, retryAfterMs: number | null, random: () => number = Math.random): number {
  if (retryAfterMs !== null) {
    return Math.min(Math.round(retryAfterMs * (1 + random() * 0.25)), 30000);
  }
  return Math.round(baseBackoffMs * (0.5 + random()));
}

export { RETRY_ABLE_4XX, parseRetryAfter, classifyHttpFailure, computeBackoffWaitMs };
export type { HttpFailureClass };
