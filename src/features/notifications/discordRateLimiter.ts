export interface DiscordRateLimiter {
  acquire(): Promise<void>;
}

export interface DiscordRateLimiterOptions {
  capacity: number;
  refillPerInterval: number;
  intervalMs: number;
  maxWaitMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise<void>(resolve => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer.unref === "function") timer.unref();
  });
}

export function createDiscordRateLimiter(options: DiscordRateLimiterOptions): DiscordRateLimiter {
  const capacity = Math.max(1, options.capacity);
  const refillPerInterval = Math.max(0.0001, options.refillPerInterval);
  const intervalMs = Math.max(1, options.intervalMs);
  const maxWaitMs = Math.max(0, options.maxWaitMs);
  const now = options.now || (() => Date.now());
  const sleep = options.sleep || defaultSleep;

  let tokens = capacity;
  let lastRefill = now();
  let chain: Promise<void> = Promise.resolve();

  function refill(): void {
    const timestamp = now();
    const elapsed = timestamp - lastRefill;
    if (elapsed <= 0) return;
    tokens = Math.min(capacity, tokens + (elapsed / intervalMs) * refillPerInterval);
    lastRefill = timestamp;
  }

  async function acquireOne(): Promise<void> {
    refill();
    if (tokens >= 1) {
      tokens -= 1;
      return;
    }
    const deficit = 1 - tokens;
    const waitMs = Math.min(maxWaitMs, Math.ceil((deficit / refillPerInterval) * intervalMs));
    if (waitMs > 0) await sleep(waitMs);
    refill();
    tokens = Math.max(0, tokens - 1);
  }

  function acquire(): Promise<void> {
    const result = chain.then(acquireOne);
    chain = result.catch(() => undefined);
    return result;
  }

  return { acquire };
}

function envInt(name: string, fallback: number): number {
  const parsed = parseInt(String(process.env[name] || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const defaultDiscordSendLimiter: DiscordRateLimiter = createDiscordRateLimiter({
  capacity: envInt("DISCORD_SEND_RATE_CAPACITY", 5),
  refillPerInterval: envInt("DISCORD_SEND_RATE_PER_SEC", 5),
  intervalMs: 1000,
  maxWaitMs: envInt("DISCORD_SEND_RATE_MAX_WAIT_MS", 5000)
});
