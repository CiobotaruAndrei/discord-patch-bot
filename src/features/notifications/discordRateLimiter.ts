export interface DiscordRateLimiter {
  acquire(): Promise<void>;
}

export interface DiscordRateLimiterOptions {
  capacity: number;
  refillPerInterval: number;
  intervalMs: number;
  maxWaitMs: number;
  maxQueue?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export type RateLimitRejection = "deadline" | "queue-full";

export class RateLimitWaitExceededError extends Error {
  readonly code = "RATE_LIMIT_WAIT_EXCEEDED";
  readonly reason: RateLimitRejection;
  readonly budgetMs: number;

  constructor(reason: RateLimitRejection, budgetMs: number) {
    super(reason === "queue-full"
      ? `coada limiter-ului Discord e plina; cererea nu poate fi servita in ${budgetMs}ms`
      : `limiter-ul Discord nu are token disponibil in bugetul de ${budgetMs}ms`);
    this.name = "RateLimitWaitExceededError";
    this.reason = reason;
    this.budgetMs = budgetMs;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise<void>(resolve => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer.unref === "function") timer.unref();
  });
}

const TOKEN_EPSILON = 1e-9;

export function createDiscordRateLimiter(options: DiscordRateLimiterOptions): DiscordRateLimiter {
  const capacity = Math.max(1, options.capacity);
  const refillPerInterval = Math.max(0.0001, options.refillPerInterval);
  const intervalMs = Math.max(1, options.intervalMs);
  const maxWaitMs = Math.max(0, options.maxWaitMs);
  const maxQueue = Math.max(1, Math.floor(options.maxQueue ?? Math.ceil(capacity + (refillPerInterval * maxWaitMs) / intervalMs)));
  const now = options.now || (() => Date.now());
  const sleep = options.sleep || defaultSleep;

  let tokens = capacity;
  let lastRefill = now();
  let pending = 0;
  let chain: Promise<void> = Promise.resolve();

  function refill(): void {
    const timestamp = now();
    const elapsed = timestamp - lastRefill;
    if (elapsed <= 0) return;
    tokens = Math.min(capacity, tokens + (elapsed / intervalMs) * refillPerInterval);
    lastRefill = timestamp;
  }

  async function acquireOne(deadline: number): Promise<void> {
    refill();
    if (tokens < 1 - TOKEN_EPSILON) {
      const waitMs = Math.ceil(((1 - tokens) / refillPerInterval) * intervalMs);
      if (now() + waitMs > deadline) throw new RateLimitWaitExceededError("deadline", maxWaitMs);
      await sleep(waitMs);
      refill();
      if (tokens < 1 - TOKEN_EPSILON) throw new RateLimitWaitExceededError("deadline", maxWaitMs);
    }
    tokens = Math.max(0, tokens - 1);
  }

  function acquire(): Promise<void> {
    if (pending >= maxQueue) return Promise.reject(new RateLimitWaitExceededError("queue-full", maxWaitMs));
    const deadline = now() + maxWaitMs;
    pending += 1;
    const result = chain.then(() => acquireOne(deadline)).finally(() => { pending -= 1; });
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
