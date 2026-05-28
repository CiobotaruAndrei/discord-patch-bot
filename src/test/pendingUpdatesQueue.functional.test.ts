import test from "node:test";
import assert from "node:assert/strict";
import { buildPendingUpdatesQueue } from "../features/notifications/pendingUpdatesQueue";

function makeDeps(overrides: Partial<Parameters<typeof buildPendingUpdatesQueue>[0]> = {}) {
  return {
    normalizePendingUpdateArray: (arr: unknown): any[] => Array.isArray(arr) ? arr.map((it: any) => ({
      ...it,
      createdAt: it.createdAt instanceof Date ? it.createdAt : new Date(it.createdAt || Date.now()),
      attempts: typeof it.attempts === "number" ? it.attempts : 0
    })) : [],
    toEntries: (obj: any) =>
      obj instanceof Map ? Array.from(obj.entries())
        : obj ? Object.entries(obj) : [],
    PENDING_UPDATE_MAX_AGE_MS: 86_400_000,
    PENDING_UPDATE_MAX_ATTEMPTS: 5,
    PENDING_UPDATES_PER_GAME_LIMIT: 10,
    ...overrides
  };
}

test("buildPendingUpdatesQueue indexeaza latestResults dupa game.key", () => {
  const result = buildPendingUpdatesQueue(makeDeps() as any, {
    guild: { _id: "g", seen: {}, pendingUpdates: {} } as any,
    latestResults: [
      { game: { key: "cs2", name: "CS2" }, latest: { id: "u1" } },
      { game: { key: "fortnite", name: "Fortnite" }, latest: { id: "u2" } }
    ] as any
  });
  assert.equal(result.resultByGameKey.size, 2);
  assert.equal(result.resultByGameKey.get("cs2")?.latest?.id, "u1");
});

test("buildPendingUpdatesQueue scoate pendingUpdates expirate dupa MAX_AGE_MS", () => {
  const now = Date.now();
  const oldDate = new Date(now - 100_000_000);
  const result = buildPendingUpdatesQueue(
    makeDeps({ PENDING_UPDATE_MAX_AGE_MS: 86_400_000 }) as any,
    {
      guild: {
        _id: "g", seen: {}, pendingUpdates: {
          cs2: [{ id: "u-old", createdAt: oldDate, attempts: 0 }]
        }
      } as any,
      latestResults: [],
      now
    }
  );
  assert.equal(result.pendingByGame.has("cs2"), false, "intrarea expirata e scoasa");
});

test("buildPendingUpdatesQueue scoate pendingUpdates deja seen", () => {
  const result = buildPendingUpdatesQueue(makeDeps() as any, {
    guild: {
      _id: "g",
      seen: { cs2: ["u1"] },
      pendingUpdates: { cs2: [{ id: "u1", createdAt: new Date(), attempts: 0 }] }
    } as any,
    latestResults: []
  });
  assert.equal(result.pendingByGame.has("cs2"), false);
});

test("buildPendingUpdatesQueue scoate pendingUpdates cu attempts >= MAX_ATTEMPTS", () => {
  const result = buildPendingUpdatesQueue(
    makeDeps({ PENDING_UPDATE_MAX_ATTEMPTS: 3 }) as any,
    {
      guild: {
        _id: "g", seen: {},
        pendingUpdates: {
          cs2: [
            { id: "u1", createdAt: new Date(), attempts: 3 },
            { id: "u2", createdAt: new Date(), attempts: 1 }
          ]
        }
      } as any,
      latestResults: []
    }
  );
  const queue = result.pendingByGame.get("cs2");
  assert.equal(queue?.length, 1);
  assert.equal(queue?.[0].id, "u2");
});

test("buildPendingUpdatesQueue limiteaza queue per game la PENDING_UPDATES_PER_GAME_LIMIT", () => {
  const items = Array.from({ length: 15 }, (_, i) => ({ id: `u${i}`, createdAt: new Date(), attempts: 0 }));
  const result = buildPendingUpdatesQueue(
    makeDeps({ PENDING_UPDATES_PER_GAME_LIMIT: 5 }) as any,
    {
      guild: { _id: "g", seen: {}, pendingUpdates: { cs2: items } } as any,
      latestResults: []
    }
  );
  const queue = result.pendingByGame.get("cs2");
  assert.equal(queue?.length, 5, "doar ultimele 5 trebuie pastrate");

  assert.equal(queue?.[0].id, "u10");
});

test("buildPendingUpdatesQueue adauga update-uri noi din latestResults", () => {
  const result = buildPendingUpdatesQueue(makeDeps() as any, {
    guild: { _id: "g", seen: {}, pendingUpdates: {} } as any,
    latestResults: [
      { game: { key: "cs2", name: "CS2" }, latest: { id: "u-fresh" } }
    ] as any
  });
  const queue = result.pendingByGame.get("cs2");
  assert.equal(queue?.length, 1);
  assert.equal(queue?.[0].id, "u-fresh");
});

test("buildPendingUpdatesQueue NU adauga update-uri deja in queue (dedupe)", () => {
  const result = buildPendingUpdatesQueue(makeDeps() as any, {
    guild: {
      _id: "g", seen: {},
      pendingUpdates: { cs2: [{ id: "u1", createdAt: new Date(), attempts: 0 }] }
    } as any,
    latestResults: [
      { game: { key: "cs2", name: "CS2" }, latest: { id: "u1" } }
    ] as any
  });
  const queue = result.pendingByGame.get("cs2");
  assert.equal(queue?.length, 1, "fara duplicate");
});

test("buildPendingUpdatesQueue respecta enabledGames filter — drops out-of-filter pending si latest", () => {
  const result = buildPendingUpdatesQueue(makeDeps() as any, {
    guild: {
      _id: "g", seen: {},
      pendingUpdates: {
        cs2: [{ id: "u1", createdAt: new Date(), attempts: 0 }],
        fortnite: [{ id: "u2", createdAt: new Date(), attempts: 0 }]
      },
      enabledGames: ["cs2"]
    } as any,
    latestResults: [
      { game: { key: "cs2", name: "CS2" }, latest: { id: "u-cs2-new" } },
      { game: { key: "fortnite", name: "Fortnite" }, latest: { id: "u-fn-new" } }
    ] as any
  });
  assert.equal(result.pendingByGame.has("cs2"), true);
  assert.equal(result.pendingByGame.has("fortnite"), false, "fortnite filtered out");
  assert.equal(result.enabledSet?.has("cs2"), true);
  assert.equal(result.enabledSet?.has("fortnite"), false);
});

test("buildPendingUpdatesQueue cu enabledGames gol = no filter (enabledSet === null)", () => {
  const result = buildPendingUpdatesQueue(makeDeps() as any, {
    guild: { _id: "g", seen: {}, pendingUpdates: {}, enabledGames: [] } as any,
    latestResults: [
      { game: { key: "cs2", name: "CS2" }, latest: { id: "u-cs2" } },
      { game: { key: "fortnite", name: "Fortnite" }, latest: { id: "u-fn" } }
    ] as any
  });
  assert.equal(result.enabledSet, null);
  assert.equal(result.pendingByGame.size, 2, "fara filter, ambele jocuri raman");
});

test("buildPendingUpdatesQueue seenByGame construit din guild.seen (strict string)", () => {
  const result = buildPendingUpdatesQueue(makeDeps() as any, {
    guild: { _id: "g", seen: { cs2: ["u1", 2, "u3"] }, pendingUpdates: {} } as any,
    latestResults: []
  });
  const seen = result.seenByGame.get("cs2");
  assert.ok(seen?.has("u1"));
  assert.ok(seen?.has("2"), "numere coerced la string");
  assert.ok(seen?.has("u3"));
});
