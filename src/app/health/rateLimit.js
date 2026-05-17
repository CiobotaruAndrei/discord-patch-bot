// @ts-check
"use strict";

/** @typedef {import("../../types").RateLimitBucket} RateLimitBucket */

function createRateLimiter(env, metrics) {
  const cap = env.HTTP_RATE_LIMIT_REQ;
  const windowMs = env.HTTP_RATE_LIMIT_WINDOW_MS;
  const refillPerMs = cap / windowMs;
  const mapMax = 1000;
  /** @type {Map<string, RateLimitBucket>} */
  const buckets = new Map();

  function getClientIp(req) {
    const fwd = req.headers["x-forwarded-for"];
    if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0].trim();
    return req.socket?.remoteAddress || "unknown";
  }

  function prune() {
    const now = Date.now();
    for (const [ip, entry] of buckets.entries()) {
      if (now - entry.lastRefill > windowMs * 2 && entry.tokens >= cap * 0.95) buckets.delete(ip);
    }
    if (buckets.size > mapMax) {
      const excess = buckets.size - mapMax;
      let deleted = 0;
      for (const key of buckets.keys()) {
        buckets.delete(key);
        if (++deleted >= excess) break;
      }
    }
  }

  function check(req) {
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
      metrics.httpRateLimitDrops++;
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

module.exports = { createRateLimiter };
