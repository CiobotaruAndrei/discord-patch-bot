import test from "node:test";
import assert from "node:assert/strict";
import { createDiscordRateLimiter, DiscordRateLimiterOptions } from "../features/notifications/discordRateLimiter";

function harness(opts: Omit<DiscordRateLimiterOptions, "now" | "sleep">) {
  const state = { clock: 0 };
  const sleeps: number[] = [];
  const limiter = createDiscordRateLimiter({
    ...opts,
    now: () => state.clock,
    sleep: async (ms: number) => { sleeps.push(ms); state.clock += ms; }
  });
  return { limiter, sleeps, advance: (ms: number) => { state.clock += ms; } };
}

test("discord rate limiter: a burst up to capacity is served immediately", async () => {
  const { limiter, sleeps } = harness({ capacity: 3, refillPerInterval: 1, intervalMs: 1000, maxWaitMs: 10000 });
  await limiter.acquire();
  await limiter.acquire();
  await limiter.acquire();
  assert.deepEqual(sleeps, [], "primele `capacity` acquire-uri nu asteapta");
});

test("discord rate limiter: an empty bucket waits for one refill interval", async () => {
  const { limiter, sleeps } = harness({ capacity: 1, refillPerInterval: 1, intervalMs: 1000, maxWaitMs: 10000 });
  await limiter.acquire();
  await limiter.acquire();
  assert.deepEqual(sleeps, [1000], "a doua acquire asteapta o reincarcare completa");
});

test("discord rate limiter: tokens refill as time passes", async () => {
  const h = harness({ capacity: 1, refillPerInterval: 1, intervalMs: 1000, maxWaitMs: 10000 });
  await h.limiter.acquire();
  h.advance(1000);
  await h.limiter.acquire();
  assert.deepEqual(h.sleeps, [], "dupa trecerea timpului acquire este imediat");
});

test("discord rate limiter: the wait is capped at maxWaitMs (never blocks forever)", async () => {
  const { limiter, sleeps } = harness({ capacity: 1, refillPerInterval: 1, intervalMs: 100000, maxWaitMs: 500 });
  await limiter.acquire();
  await limiter.acquire();
  assert.deepEqual(sleeps, [500], "asteptarea este plafonata la maxWaitMs");
});

test("discord rate limiter: serialized acquires do not over-consume tokens", async () => {
  const { limiter, sleeps } = harness({ capacity: 2, refillPerInterval: 1, intervalMs: 1000, maxWaitMs: 10000 });
  await Promise.all([limiter.acquire(), limiter.acquire(), limiter.acquire()]);
  assert.deepEqual(sleeps, [1000], "a treia acquire concurenta tot asteapta o reincarcare");
});
