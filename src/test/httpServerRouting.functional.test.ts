import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { AddressInfo } from "node:net";
import { createHttpServer } from "../app/health/httpServer";
import type { RuntimeEnv } from "../types";

interface ResponseSnapshot { status: number; body: string }

async function fetchPath(port: number, path: string, extraHeaders: Record<string, string> = {}): Promise<ResponseSnapshot> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: "127.0.0.1", port, method: "GET", path, headers: extraHeaders
    }, res => {
      let body = "";
      res.on("data", chunk => { body += chunk.toString(); });
      res.on("end", () => resolve({ status: res.statusCode || 0, body }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

function startServer() {
  const deps = {
    mongoose: { connection: { readyState: 1 } },
    crypto: { timingSafeEqual: () => true },
    env: { METRICS_PUBLIC: true, METRICS_TOKEN: "", isProd: false } as RuntimeEnv,
    client: { isReady: () => true },
    metrics: {
      startedAt: Date.now(), fetchSuccess: 1, fetchFail: 0, httpRetries: 0,
      rateLimitHits: 0, cronRuns: 0, cronErrors: 0, cronSkippedDueToLock: 0,
      cronAborted: 0, cronSkippedDueToHealth: 0, httpRateLimitDrops: 0,
      outboxSent: 0, outboxRetried: 0, outboxDeadLettered: 0, outboxExpired: 0, outboxDrains: 0, outboxQueueDepth: 0,
      outboxDeliveryMsTotal: 0, outboxOldestJobAgeSeconds: 0, outboxLockAcquireFailures: 0,
      outboxRecoveryDuplicates: 0, outboxRecoveryFetches: 0, outboxRecoveryFailures: 0, outboxRecoveryMarkerMissing: 0, outboxMarkSentFailures: 0, outboxRecoveryVerifyEnabledGuilds: 0, outboxLastDrainAt: 0
    },
    commands: {
      getCacheSizes: () => ({ single: 0, dlc: 0, updatesValid: true, dealsCurrenciesValid: 0, userCooldowns: 0 })
    },
    getGuildCacheSize: () => 0,
    scrapers: { getEnrichedCacheSize: () => 0 },
    activeLocks: { size: 0 },
    rateLimiter: { check: () => true, retryAfterSeconds: 1, size: 0, prune: () => undefined },
    cronController: null
  };
  const server = createHttpServer(deps);
  return new Promise<{ server: typeof server; port: number; close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        server,
        port,
        close: () => new Promise(r => server.close(() => r()))
      });
    });
  });
}

test("/metrics with no query string returns 200", async () => {
  const { port, close } = await startServer();
  try {
    const res = await fetchPath(port, "/metrics");
    assert.equal(res.status, 200);
    assert.match(res.body, /bot_uptime_seconds/);
    assert.match(res.body, /bot_native_fallback_total\{fn="extractDateScore"\}/, "native fallback este expus per-functie (label fn), nu doar agregat");
    assert.match(res.body, /bot_native_fallback_total\{fn="classifyPatchNote"\}/, "fiecare functie inca native-primary are propria serie");
  } finally { await close(); }
});

test("/metrics?probe=1 still matches the metrics route", async () => {
  const { port, close } = await startServer();
  try {
    const res = await fetchPath(port, "/metrics?probe=1&source=prometheus");
    assert.equal(res.status, 200, "metrics cu query string trebuie sa serveasca 200 nu 404");
    assert.match(res.body, /bot_uptime_seconds/);
  } finally { await close(); }
});

test("/health with no query string returns 200 OK JSON", async () => {
  const { port, close } = await startServer();
  try {
    const res = await fetchPath(port, "/health");
    assert.equal(res.status, 200);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.status, "ok");
    assert.equal(parsed.mongo, 1);
    assert.equal(parsed.discord, "ready");
  } finally { await close(); }
});

test("/health?source=k8s and /healthz?probe=true also match", async () => {
  const { port, close } = await startServer();
  try {
    const a = await fetchPath(port, "/health?source=k8s");
    assert.equal(a.status, 200, "/health cu query string trebuie sa raspunda OK");
    const aBody = JSON.parse(a.body);
    assert.equal(aBody.status, "ok");

    const b = await fetchPath(port, "/healthz?probe=true&token=xyz");
    assert.equal(b.status, 200, "/healthz cu query string trebuie sa raspunda OK");
  } finally { await close(); }
});

test("unknown path returns 404 even with query string", async () => {
  const { port, close } = await startServer();
  try {
    const res = await fetchPath(port, "/admin?token=hax");
    assert.equal(res.status, 404);
    assert.match(res.body, /Not Found/);
  } finally { await close(); }
});

test("malformed URL returns 404 (no crash)", async () => {

  const { port, close } = await startServer();
  try {
    const res = await fetchPath(port, "/%E0%A4%A");

    assert.ok(res.status >= 400 && res.status < 500, `expected 4xx, got ${res.status}`);
  } finally { await close(); }
});
