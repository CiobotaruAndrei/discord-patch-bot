import test from "node:test";
import assert from "node:assert/strict";
import attachHttpClient = require("../infra/http/client");

type FakeAxios = (config: { url: string; headers?: Record<string, string> }) => Promise<unknown>;
type ConditionalGet = <T>(url: string, parse: (data: unknown) => T | Promise<T>, options?: unknown) => Promise<T>;

function stubHttpClientContext<T>(stub: Record<string, unknown>): Parameters<typeof attachHttpClient>[0] & T {
  return stub as Parameters<typeof attachHttpClient>[0] & T;
}

function buildClient(axiosClient: FakeAxios) {
  const context = stubHttpClientContext<{ conditionalGet: ConditionalGet }>({
    axios: { create: () => axiosClient },
    cheerio: { load: (html: string) => ({ html }) },
    crypto: {},
    dnsLookup(hostname: string, options: unknown, callback?: unknown) {
      const cb = typeof callback === "function"
        ? callback as (err: Error | null, result: unknown, family?: number) => void
        : options as (err: Error | null, result: unknown, family?: number) => void;
      const opts = typeof callback === "function" ? options as { all?: boolean } : {};
      const address = "93.184.216.34";
      if (opts.all) cb(null, [{ address, family: 4 }]);
      else cb(null, address, 4);
    },
    logger() {},
    env: {
      FETCH_CONCURRENCY: 2, MAX_HTML_BYTES: 500_000, MAX_JSON_BYTES: 5_000_000, MAX_DEALS: 50,
      STEAM_SPECIALS_LIMIT: 30, EPIC_SPECIALS_LIMIT: 20, STEAM_REVIEW_BATCH_SIZE: 5,
      STEAM_REVIEW_BATCH_DELAY_MS: 500, INFLIGHT_PROMISE_TIMEOUT_MS: 10_000,
      CIRCUIT_BREAKER_FAIL_THRESHOLD: 5, CIRCUIT_BREAKER_COOLDOWN_MS: 60_000, CIRCUIT_BREAKER_JITTER_MS: 0,
      SCHEMA_DRIFT_THRESHOLD: 3, ENRICHED_DEAL_CACHE_TTL_MS: 60_000, ENRICHED_DEAL_CACHE_MAX_SIZE: 50,
      PROXY_URLS: "", isProd: false
    }
  });
  attachHttpClient(context);
  return { conditionalGet: context.conditionalGet };
}

test("conditionalGet: parseaza la 200, trimite validatori si reuseaza rezultatul la 304", async () => {
  let calls = 0;
  const sentHeaders: Array<Record<string, string>> = [];
  const axiosClient: FakeAxios = async (config) => {
    sentHeaders.push(config.headers || {});
    calls++;
    if (calls === 1) {
      return { status: 200, data: { v: 1 }, headers: { etag: '"abc"', "last-modified": "Wed, 21 Oct 2025 07:28:00 GMT" } };
    }
    return { status: 304, data: null, headers: {} };
  };
  const context = buildClient(axiosClient);
  let parseCount = 0;
  const parse = (data: unknown) => { parseCount++; return { id: "r", raw: data }; };
  const url = "https://example.com/feed";

  const r1 = await context.conditionalGet(url, parse);
  const r2 = await context.conditionalGet(url, parse);

  assert.equal(parseCount, 1, "parse ruleaza doar la 200, nu si la 304");
  assert.deepEqual(r1, { id: "r", raw: { v: 1 } });
  assert.deepEqual(r2, r1, "304 intoarce rezultatul cached");
  assert.equal(sentHeaders[0]["If-None-Match"], undefined, "prima cerere nu trimite validatori");
  assert.equal(sentHeaders[1]["If-None-Match"], '"abc"', "a doua cerere trimite If-None-Match");
  assert.equal(sentHeaders[1]["If-Modified-Since"], "Wed, 21 Oct 2025 07:28:00 GMT");
});

test("conditionalGet: fara validatori de la server, parseaza de fiecare data (nu cache-uieste)", async () => {
  let calls = 0;
  const sentHeaders: Array<Record<string, string>> = [];
  const axiosClient: FakeAxios = async (config) => {
    sentHeaders.push(config.headers || {});
    calls++;
    return { status: 200, data: { n: calls }, headers: {} };
  };
  const context = buildClient(axiosClient);
  let parseCount = 0;
  const parse = (data: unknown) => { parseCount++; return data; };
  const url = "https://example.com/no-etag";

  await context.conditionalGet(url, parse);
  await context.conditionalGet(url, parse);

  assert.equal(parseCount, 2, "fara etag/last-modified, parse ruleaza de fiecare data");
  assert.equal(sentHeaders[1]["If-None-Match"], undefined, "nu trimite validatori daca serverul nu a dat");
});
