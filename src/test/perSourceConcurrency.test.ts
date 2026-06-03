import test from "node:test";
import assert from "node:assert/strict";
import attachUpdates = require("../sources/updates");

type Game = { key: string; type?: string };
type FetchResultLike = { game: Game; latest: { id: string } | null; error: string | null };
type RunCall = { group: string; count: number; concurrency: number };

function makeUpdatesContext() {
  const runCalls: RunCall[] = [];
  const context: Record<string, unknown> = {
    FETCH_CONCURRENCY: 10,
    FETCH_CONCURRENCY_STEAM: 4,
    FETCH_CONCURRENCY_EPIC: 2,
    FETCH_CONCURRENCY_LISTING: 8,
    FETCH_CONCURRENCY_DRIVER: 2,
    logger: () => undefined,
    crypto: {
      createHash: () => {
        let captured = "";
        return {
          update: (value: unknown) => { captured = String(value); return { digest: () => captured }; }
        };
      }
    },
    withInflightTimeout: <T>(promise: Promise<T>) => promise,
    trackInflight: (map: Map<string, Promise<unknown>>, key: string, promise: Promise<unknown>) => {
      map.set(key, promise);
      const cleanup = () => { if (map.get(key) === promise) map.delete(key); };
      promise.then(cleanup, cleanup);
    },
    runConcurrent: async (
      items: Array<{ game: Game; idx: number }>,
      concurrency: number,
      fn: (item: { game: Game; idx: number }) => Promise<void>
    ) => {
      runCalls.push({ group: "", count: items.length, concurrency });
      for (const item of items) await fn(item);
      return { errors: [] };
    },
    executeFetchWithCircuitBreaker: async (game: Game): Promise<FetchResultLike> => ({
      game, latest: { id: game.key }, error: null
    })
  };
  attachUpdates(context as never);
  return { context, runCalls };
}

test("per-sursa: sourceConcurrencyGroup mapeaza tipurile la grupuri", () => {
  const group = attachUpdates.sourceConcurrencyGroup;
  assert.equal(group({ key: "a", type: "steam" } as never), "steam");
  assert.equal(group({ key: "a" } as never), "steam");
  assert.equal(group({ key: "a", type: "epic_games" } as never), "epic");
  assert.equal(group({ key: "a", type: "listing_based" } as never), "listing");
  assert.equal(group({ key: "a", type: "nvidia" } as never), "driver");
  assert.equal(group({ key: "a", type: "amd" } as never), "driver");
  assert.equal(group({ key: "a", type: "intel" } as never), "driver");
  assert.equal(group({ key: "a", type: "minecraft" } as never), "other");
  assert.equal(group({ key: "a", type: "roblox" } as never), "other");
});

test("per-sursa: fiecare grup ruleaza cu concurrency-ul propriu, rezultatele pastreaza ordinea", async () => {
  const { context, runCalls } = makeUpdatesContext();
  const getLatest = context.getLatestForAllGames as (games: Game[]) => Promise<FetchResultLike[]>;
  const games: Game[] = [
    { key: "cs2", type: "steam" },
    { key: "fortnite", type: "epic_games" },
    { key: "gta", type: "listing_based" },
    { key: "nv", type: "nvidia" },
    { key: "mc", type: "minecraft" },
    { key: "dota", type: "steam" }
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
  const getLatest = context.getLatestForAllGames as (games: Game[]) => Promise<FetchResultLike[]>;

  context.executeFetchWithCircuitBreaker = async (game: Game): Promise<FetchResultLike> => ({
    game, latest: { id: `mutat-${game.key}` }, error: null
  });

  const results = await getLatest([{ key: "cs2", type: "steam" }]);
  assert.equal(results[0].latest?.id, "cs2",
    "fabrica foloseste deps-ul injectat la attach (snapshot), nu mutatia tarzie de pe context — install adapter-ul nu mai partajeaza referinta target");
});
