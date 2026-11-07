import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createDiscordRateLimiter, createDefaultDiscordSendLimiter, DiscordRateLimiterOptions, RateLimitWaitExceededError } from "../features/notifications/discordRateLimiter.js";

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

test("discord rate limiter: cand tokenul nu poate aparea in maxWaitMs, acquire esueaza explicit, fara sa-l acorde oricum (B04)", async () => {
  const { limiter, sleeps } = harness({ capacity: 1, refillPerInterval: 1, intervalMs: 100000, maxWaitMs: 500 });
  await limiter.acquire();
  await assert.rejects(limiter.acquire(), (err: unknown) => err instanceof RateLimitWaitExceededError && err.reason === "deadline");
  assert.deepEqual(sleeps, [], "nu doarme degeaba un buget dupa care oricum nu ar avea token");
});

test("discord rate limiter: serialized acquires do not over-consume tokens", async () => {
  const { limiter, sleeps } = harness({ capacity: 2, refillPerInterval: 1, intervalMs: 1000, maxWaitMs: 10000 });
  await Promise.all([limiter.acquire(), limiter.acquire(), limiter.acquire()]);
  assert.deepEqual(sleeps, [1000], "a treia acquire concurenta tot asteapta o reincarcare");
});

test("createDefaultDiscordSendLimiter: configureaza limiter-ul din RuntimeEnv (capacity + maxWait din env, nu process.env)", async () => {
  const state = { clock: 0 };
  const sleeps: number[] = [];
  const limiter = createDefaultDiscordSendLimiter(
    { DISCORD_SEND_RATE_CAPACITY: 2, DISCORD_SEND_RATE_PER_SEC: 5, DISCORD_SEND_RATE_MAX_WAIT_MS: 10 },
    { now: () => state.clock, sleep: async (ms: number) => { sleeps.push(ms); state.clock += ms; } }
  );
  await limiter.acquire();
  await limiter.acquire();
  assert.deepEqual(sleeps, [], "primele `capacity` (2 din env) acquire-uri nu asteapta");
  await assert.rejects(limiter.acquire(), RateLimitWaitExceededError, "bugetul din env (10ms) e mai mic decat cei 200ms pana la urmatorul token (5/s din env)");
  assert.deepEqual(sleeps, [], "fara token in buget, nu se doarme degeaba");
  state.clock += 200;
  await limiter.acquire();
  assert.deepEqual(sleeps, [], "dupa 200ms rata din env a reincarcat un token");
});

test("discordRateLimiter: fara singleton legacy si fara citire process.env (config doar prin createDefaultDiscordSendLimiter(env))", async () => {
  const mod: Record<string, unknown> = { ...await import("../features/notifications/discordRateLimiter.js") };
  assert.equal(mod.defaultDiscordSendLimiter, undefined, "singleton-ul eager defaultDiscordSendLimiter a fost eliminat (nu mai citeste process.env la import)");
  assert.equal(typeof mod.createDefaultDiscordSendLimiter, "function", "configurarea se face exclusiv prin createDefaultDiscordSendLimiter(env)");
  const source = fs.readFileSync(path.join(process.cwd(), "features", "notifications", "discordRateLimiter.ts"), "utf8");
  assert.equal(/process\.env/.test(source), false, "modulul nu mai contine nicio citire process.env");
});

test("discord rate limiter: timpul petrecut in coada intra in buget, deci nicio cerere nu asteapta peste maxWaitMs (B04)", async () => {
  const h = harness({ capacity: 1, refillPerInterval: 1, intervalMs: 100, maxWaitMs: 100, maxQueue: 10 });
  await h.limiter.acquire();
  const settled = await Promise.allSettled([h.limiter.acquire(), h.limiter.acquire(), h.limiter.acquire()]);
  assert.deepEqual(settled.map(entry => entry.status), ["fulfilled", "rejected", "rejected"]);
  assert.deepEqual(h.sleeps, [100], "doar prima cerere incape in buget; celelalte ar fi asteptat 200ms si 300ms");
  for (const entry of settled.slice(1)) {
    assert.ok(entry.status === "rejected" && entry.reason instanceof RateLimitWaitExceededError);
  }
});

test("discord rate limiter: coada e limitata la cate cereri pot fi servite in buget (B04)", async () => {
  const h = harness({ capacity: 1, refillPerInterval: 1, intervalMs: 100, maxWaitMs: 100 });
  await h.limiter.acquire();
  const first = h.limiter.acquire();
  const second = h.limiter.acquire();
  const third = h.limiter.acquire();
  await assert.rejects(third, (err: unknown) => err instanceof RateLimitWaitExceededError && err.reason === "queue-full");
  await first;
  await assert.rejects(second, RateLimitWaitExceededError);
});

test("discord rate limiter: o cerere respinsa nu consuma token si nu blocheaza urmatoarele", async () => {
  const h = harness({ capacity: 1, refillPerInterval: 1, intervalMs: 1000, maxWaitMs: 0 });
  await h.limiter.acquire();
  await assert.rejects(h.limiter.acquire(), RateLimitWaitExceededError);
  h.advance(1000);
  await h.limiter.acquire();
  assert.deepEqual(h.sleeps, []);
});

test("eroarea de limiter e tranzitorie pentru outbox, nu permanenta", async () => {
  const { isPermanentDiscordError } = await import("../features/notifications/outboundChannel.js");
  assert.equal(isPermanentDiscordError(new RateLimitWaitExceededError("deadline", 10)), false, "un job respins de limiter se reincearca, nu ajunge in dead-letter");
});

test("discord rate limiter: un timer care se trezeste tarziu nu face cereri expirate sa treaca, nici pe cele din coada (review PR #1019)", async () => {
  const state = { clock: 0 };
  let lateBy = 200;
  const limiter = createDiscordRateLimiter({
    capacity: 2,
    refillPerInterval: 1,
    intervalMs: 100,
    maxWaitMs: 100,
    now: () => state.clock,
    sleep: async (ms: number) => { state.clock += ms + lateBy; lateBy = 0; }
  });
  await limiter.acquire();
  await limiter.acquire();

  const settled = await Promise.allSettled([limiter.acquire(), limiter.acquire()]);

  assert.deepEqual(settled.map(entry => entry.status), ["rejected", "rejected"], "ambele au depasit bugetul de 100ms (ceasul e la 300ms)");
  state.clock += 100;
  await limiter.acquire();
});
