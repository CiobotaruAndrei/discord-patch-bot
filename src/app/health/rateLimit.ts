import type { RuntimeEnv } from "../../config/runtimeEnvTypes.js";
import type { HttpServerMetricRecorder } from "../../shared/metricRecorderPorts.js";
import type { RateLimitBucket, RateLimiter, RateLimitRequest } from "./rateLimitTypes.js";

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

function createRateLimiter(env: RuntimeEnv, metrics: HttpServerMetricRecorder): RateLimiter {
  const cap = env.HTTP_RATE_LIMIT_REQ;
  const windowMs = env.HTTP_RATE_LIMIT_WINDOW_MS;
  const refillPerMs = cap / windowMs;
  const mapMax = 1000;
  const trustProxy = env.TRUST_PROXY === true;
  const trustedProxyCount = Math.max(0, Math.trunc(env.TRUSTED_PROXY_COUNT || 0));
  const buckets = new Map<string, RateLimitBucket>();

  function getClientIp(req: RateLimitRequest): string {
    if (trustProxy && trustedProxyCount > 0) {
      const forwardedFor = firstHeaderValue(req.headers["x-forwarded-for"]);
      if (forwardedFor) {
        const segments = forwardedFor.split(",").map(s => s.trim()).filter(Boolean);
        const clientIndex = segments.length - trustedProxyCount;
        if (clientIndex >= 0 && clientIndex < segments.length && segments[clientIndex]) {
          return segments[clientIndex];
        }
      }
    }
    return req.socket?.remoteAddress || "unknown";
  }

  function prune(): void {
    const now = Date.now();
    for (const [ip, entry] of buckets.entries()) {
      if (now - entry.lastRefill > windowMs * 2 && entry.tokens >= cap * 0.95) buckets.delete(ip);
    }
    if (buckets.size > mapMax) {
      let excess = buckets.size - mapMax;

      for (const [ip, entry] of buckets.entries()) {
        if (excess <= 0) break;
        if (entry.tokens >= cap) { buckets.delete(ip); excess--; }
      }
      if (excess > 0) {
        for (const key of buckets.keys()) {
          if (excess <= 0) break;
          buckets.delete(key);
          excess--;
        }
      }
    }
  }

  function check(req: RateLimitRequest): boolean {
    const ip = getClientIp(req);
    const now = Date.now();
    let entry = buckets.get(ip);
    if (!entry) {
      entry = { tokens: cap, lastRefill: now };
      buckets.set(ip, entry);
    } else {
      const elapsed = now - entry.lastRefill;
      if (elapsed > 0) {
        entry.tokens = Math.min(cap, entry.tokens + elapsed * refillPerMs);
        entry.lastRefill = now;
      }
      buckets.delete(ip);
      buckets.set(ip, entry);
    }
    if (buckets.size > mapMax) prune();
    if (entry.tokens < 1) {
      metrics.rateLimitDropped();
      return false;
    }
    entry.tokens -= 1;
    return true;
  }

  return {
    check,
    prune,
    get size() { return buckets.size; },
    retryAfterSeconds: Math.ceil(windowMs / 1000)
  };
}

export { createRateLimiter, firstHeaderValue };
export type { RateLimiter };
