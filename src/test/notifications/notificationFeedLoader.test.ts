import test from "node:test";
import assert from "node:assert/strict";
import { loadNotificationFeed } from "../../features/notifications/notificationFeedLoader.js";

const validateNumber = (value: unknown): value is number => typeof value === "number";

test("notificationFeedLoader persista feed-ul proaspat", async () => {
  const persisted: number[][] = [];
  const result = await loadNotificationFeed({
    snapshotId: "feed",
    fetchFresh: async () => [1, 2],
    validateItem: validateNumber,
    persistFresh: async items => { persisted.push(items); },
    maxSnapshotAgeMs: 1000,
    onFallback: () => assert.fail("fallback neasteptat")
  });
  assert.deepEqual(result, [1, 2]);
  assert.deepEqual(persisted, [[1, 2]]);
});

test("notificationFeedLoader respinge implicit un snapshot partial corupt", async () => {
  await assert.rejects(() => loadNotificationFeed({
    snapshotId: "feed",
    fetchFresh: async () => { throw new Error("offline"); },
    validateItem: validateNumber,
    loadSnapshot: async () => ({ payload: [1, "invalid", 2], fetchedAt: new Date() }),
    maxSnapshotAgeMs: 1000,
    onFallback: () => assert.fail("snapshot corupt")
  }), /offline/);
});

test("notificationFeedLoader elimina explicit elementele invalide cand politica permite rezultat partial", async () => {
  let fallbackCount = 0;
  const result = await loadNotificationFeed({
    snapshotId: "feed",
    fetchFresh: async () => { throw new Error("offline"); },
    validateItem: validateNumber,
    loadSnapshot: async () => ({ payload: [1, "invalid", 2], fetchedAt: new Date() }),
    maxSnapshotAgeMs: 1000,
    invalidSnapshotItemPolicy: "drop-invalid",
    onFallback: () => { fallbackCount += 1; }
  });
  assert.deepEqual(result, [1, 2]);
  assert.equal(fallbackCount, 1);
});

test("notificationFeedLoader nu transforma un snapshot complet invalid intr-un feed gol", async () => {
  await assert.rejects(() => loadNotificationFeed({
    snapshotId: "feed",
    fetchFresh: async () => { throw new Error("offline"); },
    validateItem: validateNumber,
    loadSnapshot: async () => ({ payload: ["invalid"], fetchedAt: new Date() }),
    maxSnapshotAgeMs: 1000,
    invalidSnapshotItemPolicy: "drop-invalid",
    onFallback: () => assert.fail("snapshot complet invalid")
  }), /offline/);
});

test("notificationFeedLoader accepta un feed gol valid", async () => {
  let fallbackCount = 0;
  const result = await loadNotificationFeed({
    snapshotId: "feed",
    fetchFresh: async () => { throw new Error("offline"); },
    validateItem: validateNumber,
    loadSnapshot: async () => ({ payload: [], fetchedAt: new Date("2026-07-14T12:00:00Z") }),
    maxSnapshotAgeMs: 1000,
    now: () => new Date("2026-07-14T12:00:00.500Z").getTime(),
    onFallback: () => { fallbackCount += 1; }
  });
  assert.deepEqual(result, []);
  assert.equal(fallbackCount, 1);
});

test("notificationFeedLoader respinge timestamp-urile din viitor", async () => {
  await assert.rejects(() => loadNotificationFeed({
    snapshotId: "feed",
    fetchFresh: async () => { throw new Error("offline"); },
    validateItem: validateNumber,
    loadSnapshot: async () => ({ payload: [1], fetchedAt: new Date("2026-07-14T12:00:01Z") }),
    maxSnapshotAgeMs: 1000,
    now: () => new Date("2026-07-14T12:00:00Z").getTime(),
    onFallback: () => assert.fail("snapshot din viitor")
  }), /offline/);
});

test("notificationFeedLoader respinge snapshot-ul expirat", async () => {
  await assert.rejects(() => loadNotificationFeed({
    snapshotId: "feed",
    fetchFresh: async () => { throw new Error("offline"); },
    validateItem: validateNumber,
    loadSnapshot: async () => ({ payload: [1], fetchedAt: new Date(0) }),
    maxSnapshotAgeMs: 1000,
    onFallback: () => assert.fail("fallback expirat")
  }), /offline/);
});

test("notificationFeedLoader poate transforma eroarea cand fallback-ul lipseste", async () => {
  await assert.rejects(() => loadNotificationFeed({
    snapshotId: "feed",
    fetchFresh: async () => { throw new Error("offline"); },
    validateItem: validateNumber,
    loadSnapshot: async () => null,
    maxSnapshotAgeMs: 1000,
    onFallback: () => assert.fail("fallback lipsa"),
    createUnavailableError: () => new Error("feed indisponibil")
  }), /feed indisponibil/);
});
