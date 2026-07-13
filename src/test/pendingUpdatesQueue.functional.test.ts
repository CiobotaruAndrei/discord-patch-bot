import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPendingUpdatesQueue,
  type BuildPendingUpdatesQueueDeps,
  type BuildPendingUpdatesQueueInput,
  type PendingUpdate,
  type UpdateFetchResult
} from "../features/notifications/pendingUpdatesQueue.js";

function normalizePendingItem(item: unknown): PendingUpdate {
  const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
  return {
    ...record,
    id: String(record.id || ""),
    createdAt: record.createdAt instanceof Date ? record.createdAt : new Date(record.createdAt as string | number | Date || Date.now()),
    attempts: typeof record.attempts === "number" ? record.attempts : 0
  };
}

function makeDeps(overrides: Partial<BuildPendingUpdatesQueueDeps> = {}): BuildPendingUpdatesQueueDeps {
  return {
    normalizePendingUpdateArray: (arr: unknown): PendingUpdate[] => Array.isArray(arr) ? arr.map(normalizePendingItem) : [],
    toEntries: <K, V>(obj: Map<K, V> | Record<string, V> | undefined) =>
      obj instanceof Map ? Array.from(obj.entries())
        : obj ? Object.entries(obj) as Array<[K, V]> : [],
    PENDING_UPDATE_MAX_AGE_MS: 86_400_000,
    PENDING_UPDATE_MAX_ATTEMPTS: 5,
    PENDING_UPDATES_PER_GAME_LIMIT: 10,
    ...overrides
  };
}

function runQueue(input: BuildPendingUpdatesQueueInput, deps: BuildPendingUpdatesQueueDeps = makeDeps()) {
  return buildPendingUpdatesQueue(deps, input);
}

test("buildPendingUpdatesQueue indexeaza latestResults dupa game.key", () => {
  const result = runQueue({
    guild: { _id: "g", seen: {}, pendingUpdates: {} },
    latestResults: [
      { game: { key: "cs2", name: "CS2" }, latest: { id: "u1" } },
      { game: { key: "fortnite", name: "Fortnite" }, latest: { id: "u2" } }
    ] as UpdateFetchResult[]
  });
  assert.equal(result.resultByGameKey.size, 2);
  assert.equal(result.resultByGameKey.get("cs2")?.latest?.id, "u1");
});

test("buildPendingUpdatesQueue scoate pendingUpdates expirate dupa MAX_AGE_MS", () => {
  const now = Date.now();
  const oldDate = new Date(now - 100_000_000);
  const result = runQueue(
    {
      guild: {
        _id: "g", seen: {}, pendingUpdates: {
          cs2: [{ id: "u-old", createdAt: oldDate, attempts: 0 }]
        }
      },
      latestResults: [],
      now
    },
    makeDeps({ PENDING_UPDATE_MAX_AGE_MS: 86_400_000 })
  );
  assert.equal(result.pendingByGame.has("cs2"), false, "intrarea expirata e scoasa");
});

test("buildPendingUpdatesQueue scoate pendingUpdates cu attempts >= MAX_ATTEMPTS", () => {
  const result = runQueue(
    {
      guild: {
        _id: "g", seen: {},
        pendingUpdates: {
          cs2: [
            { id: "u1", createdAt: new Date(), attempts: 3 },
            { id: "u2", createdAt: new Date(), attempts: 1 }
          ]
        }
      },
      latestResults: []
    },
    makeDeps({ PENDING_UPDATE_MAX_ATTEMPTS: 3 })
  );
  const queue = result.pendingByGame.get("cs2");
  assert.equal(queue?.length, 1);
  assert.equal(queue?.[0].id, "u2");
});

test("buildPendingUpdatesQueue limiteaza queue per game la PENDING_UPDATES_PER_GAME_LIMIT", () => {
  const items = Array.from({ length: 15 }, (_, i) => ({ id: `u${i}`, createdAt: new Date(), attempts: 0 }));
  const result = runQueue(
    {
      guild: { _id: "g", seen: {}, pendingUpdates: { cs2: items } },
      latestResults: []
    },
    makeDeps({ PENDING_UPDATES_PER_GAME_LIMIT: 5 })
  );
  const queue = result.pendingByGame.get("cs2");
  assert.equal(queue?.length, 5, "doar ultimele 5 trebuie pastrate");

  assert.equal(queue?.[0].id, "u10");
});

test("buildPendingUpdatesQueue adauga update-uri noi din latestResults", () => {
  const result = runQueue({
    guild: { _id: "g", seen: {}, pendingUpdates: {} },
    latestResults: [
      { game: { key: "cs2", name: "CS2" }, latest: { id: "u-fresh" } }
    ] as UpdateFetchResult[]
  });
  const queue = result.pendingByGame.get("cs2");
  assert.equal(queue?.length, 1);
  assert.equal(queue?.[0].id, "u-fresh");
});

test("buildPendingUpdatesQueue NU adauga update-uri deja in queue (dedupe)", () => {
  const result = runQueue({
    guild: {
      _id: "g", seen: {},
      pendingUpdates: { cs2: [{ id: "u1", createdAt: new Date(), attempts: 0 }] }
    },
    latestResults: [
      { game: { key: "cs2", name: "CS2" }, latest: { id: "u1" } }
    ] as UpdateFetchResult[]
  });
  const queue = result.pendingByGame.get("cs2");
  assert.equal(queue?.length, 1, "fara duplicate");
});

test("buildPendingUpdatesQueue respecta enabledGames filter — drops out-of-filter pending si latest", () => {
  const result = runQueue({
    guild: {
      _id: "g", seen: {},
      pendingUpdates: {
        cs2: [{ id: "u1", createdAt: new Date(), attempts: 0 }],
        fortnite: [{ id: "u2", createdAt: new Date(), attempts: 0 }]
      },
      enabledGames: ["cs2"]
    },
    latestResults: [
      { game: { key: "cs2", name: "CS2" }, latest: { id: "u-cs2-new" } },
      { game: { key: "fortnite", name: "Fortnite" }, latest: { id: "u-fn-new" } }
    ] as UpdateFetchResult[]
  });
  assert.equal(result.pendingByGame.has("cs2"), true);
  assert.equal(result.pendingByGame.has("fortnite"), false, "fortnite filtered out");
  assert.equal(result.enabledSet?.has("cs2"), true);
  assert.equal(result.enabledSet?.has("fortnite"), false);
});

test("buildPendingUpdatesQueue cu enabledGames gol = no filter (enabledSet === null)", () => {
  const result = runQueue({
    guild: { _id: "g", seen: {}, pendingUpdates: {}, enabledGames: [] },
    latestResults: [
      { game: { key: "cs2", name: "CS2" }, latest: { id: "u-cs2" } },
      { game: { key: "fortnite", name: "Fortnite" }, latest: { id: "u-fn" } }
    ] as UpdateFetchResult[]
  });
  assert.equal(result.enabledSet, null);
  assert.equal(result.pendingByGame.size, 2, "fara filter, ambele jocuri raman");
});

