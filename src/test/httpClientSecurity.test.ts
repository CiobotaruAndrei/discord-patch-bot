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
  assert.throws(() => ctx.assertSafeExternalUrl("https://user:pass@example.com/"), /credentiale/);
  await assert.rejects(() => ctx.httpReq("GET", "http://localhost/metrics"), /locala sau privata/);
});

test("proxy fallback validates and encodes target URLs", async () => {
  const { ctx, requestedUrls } = createHttpClientTestContext();

  await assert.rejects(() => ctx.fetchWithProxy("http://192.168.1.10/private"), /locala sau privata/);
  const body = await ctx.fetchWithProxy("https://example.com/patch notes?q=a b");

  assert.equal(body, "ok");
  assert.equal(requestedUrls.length, 1);
  assert.equal(requestedUrls[0], "https://proxy.example/fetch?url=https%3A%2F%2Fexample.com%2Fpatch%20notes%3Fq%3Da%20b");
});

test("proxy templates must include the target placeholder", () => {
  assert.throws(() => {
    const { ctx } = createHttpClientTestContext();
    ctx.env.PROXY_URLS = "https://proxy.example/fetch";
    attachHttpClient(ctx);
  }, /placeholder-ul \{url\}/);
});
