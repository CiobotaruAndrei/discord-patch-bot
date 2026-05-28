import test from "node:test";
import assert from "node:assert/strict";
import attachHttpClient = require("../infra/http/client");

function createHttpClientTestContext() {
  const requestedUrls: string[] = [];
  const axiosClient = async (config: { url: string }) => {
    requestedUrls.push(config.url);
    return { data: "ok" };
  };
  const ctx: any = {
    axios: { create: () => axiosClient },
    cheerio: { load: (html: string) => ({ html }) },
    crypto: {},
    dnsLookup(hostname: string, options: unknown, callback?: unknown) {
      const cb = typeof callback === "function"
        ? callback as (err: Error | null, result: unknown, family?: number) => void
        : options as (err: Error | null, result: unknown, family?: number) => void;
      const opts = typeof callback === "function" ? options as { all?: boolean } : {};
      const address = hostname === "private.example" ? "127.0.0.1" : "93.184.216.34";
      if (opts.all) cb(null, [{ address, family: 4 }]);
      else cb(null, address, 4);
    },
    logger() {},
    env: {
      FETCH_CONCURRENCY: 2,
      MAX_HTML_BYTES: 500_000,
      MAX_JSON_BYTES: 5_000_000,
      MAX_DEALS: 50,
      STEAM_SPECIALS_LIMIT: 30,
      EPIC_SPECIALS_LIMIT: 20,
      STEAM_REVIEW_BATCH_SIZE: 5,
      STEAM_REVIEW_BATCH_DELAY_MS: 500,
      INFLIGHT_PROMISE_TIMEOUT_MS: 10_000,
      CIRCUIT_BREAKER_FAIL_THRESHOLD: 5,
      CIRCUIT_BREAKER_COOLDOWN_MS: 60_000,
      CIRCUIT_BREAKER_JITTER_MS: 0,
      SCHEMA_DRIFT_THRESHOLD: 3,
      ENRICHED_DEAL_CACHE_TTL_MS: 60_000,
      ENRICHED_DEAL_CACHE_MAX_SIZE: 50,
      PROXY_URLS: "https://proxy.example/fetch?url={url}",
      isProd: false
    }
  };
  attachHttpClient(ctx);
  return { ctx, requestedUrls };
}

test("HTTP client rejects unsafe external URLs", async () => {
  const { ctx } = createHttpClientTestContext();

  assert.throws(() => ctx.assertSafeExternalUrl("file:///etc/passwd"), /http sau https/);
  assert.throws(() => ctx.assertSafeExternalUrl("http://127.0.0.1/admin"), /locala sau privata/);
  assert.throws(() => ctx.assertSafeExternalUrl("http://[::1]/admin"), /locala sau privata/);
  assert.throws(() => ctx.assertSafeExternalUrl("http://[fd00::1]/admin"), /locala sau privata/);
  assert.throws(() => ctx.assertSafeExternalUrl("http://[::ffff:127.0.0.1]/admin"), /locala sau privata/);
  assert.throws(() => ctx.assertSafeExternalUrl("https://user:pass@example.com/"), /credentiale/);
  await assert.rejects(() => ctx.httpReq("GET", "http://localhost/metrics"), /locala sau privata/);
});

test("HTTP client rejects hostnames that resolve to private IP addresses", async () => {
  const { ctx } = createHttpClientTestContext();

  await assert.rejects(
    () => ctx.assertSafeExternalDnsTarget("https://private.example/path", "HTTP URL"),
    /rezolva DNS catre o adresa locala sau privata/
  );
  await assert.rejects(
    () => ctx.httpReq("GET", "https://private.example/path"),
    /rezolva DNS catre o adresa locala sau privata/
  );
});

test("agent DNS lookup rejects rebinding to private IP addresses", async () => {
  const guardedLookup = (attachHttpClient as any).createSafeDnsLookup(
    (hostname: string, options: unknown, callback?: unknown) => {
      const cb = typeof callback === "function"
        ? callback as (err: Error | null, result: unknown, family?: number) => void
        : options as (err: Error | null, result: unknown, family?: number) => void;
      cb(null, hostname === "private.example" ? "10.0.0.8" : "93.184.216.34", 4);
    }
  );

  await new Promise<void>((resolve, reject) => {
    guardedLookup("private.example", {}, (err: Error | null) => {
      try {
        assert.match(String(err?.message || ""), /adresa locala sau privata/);
        resolve();
      } catch (assertErr) {
        reject(assertErr);
      }
    });
  });
});

test("proxy fallback validates and encodes target URLs", async () => {
  const { ctx, requestedUrls } = createHttpClientTestContext();

  await assert.rejects(() => ctx.fetchWithProxy("http://192.168.1.10/private"), /locala sau privata/);
  const body = await ctx.fetchWithProxy("https://example.com/patch notes?q=a b");

  assert.equal(body, "ok");
  assert.equal(requestedUrls.length, 1);
  assert.equal(requestedUrls[0], "https://proxy.example/fetch?url=https%3A%2F%2Fexample.com%2Fpatch%2520notes%3Fq%3Da%2520b");
});

test("proxy templates must include the target placeholder", () => {
  assert.throws(() => {
    const { ctx } = createHttpClientTestContext();
    ctx.env.PROXY_URLS = "https://proxy.example/fetch";
    attachHttpClient(ctx);
  }, /placeholder-ul \{url\}/);
});

test("parseRetryAfter accepts integer seconds and rejects unitless garbage", () => {
  const { ctx } = createHttpClientTestContext();
  assert.equal(ctx.parseRetryAfter("60"), 60_000);
  assert.equal(ctx.parseRetryAfter(" 120 "), 120_000);
  assert.equal(ctx.parseRetryAfter("0"), 0, "0 seconds is RFC-valid (retry immediately)");
  assert.equal(ctx.parseRetryAfter("60s"), null, "unitless `s` suffix must be rejected, not silently truncated");
  assert.equal(ctx.parseRetryAfter("-30"), null);
  assert.equal(ctx.parseRetryAfter(""), null);
  assert.equal(ctx.parseRetryAfter(null), null);
  assert.equal(ctx.parseRetryAfter(undefined), null);
});

test("parseRetryAfter accepts HTTP-date format per RFC 7231", () => {
  const { ctx } = createHttpClientTestContext();
  const now = 1_700_000_000_000;
  const futureMs = now + 45_000;
  const future = new Date(futureMs).toUTCString();
  const past = new Date(now - 60_000).toUTCString();

  const parsed = ctx.parseRetryAfter(future, now) as number | null;
  assert.equal(typeof parsed, "number", "future HTTP-date must yield a numeric delta");

  assert.ok(parsed! >= 44_000 && parsed! <= 45_000,
    `expected ~45_000ms delta for future Retry-After, got ${parsed}`);

  assert.equal(ctx.parseRetryAfter(past, now), null,
    "past HTTP-date must return null (server's deadline already elapsed)");

  const nowExact = new Date(now).toUTCString();
  const exact = ctx.parseRetryAfter(nowExact, now) as number | null;
  assert.equal(typeof exact, "number", "HTTP-date == now must yield a numeric delta");
  assert.ok(exact! >= 0 && exact! <= 1_000,
    `expected ~0ms delta for now=now Retry-After, got ${exact}`);

  assert.equal(ctx.parseRetryAfter("not a date at all", now), null);
});

test("parseRetryAfter exposed as static helper on attachHttpClient", () => {

  assert.equal(typeof (attachHttpClient as any).parseRetryAfter, "function");
  assert.equal((attachHttpClient as any).parseRetryAfter("30"), 30_000);
});
