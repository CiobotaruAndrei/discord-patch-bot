import test from "node:test";
import assert from "node:assert/strict";
import * as crypto from "crypto";
import { load as cheerioLoad } from "cheerio";
import type { GameConfig, FetchResult, NormalizedUpdate } from "../../types.js";
import attachUpdates from "../../sources/updates/index.js";

type UpdatesContext = Parameters<typeof attachUpdates.buildFrom>[0];
type GetLatest = (games: GameConfig[]) => Promise<FetchResult[]>;
type RunCall = { group: string; count: number; concurrency: number };

class TestSchemaDriftError extends Error {
  source?: string;
  constructor(message: string, source?: string) {
    super(message);
    this.source = source;
  }
}

const httpMetrics = { fetchSuccess: 0, fetchFail: 0 };

function makeUpdate(id: string): NormalizedUpdate {
  return { id, title: "", link: "", excerpt: "", fullText: "", image: null, thumbnail: null, timestamp: "" };
}

function makeUpdatesContext() {
  const runCalls: RunCall[] = [];
  const context: UpdatesContext = {
    rssParser: { parseString: async () => ({ items: [] }) },
    CircuitBreakerModel: {} as UpdatesContext["CircuitBreakerModel"],
    logger: () => undefined,
    adminAlert: async () => undefined,
    runConcurrent: async (items, concurrency, fn) => {
      runCalls.push({ group: "", count: items.length, concurrency });
      for (let i = 0; i < items.length; i++) await fn(items[i], i);
      return { processed: items.length, errors: [] };
    },
    SchemaDriftError: TestSchemaDriftError,
    FETCH_CONCURRENCY: 10,
    FETCH_CONCURRENCY_STEAM: 4,
    FETCH_CONCURRENCY_EPIC: 2,
    FETCH_CONCURRENCY_LISTING: 8,
    FETCH_CONCURRENCY_DRIVER: 2,
    CIRCUIT_BREAKER_FAIL_THRESHOLD: 5,
    CIRCUIT_BREAKER_COOLDOWN_MS: 60_000,
    CIRCUIT_BREAKER_JITTER_MS: 0,
    SCHEMA_DRIFT_THRESHOLD: 3,
    httpReq: async () => ({ data: {} }),
    conditionalGet: async (_url, parse) => parse({}),
    fetchWithProxy: async () => "",
    withInflightTimeout: promise => promise,
    trackInflight: (map, key, promise) => {
      map.set(key, promise);
      const cleanup = () => { if (map.get(key) === promise) map.delete(key); };
      promise.then(cleanup, cleanup);
    },
    cleanText: text => String(text == null ? "" : text),
    stableUpdateId: (title, link) => `stable:${String(title)}:${String(link)}`,
    normalizeUpdate: () => makeUpdate("u"),
    safeCheerioLoad: html => cheerioLoad(typeof html === "string" ? html : ""),
    crypto,
    getHttpMetrics: () => httpMetrics,
    executeFetchWithCircuitBreaker: async game => ({ game, latest: makeUpdate(game.key), error: null })
  };
  Object.assign(context, attachUpdates.buildFrom(context));
  return { context, runCalls };
}

test("per-sursa: sourceConcurrencyGroup mapeaza tipurile la grupuri", () => {
  const group = attachUpdates.sourceConcurrencyGroup;
  assert.equal(group({ key: "a", name: "A", type: "steam" }), "steam");
  assert.equal(group({ key: "a", name: "A" }), "steam");
  assert.equal(group({ key: "a", name: "A", type: "epic_games" }), "epic");
  assert.equal(group({ key: "a", name: "A", type: "listing_based" }), "listing");
  assert.equal(group({ key: "a", name: "A", type: "nvidia" }), "driver");
  assert.equal(group({ key: "a", name: "A", type: "amd" }), "driver");
  assert.equal(group({ key: "a", name: "A", type: "intel" }), "driver");
  assert.equal(group({ key: "a", name: "A", type: "minecraft" }), "other");
  assert.equal(group({ key: "a", name: "A", type: "roblox" }), "other");
});

test("per-sursa: fiecare grup ruleaza cu concurrency-ul propriu, rezultatele pastreaza ordinea", async () => {
  const { context, runCalls } = makeUpdatesContext();
  const getLatest = context.getLatestForAllGames as GetLatest;
  const games: GameConfig[] = [
    { key: "cs2", name: "CS2", type: "steam" },
    { key: "fortnite", name: "Fortnite", type: "epic_games" },
    { key: "gta", name: "GTA", type: "listing_based" },
    { key: "nv", name: "NVIDIA", type: "nvidia" },
    { key: "mc", name: "Minecraft", type: "minecraft" },
    { key: "dota", name: "Dota", type: "steam" }
  ];
  const results = await getLatest(games);

  assert.deepEqual(results.map(r => r.latest?.id), ["cs2", "fortnite", "gta", "nv", "mc", "dota"],
    "rezultatele sunt aliniate la ordinea de intrare, indiferent de grupare");

  const byConcurrency = runCalls.map(c => ({ count: c.count, concurrency: c.concurrency }))
    .sort((a, b) => a.concurrency - b.concurrency || a.count - b.count);
  assert.deepEqual(byConcurrency, [
    { count: 1, concurrency: 2 },
    { count: 1, concurrency: 2 },
    { count: 2, concurrency: 4 },
    { count: 1, concurrency: 8 },
    { count: 1, concurrency: 10 }
  ], "epic(2)x1, driver(2)x1, steam(4)x2, listing(8)x1, other(10)x1");
});

test("attachUpdates decupleaza fabrica de context: o mutatie tarzie a contextului nu se mai scurge in deps", async () => {
  const { context } = makeUpdatesContext();
  const getLatest = context.getLatestForAllGames as GetLatest;

  context.executeFetchWithCircuitBreaker = async (game: GameConfig) => ({ game, latest: makeUpdate(`mutat-${game.key}`), error: null });

  const results = await getLatest([{ key: "cs2", name: "CS2", type: "steam" }]);
  assert.equal(results[0].latest?.id, "cs2",
    "fabrica foloseste deps-ul injectat la attach (snapshot), nu mutatia tarzie de pe context — install adapter-ul nu mai partajeaza referinta target");
});
