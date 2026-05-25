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
  // V11 regression: parseInt("60s", 10) === 60 — the old code accepted any
  // prefix-numeric string as seconds. The new strict `/^\d+$/` guard rejects
  // anything with non-digit suffixes so we don't misinterpret malformed
  // headers as a tiny wait time.
  const { ctx } = createHttpClientTestContext();
  assert.equal(ctx.parseRetryAfter("60"), 60_000);
  assert.equal(ctx.parseRetryAfter(" 120 "), 120_000);
  // V12: `Retry-After: 0` is valid per RFC 7231 (delta-seconds=0 means "retry
  // immediately"). Previously we treated 0 as invalid and fell back to
  // exponential backoff jitter, which actually contradicted the server's
  // explicit instruction. Now we honor it and let waitMs=0 flow through
  // (setTimeout(res, 0) -> retry next tick).
  assert.equal(ctx.parseRetryAfter("0"), 0, "0 seconds is RFC-valid (retry immediately)");
  assert.equal(ctx.parseRetryAfter("60s"), null, "unitless `s` suffix must be rejected, not silently truncated");
  assert.equal(ctx.parseRetryAfter("-30"), null);
  assert.equal(ctx.parseRetryAfter(""), null);
  assert.equal(ctx.parseRetryAfter(null), null);
  assert.equal(ctx.parseRetryAfter(undefined), null);
});

test("parseRetryAfter accepts HTTP-date format per RFC 7231", () => {
  // V11 regression: HTTP-date Retry-After values used to be silently dropped
  // (parseInt of "Wed, 21 Oct 2025 ..." is NaN). Now we Date.parse them and
  // compute the delta from now. A date in the past returns null (no wait),
  // a future date returns the positive delta in ms.
  const { ctx } = createHttpClientTestContext();
  const now = 1_700_000_000_000;
  const futureMs = now + 45_000;
  const future = new Date(futureMs).toUTCString();
  const past = new Date(now - 60_000).toUTCString();

  const parsed = ctx.parseRetryAfter(future, now) as number | null;
  assert.equal(typeof parsed, "number", "future HTTP-date must yield a numeric delta");
  // Allow small skew from toUTCString() truncating sub-second precision.
  assert.ok(parsed! >= 44_000 && parsed! <= 45_000,
    `expected ~45_000ms delta for future Retry-After, got ${parsed}`);

  assert.equal(ctx.parseRetryAfter(past, now), null,
    "past HTTP-date must return null (server's deadline already elapsed)");

  // V12: HTTP-date egal cu `now` returneaza 0 (delta=0), simetric cu accepter-ul
  // pentru `Retry-After: 0` in delta-seconds. Inainte conditia era `delta > 0`
  // → returna null pe deadline-ul exact, ceea ce parea inconsistent cu
  // path-ul de integer seconds.
  const nowExact = new Date(now).toUTCString();
  const exact = ctx.parseRetryAfter(nowExact, now) as number | null;
  assert.equal(typeof exact, "number", "HTTP-date == now must yield a numeric delta");
  assert.ok(exact! >= 0 && exact! <= 1_000,
    `expected ~0ms delta for now=now Retry-After, got ${exact}`);

  assert.equal(ctx.parseRetryAfter("not a date at all", now), null);
});

test("parseRetryAfter exposed as static helper on attachHttpClient", () => {
  // Pure helper — must be reachable without spinning up the full ctx, so
  // future modules can reuse it (e.g. for client-side Retry-After scheduling).
  assert.equal(typeof (attachHttpClient as any).parseRetryAfter, "function");
  assert.equal((attachHttpClient as any).parseRetryAfter("30"), 30_000);
});
