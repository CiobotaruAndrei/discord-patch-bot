import test from "node:test";
import assert from "node:assert/strict";
import * as crypto from "crypto";
import { load as cheerioLoad } from "cheerio";
import type { GameConfig } from "../../config/configTypes.js";
import type { NormalizedUpdate } from "../../sources/sourceTypes.js";
import { createUpdatesCircuitBreaker } from "../../sources/updates/updatesCircuitBreaker.js";
import { createUpdatesSourceDispatch } from "../../sources/updates/updatesSourceDispatch.js";
import type { CircuitBreakerDoc, CircuitBreakerModelLike, UpdatesDeps } from "../../sources/updates/updatesContracts.js";
import { createCircuitBreakerStore } from "../../sources/updates/circuitBreakerStore.js";

class TestSchemaDriftError extends Error {
  source?: string;
  constructor(message: string, source?: string) {
    super(message);
    this.source = source;
  }
}

function makeUpdate(id: string): NormalizedUpdate {
  return { id, title: "", link: "", excerpt: "", fullText: "", image: null, thumbnail: null, timestamp: "" };
}

function makeCbModel(initial: Partial<CircuitBreakerDoc> = {}) {
  const doc: CircuitBreakerDoc & { fails: number; schemaDriftFails: number } = { _id: "g", fails: 0, cooldownUntil: null, alertSent: false, schemaDriftFails: 0, schemaDriftAlertSent: false, ...initial };
  const updates: Array<Record<string, unknown>> = [];
  const model = Object.assign({} as CircuitBreakerModelLike, {
    findOneAndUpdate: async (_filter: unknown, update: { $inc?: Record<string, number> }) => {
      if (update.$inc?.fails) doc.fails += update.$inc.fails;
      if (update.$inc?.schemaDriftFails) doc.schemaDriftFails += update.$inc.schemaDriftFails;
      return { ...doc };
    },
    updateOne: async (_filter: unknown, update: { $set?: Record<string, unknown> }) => {
      if (update.$set) { Object.assign(doc, update.$set); updates.push(update.$set); }
      return { matchedCount: 1 };
    }
  });
  return { model, doc, updates };
}

const httpMetrics = { fetchSuccess: 0, fetchFail: 0 };

function makeDeps(cbModel: CircuitBreakerModelLike, overrides: Partial<UpdatesDeps> = {}): UpdatesDeps & { alerts: Array<{ kind: string }> } {
  httpMetrics.fetchSuccess = 0;
  httpMetrics.fetchFail = 0;
  const alerts: Array<{ kind: string }> = [];
  return {
    alerts,
    rssParser: { parseString: async () => ({ items: [] }) },
    circuitBreakerStore: createCircuitBreakerStore(cbModel),
    logger: () => undefined,
    adminAlert: async (kind: string) => { alerts.push({ kind }); },
    runConcurrent: async () => ({ processed: 0, errors: [] }),
    SchemaDriftError: TestSchemaDriftError,
    FETCH_CONCURRENCY: 10, FETCH_CONCURRENCY_STEAM: 4, FETCH_CONCURRENCY_EPIC: 2,
    FETCH_CONCURRENCY_LISTING: 8, FETCH_CONCURRENCY_DRIVER: 2,
    CIRCUIT_BREAKER_FAIL_THRESHOLD: 3, CIRCUIT_BREAKER_COOLDOWN_MS: 60_000, CIRCUIT_BREAKER_JITTER_MS: 0,
    SCHEMA_DRIFT_THRESHOLD: 2,
    httpReq: async () => ({ data: {} }),
    conditionalGet: async (_url, parse) => parse({}),
    fetchWithProxy: async () => "",
    withInflightTimeout: promise => promise,
    trackInflight: () => {},
    cleanText: text => String(text == null ? "" : text),
    stableUpdateId: (title, link) => `${String(title)}:${String(link)}`,
    normalizeUpdate: () => makeUpdate("u"),
    safeCheerioLoad: html => cheerioLoad(typeof html === "string" ? html : ""),
    crypto,
    getHttpMetrics: () => httpMetrics,
    ...overrides
  } as UpdatesDeps & { alerts: Array<{ kind: string }> };
}

const game: GameConfig = { key: "g", name: "Jocul" };

test("executeFetchWithCircuitBreaker: succes incrementeaza fetchSuccess si intoarce update-ul", async () => {
  const { model } = makeCbModel();
  const deps = makeDeps(model);
  const { executeFetchWithCircuitBreaker } = createUpdatesCircuitBreaker(deps, async () => makeUpdate("ok"));
  const result = await executeFetchWithCircuitBreaker(game);
  assert.equal(result.error, null);
  assert.equal(result.latest?.id, "ok");
  assert.equal(httpMetrics.fetchSuccess, 1);
});

test("executeFetchWithCircuitBreaker: cooldown activ raspunde imediat cu 'Circuit Breaker Activ' fara fetch", async () => {
  const { model } = makeCbModel({ cooldownUntil: new Date(Date.now() + 60_000) });
  const deps = makeDeps(model);
  let fetched = false;
  const { executeFetchWithCircuitBreaker } = createUpdatesCircuitBreaker(deps, async () => { fetched = true; return makeUpdate("x"); });
  const result = await executeFetchWithCircuitBreaker(game);
  assert.equal(result.error, "Circuit Breaker Activ");
  assert.equal(fetched, false);
});

test("executeFetchWithCircuitBreaker: la pragul de esecuri seteaza cooldown si trimite alerta cb", async () => {
  const { model, updates } = makeCbModel({ fails: 2 });
  const deps = makeDeps(model);
  const { executeFetchWithCircuitBreaker } = createUpdatesCircuitBreaker(deps, async () => { throw new Error("sursa moarta"); });
  const result = await executeFetchWithCircuitBreaker(game);
  assert.match(String(result.error), /sursa moarta/);
  assert.equal(httpMetrics.fetchFail, 1);
  assert.ok(updates.some(u => "cooldownUntil" in u), "cooldown-ul a fost setat la prag");
  assert.ok(deps.alerts.some(a => a.kind === "cb:g"), "alerta de circuit breaker trimisa");
});

test("executeFetchWithCircuitBreaker: SchemaDriftError la prag trimite alerta drift, nu cb", async () => {
  const { model } = makeCbModel({ schemaDriftFails: 1 });
  const deps = makeDeps(model);
  const { executeFetchWithCircuitBreaker } = createUpdatesCircuitBreaker(deps, async () => { throw new TestSchemaDriftError("0 rezultate", "steam"); });
  const result = await executeFetchWithCircuitBreaker(game);
  assert.equal(result.error, "0 rezultate");
  assert.ok(deps.alerts.some(a => a.kind === "drift:g"), "alerta de schema drift trimisa");
  assert.ok(!deps.alerts.some(a => a.kind === "cb:g"), "nu s-a trimis alerta de circuit breaker pe drift");
});

test("createUpdatesSourceDispatch: fetchGameUpdate incearca fallback-urile si adauga esecurile lor la eroarea principala", async () => {
  const { model } = makeCbModel();
  const deps = makeDeps(model);
  deps.rssParser.parseString = async () => { throw new Error("rss down"); };
  const dispatch = createUpdatesSourceDispatch(deps);
  const withFallback: GameConfig = {
    key: "g", name: "Jocul", type: "rss",
    fallbacks: [{ type: "rss", url: "https://example.com/feed" }]
  };
  await assert.rejects(
    () => dispatch.fetchGameUpdate(withFallback),
    (err: Error) => /rss down/.test(err.message) && /fallback-uri esuate/.test(err.message)
  );
});

import { classifySourceError } from "../../sources/sourceOutcome.js";

test("classifySourceError: 429/rate limit -> rate-limited, tip necunoscut -> permanent, restul -> transient (R6 #9)", () => {
  assert.equal(classifySourceError("HTTP 429 Too Many Requests"), "rate-limited");
  assert.equal(classifySourceError("rate limit exceeded"), "rate-limited");
  assert.equal(classifySourceError("Tip necunoscut."), "permanent-error");
  assert.equal(classifySourceError("ECONNRESET"), "transient-error");
  assert.equal(classifySourceError("socket hang up"), "transient-error");
});

test("executeFetchWithCircuitBreaker clasifica outcome pe toate caile: ok, rate-limited (cooldown), schema-drift, transient (R6 #9)", async () => {
  const okModel = makeCbModel();
  const okDeps = makeDeps(okModel.model);
  const okCb = createUpdatesCircuitBreaker(okDeps, async () => makeUpdate("ok"));
  assert.equal((await okCb.executeFetchWithCircuitBreaker(game)).outcome, "ok");

  const coolModel = makeCbModel({ cooldownUntil: new Date(Date.now() + 60_000) });
  const coolDeps = makeDeps(coolModel.model);
  const coolCb = createUpdatesCircuitBreaker(coolDeps, async () => makeUpdate("x"));
  assert.equal((await coolCb.executeFetchWithCircuitBreaker(game)).outcome, "rate-limited");

  const driftModel = makeCbModel();
  const driftDeps = makeDeps(driftModel.model);
  const driftCb = createUpdatesCircuitBreaker(driftDeps, async () => { throw new TestSchemaDriftError("0 rezultate", "steam"); });
  assert.equal((await driftCb.executeFetchWithCircuitBreaker(game)).outcome, "schema-drift");

  const failModel = makeCbModel();
  const failDeps = makeDeps(failModel.model);
  const failCb = createUpdatesCircuitBreaker(failDeps, async () => { throw new Error("ECONNRESET"); });
  assert.equal((await failCb.executeFetchWithCircuitBreaker(game)).outcome, "transient-error");

  const rateModel = makeCbModel();
  const rateDeps = makeDeps(rateModel.model);
  const rateCb = createUpdatesCircuitBreaker(rateDeps, async () => { throw new Error("Request failed with status code 429"); });
  assert.equal((await rateCb.executeFetchWithCircuitBreaker(game)).outcome, "rate-limited");
});
