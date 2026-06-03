import test from "node:test";
import assert from "node:assert/strict";

const retryPolicy = require("../infra/http/retryPolicy") as {
  RETRY_ABLE_4XX: Set<number>;
  parseRetryAfter: (raw: unknown, nowMs?: number) => number | null;
  classifyHttpFailure: (status: number | string, isIdempotent: boolean) => {
    isRateLimit: boolean; isRetryable4xx: boolean; is5xx: boolean; isNetworkErr: boolean; isFatalClient: boolean;
  };
  computeBackoffWaitMs: (baseBackoffMs: number, retryAfterMs: number | null, random?: () => number) => number;
};

const conditionalCache = require("../infra/http/conditionalCache") as {
  createConditionalGet: (
    httpReq: (method: string, url: string, options?: { headers?: Record<string, string> }) => Promise<{ status?: number; data?: unknown; headers?: unknown }>,
    maxSize: number
  ) => <T>(url: string, parse: (data: unknown) => T | Promise<T>, options?: { headers?: Record<string, string> }) => Promise<T>;
};

test("classifyHttpFailure: rate-limit, 5xx, network si 4xx fatal vs retryable", () => {
  const rl = retryPolicy.classifyHttpFailure(429, true);
  assert.ok(rl.isRateLimit && rl.isRetryable4xx && !rl.isFatalClient, "429 = rate-limit retryable");

  const s5 = retryPolicy.classifyHttpFailure(503, true);
  assert.ok(s5.is5xx && !s5.isFatalClient, "5xx nu este fatal client");

  const notFound = retryPolicy.classifyHttpFailure(404, true);
  assert.ok(notFound.isFatalClient && !notFound.isRetryable4xx, "404 = fatal client (nu se reincearca)");

  const timeoutIdem = retryPolicy.classifyHttpFailure(408, true);
  assert.ok(timeoutIdem.isRetryable4xx && !timeoutIdem.isFatalClient, "408 idempotent = retryable");

  const timeoutNonIdem = retryPolicy.classifyHttpFailure(408, false);
  assert.ok(timeoutNonIdem.isFatalClient, "408 non-idempotent = fatal (nu reincercam POST/PUT pe 408)");

  const network = retryPolicy.classifyHttpFailure("N/A", true);
  assert.ok(network.isNetworkErr && !network.isFatalClient, "eroare de retea (status non-numeric) = retryable");
});

test("computeBackoffWaitMs: jitter determinist cu rng injectat + plafon 30s pe retry-after", () => {
  assert.equal(retryPolicy.computeBackoffWaitMs(1000, null, () => 0), 500, "fara retry-after, rng=0 -> base*0.5");
  assert.equal(retryPolicy.computeBackoffWaitMs(1000, null, () => 1), 1500, "fara retry-after, rng=1 -> base*1.5");
  assert.equal(retryPolicy.computeBackoffWaitMs(1000, 2000, () => 0), 2000, "cu retry-after, rng=0 -> exact retry-after");
  assert.equal(retryPolicy.computeBackoffWaitMs(1000, 2000, () => 1), 2500, "cu retry-after, rng=1 -> retry-after*1.25");
  assert.equal(retryPolicy.computeBackoffWaitMs(1000, 60000, () => 1), 30000, "retry-after mare -> plafonat la 30s");
});

test("createConditionalGet: 200 stocheaza validatori, 304 reuseaza rezultatul, parse o singura data", async () => {
  let calls = 0;
  const sentHeaders: Array<Record<string, string>> = [];
  const httpReq = async (_method: string, _url: string, options?: { headers?: Record<string, string> }) => {
    sentHeaders.push(options?.headers || {});
    calls++;
    if (calls === 1) {
      return { status: 200, data: { v: 1 }, headers: { etag: '"abc"', "last-modified": "Wed, 21 Oct 2025 07:28:00 GMT" } };
    }
    return { status: 304, data: null, headers: {} };
  };
  const conditionalGet = conditionalCache.createConditionalGet(httpReq, 500);

  let parseCount = 0;
  const parse = (data: unknown) => { parseCount++; return { id: "r", raw: data }; };
  const url = "https://example.com/feed";

  const r1 = await conditionalGet(url, parse);
  const r2 = await conditionalGet(url, parse);

  assert.equal(parseCount, 1, "parse ruleaza doar la 200, nu si la 304");
  assert.deepEqual(r1, { id: "r", raw: { v: 1 } });
  assert.deepEqual(r2, r1, "304 intoarce rezultatul cached");
  assert.equal(sentHeaders[0]["If-None-Match"], undefined, "prima cerere fara validatori");
  assert.equal(sentHeaders[1]["If-None-Match"], '"abc"', "a doua cerere trimite If-None-Match");
  assert.equal(sentHeaders[1]["If-Modified-Since"], "Wed, 21 Oct 2025 07:28:00 GMT");
});

test("createConditionalGet: evictie LRU la depasirea maxSize (intrarea cea mai veche e evinsa)", async () => {
  const validatorByUrl: Record<string, string | undefined> = {};
  const httpReq = async (_method: string, url: string, options?: { headers?: Record<string, string> }) => {
    validatorByUrl[url] = options?.headers?.["If-None-Match"];
    return { status: 200, data: url, headers: { etag: `"${url}"` } };
  };
  const conditionalGet = conditionalCache.createConditionalGet(httpReq, 2);
  const identity = (data: unknown) => data;

  await conditionalGet("https://a.test/", identity);
  await conditionalGet("https://b.test/", identity);
  await conditionalGet("https://c.test/", identity);

  await conditionalGet("https://c.test/", identity);
  assert.equal(validatorByUrl["https://c.test/"], '"https://c.test/"', "c este inca in cache -> trimite If-None-Match");

  await conditionalGet("https://a.test/", identity);
  assert.equal(validatorByUrl["https://a.test/"], undefined, "a a fost evinsa (cea mai veche) -> niciun validator");
});
