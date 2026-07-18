import test from "node:test";
import assert from "node:assert/strict";

import {
  createReviewTrendSnapshotService,
  selectHistoricalReviewSnapshot
} from "../../features/game-info/reviewTrendSnapshotService.js";

const DAY = 86_400_000;

function createMemoryModel() {
  const rows = new Map<string, Record<string, string | number | Date>>();
  return {
    rows,
    model: {
      updateOne: async (filter: Record<string, string>, update: { $set?: Record<string, string | number | Date> }) => {
        rows.set(filter._id, { _id: filter._id, ...(update.$set ?? {}) });
        return { acknowledged: true };
      },
      find: (filter: { appId?: { $eq?: string }; fetchedAt?: { $gte?: Date } }) => ({
        sort: () => ({
          lean: async () => [...rows.values()].filter(row =>
            (!filter.appId?.$eq || row.appId === filter.appId.$eq)
            && (!filter.fetchedAt?.$gte || new Date(String(row.fetchedAt)).getTime() >= filter.fetchedAt.$gte.getTime())
          )
        })
      })
    }
  };
}

test("review trend repository pastreaza un snapshot pe ora si il citeste cronologic", async () => {
  const memory = createMemoryModel();
  const service = createReviewTrendSnapshotService({
    ReviewTrendSnapshotModel: memory.model,
    fetchSteamReviewData: async () => ({ success: true, totalReviews: 100, qualityPercent: 80 }),
    logger: () => undefined
  });
  const at = new Date("2026-07-01T10:15:00.000Z");
  await service.recordReviewTrendSnapshot("730", "cs2", { success: true, totalReviews: 100, qualityPercent: 80 }, at);
  await service.recordReviewTrendSnapshot("730", "cs2", { success: true, totalReviews: 110, qualityPercent: 82 }, new Date(at.getTime() + 20 * 60_000));
  const history = await service.readReviewTrendHistory("730", new Date(at.getTime() - DAY));
  assert.equal(history.length, 1);
  assert.equal(history[0].totalReviews, 110);
});

test("refresh-ul periodic persista numai raspunsurile Steam valide", async () => {
  const memory = createMemoryModel();
  const service = createReviewTrendSnapshotService({
    ReviewTrendSnapshotModel: memory.model,
    fetchSteamReviewData: async appId => String(appId) === "730"
      ? { success: true, totalReviews: 1000, qualityPercent: 90 }
      : { success: false, totalReviews: 0, qualityPercent: 0 },
    logger: () => undefined
  });
  const result = await service.refreshReviewTrendSnapshots([
    { key: "cs2", name: "CS2", appId: "730" },
    { key: "portal", name: "Portal", appId: "10" }
  ]);
  assert.deepEqual(result, { refreshed: 1, failed: 1 });
  assert.equal(memory.rows.size, 1);
});

test("selectia ferestrei istorice alege snapshot-ul cel mai apropiat de sapte zile", () => {
  const now = new Date("2026-07-15T00:00:00.000Z");
  const history = [4, 7, 11].map(days => ({
    appId: "730",
    gameKey: "cs2",
    totalReviews: 1000 - days,
    qualityPercent: 80,
    at: new Date(now.getTime() - days * DAY)
  }));
  assert.equal(selectHistoricalReviewSnapshot(history, now)?.at.getTime(), now.getTime() - 7 * DAY);
  assert.equal(selectHistoricalReviewSnapshot([history[0]], new Date(now.getTime() + 20 * DAY)), null);
});
