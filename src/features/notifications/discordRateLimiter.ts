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

interface DiscordSendRateEnv {
  DISCORD_SEND_RATE_CAPACITY: number;
  DISCORD_SEND_RATE_PER_SEC: number;
  DISCORD_SEND_RATE_MAX_WAIT_MS: number;
}

interface DiscordSendRateTimers {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export function createDefaultDiscordSendLimiter(env: DiscordSendRateEnv, timers?: DiscordSendRateTimers): DiscordRateLimiter {
  return createDiscordRateLimiter({
    capacity: env.DISCORD_SEND_RATE_CAPACITY,
    refillPerInterval: env.DISCORD_SEND_RATE_PER_SEC,
    intervalMs: 1000,
    maxWaitMs: env.DISCORD_SEND_RATE_MAX_WAIT_MS,
    now: timers?.now,
    sleep: timers?.sleep
  });
}
