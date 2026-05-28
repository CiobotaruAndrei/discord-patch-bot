import type { IncomingMessage } from "http";
import type { BotMetrics, RateLimitBucket, RateLimiter, RuntimeEnv } from "../../types";

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

function createRateLimiter(env: RuntimeEnv, metrics: BotMetrics): RateLimiter {
  const cap = env.HTTP_RATE_LIMIT_REQ;
  const windowMs = env.HTTP_RATE_LIMIT_WINDOW_MS;
  const refillPerMs = cap / windowMs;
  const mapMax = 1000;
  const trustProxy = env.TRUST_PROXY === true;
  const buckets = new Map<string, RateLimitBucket>();

  // Only trust X-Forwarded-For when the deployment is explicitly behind a
  // reverse proxy that rewrites it. Otherwise an arbitrary client can spoof
  // the header to bypass the per-IP rate limit on /health and /metrics.
  function getClientIp(req: IncomingMessage): string {
    if (trustProxy) {
      const forwardedFor = firstHeaderValue(req.headers["x-forwarded-for"]);
      if (forwardedFor) {
        // V12: luam ultimul segment ne-gol (hop-ul cel mai apropiat = ce a
        // observat proxy-ul de incredere), nu primul. Cu un proxy care
        // APPEND-uieste (`$proxy_add_x_forwarded_for`), primul segment e
        // controlat de client si poate fi spoofat ca sa creeze bucket-uri
        // nelimitate / sa ocoleasca throttle-ul. Ultimul segment e cel scris
        // de proxy. Daca header-ul e gol / doar virgule, cadem pe socket in
        // loc de a colapsa toti clientii intr-un singur bucket "unknown".
        const segments = forwardedFor.split(",").map(s => s.trim()).filter(Boolean);
        const trustedHop = segments[segments.length - 1];
        if (trustedHop) return trustedHop;
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
      // V12: evict intai bucket-urile idle/refilled (tokens >= cap). Evacuarea
      // unui bucket plin e inofensiva — la urmatorul request clientul primeste
      // tot cap token-uri (aceeasi stare). Inainte evacuam strict in ordinea
      // insertiei, ceea ce putea sterge un bucket de client throttle-uit (aproape
      // de 0 token-uri) inaintea unuia idle — pierzand starea de throttle a unui
      // potential atacator si dropand un client legitim inactiv. Doar daca nu
      // raman destule bucket-uri idle cadem pe ordinea de insertie (LRU-ish).
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

  function check(req: IncomingMessage): boolean {
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

export { createRateLimiter, firstHeaderValue };
export type { RateLimiter };
