import test from "node:test";
import assert from "node:assert/strict";
import attachHttpClient from "../infra/http/client";

type HttpClientRuntime = {
  env: { PROXY_URLS: string };
  assertSafeExternalUrl: (url: string) => void;
  assertSafeExternalDnsTarget: (url: string, label: string) => Promise<void>;
  httpReq: (method: string, url: string) => Promise<unknown>;
  fetchWithProxy: (url: string) => Promise<unknown>;
  parseRetryAfter: (value: unknown, now?: number) => number | null;
};
type HttpClientModule = typeof attachHttpClient & {
  createSafeDnsLookup: (lookup: DnsLookup) => DnsLookup;
  parseRetryAfter: (value: unknown, now?: number) => number | null;
  resolveDefaultProxies: (nodeEnv: string | undefined, isProd: boolean, allowFlag: string | undefined) => string[];
  assertSafeRedirect: (options: { href?: string; protocol?: string; hostname?: string; host?: string }) => void;
};
type DnsLookup = (hostname: string, options: unknown, callback?: unknown) => void;

function stubHttpClientContext<T>(stub: Record<string, unknown>): Parameters<typeof attachHttpClient.buildFrom>[0] & T {
  return stub as Parameters<typeof attachHttpClient.buildFrom>[0] & T;
}

function createHttpClientTestContext() {
  const requestedUrls: string[] = [];
  const axiosClient = async (config: { url: string }) => {
    requestedUrls.push(config.url);
    return { data: "ok" };
  };
  const context = stubHttpClientContext<HttpClientRuntime>({
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
  });
  Object.assign(context, attachHttpClient.buildFrom(context));
  return { context, requestedUrls };
}

test("HTTP client rejects unsafe external URLs", async () => {
  const { context } = createHttpClientTestContext();

  assert.throws(() => context.assertSafeExternalUrl("file:///etc/passwd"), /http sau https/);
  assert.throws(() => context.assertSafeExternalUrl("http://127.0.0.1/admin"), /locala sau privata/);
  assert.throws(() => context.assertSafeExternalUrl("http://[::1]/admin"), /locala sau privata/);
  assert.throws(() => context.assertSafeExternalUrl("http://[fd00::1]/admin"), /locala sau privata/);
  assert.throws(() => context.assertSafeExternalUrl("http://[::ffff:127.0.0.1]/admin"), /locala sau privata/);
  assert.throws(() => context.assertSafeExternalUrl("https://user:pass@example.com/"), /credentiale/);
  await assert.rejects(() => context.httpReq("GET", "http://localhost/metrics"), /locala sau privata/);
});

test("HTTP client rejects hostnames that resolve to private IP addresses", async () => {
  const { context } = createHttpClientTestContext();

  await assert.rejects(
    () => context.assertSafeExternalDnsTarget("https://private.example/path", "HTTP URL"),
    /rezolva DNS catre o adresa locala sau privata/
  );
  await assert.rejects(
    () => context.httpReq("GET", "https://private.example/path"),
    /rezolva DNS catre o adresa locala sau privata/
  );
});

test("agent DNS lookup rejects rebinding to private IP addresses", async () => {
  const httpClientModule = attachHttpClient as HttpClientModule;
  const guardedLookup = httpClientModule.createSafeDnsLookup(
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
  const { context, requestedUrls } = createHttpClientTestContext();

  await assert.rejects(() => context.fetchWithProxy("http://192.168.1.10/private"), /locala sau privata/);
  const body = await context.fetchWithProxy("https://example.com/patch notes?q=a b");

  assert.equal(body, "ok");
  assert.equal(requestedUrls.length, 1);
  assert.equal(requestedUrls[0], "https://proxy.example/fetch?url=https%3A%2F%2Fexample.com%2Fpatch%2520notes%3Fq%3Da%2520b");
});

test("proxy templates must include the target placeholder", () => {
  assert.throws(() => {
    const { context } = createHttpClientTestContext();
    context.env.PROXY_URLS = "https://proxy.example/fetch";
    Object.assign(context, attachHttpClient.buildFrom(context));
  }, /placeholder-ul \{url\}/);
});

test("parseRetryAfter accepts integer seconds and rejects unitless garbage", () => {
  const { context } = createHttpClientTestContext();
  assert.equal(context.parseRetryAfter("60"), 60_000);
  assert.equal(context.parseRetryAfter(" 120 "), 120_000);
  assert.equal(context.parseRetryAfter("0"), 0, "0 seconds is RFC-valid (retry immediately)");
  assert.equal(context.parseRetryAfter("60s"), null, "unitless `s` suffix must be rejected, not silently truncated");
  assert.equal(context.parseRetryAfter("-30"), null);
  assert.equal(context.parseRetryAfter(""), null);
  assert.equal(context.parseRetryAfter(null), null);
  assert.equal(context.parseRetryAfter(undefined), null);
});

test("parseRetryAfter accepts HTTP-date format per RFC 7231", () => {
  const { context } = createHttpClientTestContext();
  const now = 1_700_000_000_000;
  const futureMs = now + 45_000;
  const future = new Date(futureMs).toUTCString();
  const past = new Date(now - 60_000).toUTCString();

  const parsed = context.parseRetryAfter(future, now) as number | null;
  assert.equal(typeof parsed, "number", "future HTTP-date must yield a numeric delta");

  assert.ok(parsed! >= 44_000 && parsed! <= 45_000,
    `expected ~45_000ms delta for future Retry-After, got ${parsed}`);

  assert.equal(context.parseRetryAfter(past, now), null,
    "past HTTP-date must return null (server's deadline already elapsed)");

  const nowExact = new Date(now).toUTCString();
  const exact = context.parseRetryAfter(nowExact, now) as number | null;
  assert.equal(typeof exact, "number", "HTTP-date == now must yield a numeric delta");
  assert.ok(exact! >= 0 && exact! <= 1_000,
    `expected ~0ms delta for now=now Retry-After, got ${exact}`);

  assert.equal(context.parseRetryAfter("not a date at all", now), null);
});

test("parseRetryAfter exposed as static helper on attachHttpClient", () => {

  const httpClientModule = attachHttpClient as HttpClientModule;
  assert.equal(typeof httpClientModule.parseRetryAfter, "function");
  assert.equal(httpClientModule.parseRetryAfter("30"), 30_000);
});

test("HTTP client rejects alternative IP encodings, mapped IPv6 si trailing-dot", () => {
  const { context } = createHttpClientTestContext();
  assert.throws(() => context.assertSafeExternalUrl("http://2130706433/admin"), /locala sau privata/, "IPv4 decimal (127.0.0.1) blocat la nivel URL");
  assert.throws(() => context.assertSafeExternalUrl("http://0x7f000001/admin"), /locala sau privata/, "IPv4 hex blocat");
  assert.throws(() => context.assertSafeExternalUrl("http://017700000001/admin"), /locala sau privata/, "forma pur numerica (octal-like) blocata");
  assert.throws(() => context.assertSafeExternalUrl("http://localhost./admin"), /locala sau privata/, "hostname cu punct final normalizat");
  assert.throws(() => context.assertSafeExternalUrl("http://[::ffff:10.0.0.1]/x"), /locala sau privata/, "IPv6 mapped catre IPv4 privat blocat");
  assert.throws(() => context.assertSafeExternalUrl("http://[fe80::1]/x"), /locala sau privata/, "IPv6 link-local blocat");
});

test("HTTP client: redirect/rebinding catre IP privat e prins la nivel DNS (orice forma rezolvata privat)", async () => {
  const httpClientModule = attachHttpClient as HttpClientModule;
  const guardedLookup = httpClientModule.createSafeDnsLookup(
    (hostname: string, options: unknown, callback?: unknown) => {
      const cb = typeof callback === "function"
        ? callback as (err: Error | null, result: unknown, family?: number) => void
        : options as (err: Error | null, result: unknown, family?: number) => void;
      cb(null, [{ address: "169.254.169.254", family: 4 }]);
    }
  );
  await new Promise<void>((resolve, reject) => {
    guardedLookup("metadata.evil.example", { all: true }, (err: Error | null) => {
      try { assert.match(String(err?.message || ""), /adresa locala sau privata/); resolve(); }
      catch (e) { reject(e); }
    });
  });
});

test("resolveDefaultProxies: proxy-uri implicite doar in dev sau cu opt-in explicit, niciodata in prod", () => {
  const mod = attachHttpClient as HttpClientModule;
  assert.deepEqual(mod.resolveDefaultProxies("production", true, "true"), [], "in prod niciodata default-uri, nici cu flag");
  assert.equal(mod.resolveDefaultProxies("development", false, undefined).length, 2, "dev local pastreaza default-urile");
  assert.deepEqual(mod.resolveDefaultProxies("staging", false, undefined), [], "staging fara flag -> fara proxy third-party (anti-leak)");
  assert.equal(mod.resolveDefaultProxies("staging", false, "true").length, 2, "staging cu ALLOW_DEFAULT_PROXIES=true -> opt-in explicit");
  assert.deepEqual(mod.resolveDefaultProxies("test", false, undefined), [], "test fara flag -> fara default-uri");
});

test("HTTP client: assertSafeRedirect blocheaza redirect-uri catre tinte private/non-http (garda beforeRedirect)", () => {
  const mod = attachHttpClient as HttpClientModule;
  assert.throws(() => mod.assertSafeRedirect({ href: "http://127.0.0.1/admin" }), /locala sau privata/, "redirect catre loopback blocat");
  assert.throws(() => mod.assertSafeRedirect({ href: "http://169.254.169.254/latest/meta-data" }), /locala sau privata/, "redirect catre IMDS link-local blocat");
  assert.throws(() => mod.assertSafeRedirect({ href: "http://[::1]/x" }), /locala sau privata/, "redirect catre IPv6 loopback blocat");
  assert.throws(() => mod.assertSafeRedirect({ href: "file:///etc/passwd" }), /http sau https/, "redirect catre schema non-http blocat");
  assert.throws(() => mod.assertSafeRedirect({ href: "http://2130706433/x" }), /locala sau privata/, "redirect catre IPv4 decimal (127.0.0.1) blocat");
  assert.throws(() => mod.assertSafeRedirect({ href: "https://user:pass@example.com/" }), /credentiale/, "redirect cu credentiale blocat");
});

test("HTTP client: assertSafeRedirect permite redirect catre o tinta publica", () => {
  const mod = attachHttpClient as HttpClientModule;
  assert.doesNotThrow(() => mod.assertSafeRedirect({ href: "https://example.com/new-location" }));
  assert.doesNotThrow(() => mod.assertSafeRedirect({ protocol: "https:", host: "example.com" }));
});
