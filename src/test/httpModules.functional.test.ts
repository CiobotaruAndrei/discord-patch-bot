import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
import test from "node:test";
import assert from "node:assert/strict";

const retryPolicy = require("../infra/http/retryPolicy") as {
  RETRY_ABLE_4XX: Set<number>;
  parseRetryAfter: (raw: unknown, nowMs?: number) => number | null;
  classifyHttpFailure: (status: number | string, isIdempotent: boolean) => {
    isRateLimit: boolean; isRetryable4xx: boolean; is5xx: boolean; isNetworkErr: boolean; isFatalClient: boolean; shouldRetry: boolean;
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

test("classifyHttpFailure: shouldRetry reincearca 5xx/retea doar pentru cereri idempotente (GET)", () => {
  const idem5xx = retryPolicy.classifyHttpFailure(503, true);
  assert.equal(idem5xx.shouldRetry, true, "GET pe 5xx se reincearca");
  const nonIdem5xx = retryPolicy.classifyHttpFailure(503, false);
  assert.equal(nonIdem5xx.shouldRetry, false, "non-GET pe 5xx NU se reincearca (poate fi procesat deja -> duplicat)");

  const idemNet = retryPolicy.classifyHttpFailure("N/A", true);
  assert.equal(idemNet.shouldRetry, true, "GET pe eroare de retea se reincearca");
  const nonIdemNet = retryPolicy.classifyHttpFailure("N/A", false);
  assert.equal(nonIdemNet.shouldRetry, false, "non-GET pe eroare de retea NU se reincearca (livrarea poate fi ajuns la server)");

  const rlIdem = retryPolicy.classifyHttpFailure(429, true);
  const rlNonIdem = retryPolicy.classifyHttpFailure(429, false);
  assert.equal(rlIdem.shouldRetry, true, "429 idempotent se reincearca");
  assert.equal(rlNonIdem.shouldRetry, true, "429 se reincearca si non-idempotent: serverul a respins explicit, nu a procesat");

  const fatal = retryPolicy.classifyHttpFailure(404, true);
  assert.equal(fatal.shouldRetry, false, "404 nu se reincearca niciodata");
  const timeoutNonIdem = retryPolicy.classifyHttpFailure(408, false);
  assert.equal(timeoutNonIdem.shouldRetry, false, "408 non-idempotent nu se reincearca");
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

import { createInflightTracker } from "../infra/http/inflightTracker.js";
import { createProxyClient } from "../infra/http/proxyClient.js";
import { createContentNormalization } from "../infra/http/contentNormalization.js";
import * as cheerioModule from "cheerio";

test("inflightTracker: timeout-ul respinge promisiunile blocate si curata timerul la settle (R[Arh] #8)", async () => {
  const tracker = createInflightTracker(15);
  await assert.rejects(
    () => tracker.withInflightTimeout(new Promise(() => undefined), "blocat"),
    /Inflight timeout \(blocat\)/
  );
  assert.equal(await tracker.withInflightTimeout(Promise.resolve("ok"), "rapid"), "ok");
});

test("inflightTracker: trackInflight curata cheia din map la resolve si la reject, dar nu sterge o promisiune inlocuita", async () => {
  const tracker = createInflightTracker(1000);
  const map = new Map<string, Promise<string>>();
  const first = Promise.resolve("primul");
  tracker.trackInflight(map, "k", first);
  const second = Promise.reject(new Error("al doilea pica")).catch(() => "recuperat") as Promise<string>;
  tracker.trackInflight(map, "k", second);
  await first;
  await second;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(map.has("k"), false, "dupa settle-ul ambelor, cheia e curatata (cleanup-ul primului nu sterge inlocuitorul inainte de settle-ul lui)");
});

test("proxyClient: itereaza template-urile la esec, extrage contents pentru allorigins si raporteaza epuizarea (R[Arh] #8)", async () => {
  const calls: string[] = [];
  const client = createProxyClient({
    proxyTemplates: ["https://p1.example/{url}", "https://api.allorigins.win/get?url={url}"],
    httpReq: async (_method, url) => {
      calls.push(url);
      if (url.startsWith("https://p1")) throw new Error("proxy 1 picat");
      return { data: { contents: "<html>ok</html>" } } as Awaited<ReturnType<Parameters<typeof createProxyClient>[0]["httpReq"]>>;
    },
    assertSafeTarget: async raw => raw
  });

  const body = await client.fetchWithProxy("https://target.example/pagina");
  assert.equal(body, "<html>ok</html>", "raspunsul allorigins e despachetat din .contents");
  assert.equal(calls.length, 2, "primul template picat => se trece la urmatorul");
  assert.match(calls[0], /p1\.example/);

  const empty = createProxyClient({ proxyTemplates: [], httpReq: async () => { throw new Error("nu se ajunge"); }, assertSafeTarget: async raw => raw });
  await assert.rejects(() => empty.fetchWithProxy("https://target.example"), /neconfigurat/);

  const exhausted = createProxyClient({
    proxyTemplates: ["https://p1.example/{url}"],
    httpReq: async () => { throw new Error("mereu pica"); },
    assertSafeTarget: async raw => raw
  });
  await assert.rejects(() => exhausted.fetchWithProxy("https://target.example"), /Proxy fallback epuizat: mereu pica/);
});

test("contentNormalization: normalizeUpdate genereaza id stabil cand lipseste si trunchiaza campurile lungi (R[Arh] #8)", () => {
  const normalization = createContentNormalization({ cheerio: cheerioModule, maxHtmlBytes: 1024 });
  const update = normalization.normalizeUpdate({
    id: "",
    title: "T".repeat(300),
    link: "https://example.com/patch",
    excerpt: "E".repeat(800),
    fullText: "F".repeat(4000),
    image: null,
    thumbnail: null,
    timestamp: ""
  });
  assert.equal(update.id, normalization.stableUpdateId("T".repeat(300), "https://example.com/patch"), "id-ul lipsa e derivat stabil din titlu+link");
  assert.equal(update.title.length, 250);
  assert.equal(update.excerpt.length, 700);
  assert.equal(update.fullText.length, 3500);
});

test("contentNormalization: safeCheerioLoad taie HTML-ul urias la limita de bytes fara sa rupa un caracter multibyte", () => {
  const normalization = createContentNormalization({ cheerio: cheerioModule, maxHtmlBytes: 64 });
  const html = `<p>${"ă".repeat(200)}</p>`;
  const $ = normalization.safeCheerioLoad(html);
  const text = $("p").text();
  assert.ok(text.length > 0 && text.length < 200, "continutul e taiat la limita");
  assert.doesNotMatch(text, /�/, "taierea nu produce caractere invalide (nu rupe secvente utf8)");
});
