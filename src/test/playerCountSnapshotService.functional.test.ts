import test from "node:test";
import assert from "node:assert/strict";

const attachPlayerCountSnapshots = require("../features/player-count/playerCountSnapshotService") as typeof import("../features/player-count/playerCountSnapshotService");

type UpsertCall = { filter: Record<string, unknown>; update: Record<string, unknown>; options?: Record<string, unknown> };
type LeanDoc = { _id: string; gameKey?: string; playerCount?: number; fetchedAt?: Date | string };

function makeModel(docs: LeanDoc[] = []) {
  const upserts: UpsertCall[] = [];
  const findFilters: Array<Record<string, unknown>> = [];
  return {
    model: {
      updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>) => {
        upserts.push({ filter, update, options });
        return {};
      },
      find: (filter: Record<string, unknown>) => {
        findFilters.push(filter);
        return { lean: async () => docs };
      }
    },
    upserts,
    findFilters
  };
}

test("refreshPlayerCountSnapshots: salveaza doar rezultatele valide, continua la esec per joc si sare jocurile fara appId", async () => {
  const { model, upserts } = makeModel();
  const service = attachPlayerCountSnapshots.createPlayerCountSnapshotService({
    PlayerCountSnapshotModel: model,
    fetchSteamCurrentPlayers: async (appId: string | number) => {
      const id = String(appId);
      if (id === "30") throw new Error("Steam 500");
      if (id === "20") return { appId: id, playerCount: 0, success: false };
      return { appId: id, playerCount: 1234, success: true };
    },
    logger: () => undefined
  });

  const result = await service.refreshPlayerCountSnapshots([
    { key: "cs2", name: "Counter-Strike 2", appId: "10" },
    { key: "fara-date", name: "Fara Date", appId: "20" },
    { key: "picat", name: "Picat", appId: "30" },
    { key: "fara-appid", name: "Fara AppId" }
  ]);

  assert.equal(result.refreshed, 1, "doar jocul cu raspuns valid e salvat");
  assert.equal(result.failed, 2, "esecul HTTP si raspunsul invalid sunt numarate, nu ignorate");
  assert.equal(upserts.length, 1);
  assert.deepEqual(upserts[0].filter, { _id: "10" });
  const set = upserts[0].update.$set as Record<string, unknown>;
  assert.equal(set.gameKey, "cs2");
  assert.equal(set.playerCount, 1234);
  assert.ok(set.fetchedAt instanceof Date);
  assert.deepEqual(upserts[0].options, { upsert: true });
});

test("refreshPlayerCountSnapshots: shouldAbort opreste refresh-ul fara scrieri", async () => {
  const { model, upserts } = makeModel();
  let fetches = 0;
  const service = attachPlayerCountSnapshots.createPlayerCountSnapshotService({
    PlayerCountSnapshotModel: model,
    fetchSteamCurrentPlayers: async (appId: string | number) => {
      fetches += 1;
      return { appId: String(appId), playerCount: 1, success: true };
    },
    logger: () => undefined
  });

  const result = await service.refreshPlayerCountSnapshots(
    [{ key: "cs2", name: "CS2", appId: "10" }, { key: "portal", name: "Portal", appId: "20" }],
    () => true
  );

  assert.equal(result.refreshed, 0);
  assert.equal(fetches, 0, "abort inainte de orice fetch");
  assert.equal(upserts.length, 0);
});

test("readPlayerCountSnapshots: intoarce map-ul pe appId si ignora documentele corupte", async () => {
  const now = new Date();
  const { model, findFilters } = makeModel([
    { _id: "10", gameKey: "cs2", playerCount: 55.9, fetchedAt: now.toISOString() },
    { _id: "20", gameKey: "corupt", playerCount: Number.NaN, fetchedAt: now },
    { _id: "30", gameKey: "fara-data", playerCount: 7 }
  ]);
  const service = attachPlayerCountSnapshots.createPlayerCountSnapshotService({
    PlayerCountSnapshotModel: model,
    fetchSteamCurrentPlayers: async () => { throw new Error("nu trebuie apelat la read"); },
    logger: () => undefined
  });

  const snapshots = await service.readPlayerCountSnapshots(["10", "20", "30"]);

  assert.deepEqual(findFilters[0], { _id: { $in: ["10", "20", "30"] } });
  assert.equal(snapshots.size, 1, "documentele fara playerCount numeric sau fara fetchedAt sunt ignorate");
  const snapshot = snapshots.get("10");
  assert.equal(snapshot?.gameKey, "cs2");
  assert.equal(snapshot?.playerCount, 55, "playerCount e intreg (floor)");
  assert.equal(snapshot?.fetchedAt.getTime(), new Date(now.toISOString()).getTime());
});

test("readPlayerCountSnapshots: lista goala nu atinge baza de date", async () => {
  const { model, findFilters } = makeModel();
  const service = attachPlayerCountSnapshots.createPlayerCountSnapshotService({
    PlayerCountSnapshotModel: model,
    fetchSteamCurrentPlayers: async () => { throw new Error("nu trebuie apelat"); },
    logger: () => undefined
  });

  const snapshots = await service.readPlayerCountSnapshots([]);

  assert.equal(snapshots.size, 0);
  assert.equal(findFilters.length, 0, "fara appId-uri nu se face query");
});
