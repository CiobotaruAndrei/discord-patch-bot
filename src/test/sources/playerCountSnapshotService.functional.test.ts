import test from "node:test";
import assert from "node:assert/strict";

import attachPlayerCountSnapshots from "../../features/player-count/playerCountSnapshotService.js";

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

test("refreshPlayerCountSnapshots salveaza istoricul si anunta automat un record nou", async () => {
  const { model } = makeModel();
  const history: Array<Record<string, unknown>> = [];
  const recordWrites: Array<Record<string, unknown>> = [];
  const sends: unknown[] = [];
  const service = attachPlayerCountSnapshots.createPlayerCountSnapshotService({
    PlayerCountSnapshotModel: model,
    PlayerCountHistoryModel: {
      create: async doc => { history.push(doc); return doc; },
      find: () => ({ sort: () => ({ lean: async () => [] }) })
    },
    PlayerCountRecordModel: {
      findById: () => ({ lean: async () => ({ _id: "10", gameKey: "cs2", playerCount: 100, reachedAt: new Date("2026-01-01") }) }),
      find: () => ({ lean: async () => [] }),
      updateOne: async (_filter, update) => { recordWrites.push(update); return {}; }
    },
    GuildModel: {
      find: () => ({ lean: async () => [{ _id: "guild-1", playerCountChannelId: "channel-1" }] })
    },
    fetchSteamCurrentPlayers: async appId => ({ appId: String(appId), playerCount: 125, success: true }),
    logger: () => undefined
  });
  const result = await service.refreshPlayerCountSnapshots(
    [{ key: "cs2", name: "Counter-Strike 2", appId: "10" }],
    null,
    { channels: { fetch: async () => ({ send: async (payload: unknown) => { sends.push(payload); return payload; } }) } }
  );
  assert.deepEqual(result, { refreshed: 1, failed: 0, milestones: 1 });
  assert.equal(history.length, 1);
  assert.equal(history[0].playerCount, 125);
  assert.equal(recordWrites.length, 1);
  assert.equal(sends.length, 1);
  assert.match(JSON.stringify(sends[0]), /Record nou de jucatori/);
});

test("notificarile player-count folosesc watchlist-ul, baseline persistent, cooldown si revendicare atomica", async () => {
  type WatchState = {
    gameKey: string;
    appId: string;
    playerCount: number;
    fetchedAt: Date;
    lastNotifiedAt?: Date;
    lastDirection?: "up" | "down";
  };
  const state: WatchState[] = [];
  const sends: unknown[] = [];
  let current = 1000;
  const guildModel = {
    find: () => ({
      lean: async () => [{
        _id: "guild-1",
        playerCountSubscribed: true,
        playerCountChannelId: "channel-1",
        enabledGames: ["cs2"],
        playerCountWatchState: state.map(entry => ({ ...entry }))
      }]
    }),
    updateOne: async (_filter: Record<string, unknown>, update: Record<string, unknown>) => {
      const pushed = (update.$push as { playerCountWatchState?: WatchState } | undefined)?.playerCountWatchState;
      if (pushed) {
        if (state.some(entry => entry.gameKey === pushed.gameKey)) return { modifiedCount: 0 };
        state.push({ ...pushed });
        return { modifiedCount: 1 };
      }
      const set = update.$set as Record<string, Date | number | string>;
      const expected = ((_filter.playerCountWatchState as { $elemMatch?: { gameKey?: string; playerCount?: number; fetchedAt?: Date } })?.$elemMatch);
      const entry = state.find(item => item.gameKey === expected?.gameKey);
      if (!entry || entry.playerCount !== expected?.playerCount || entry.fetchedAt.getTime() !== expected.fetchedAt?.getTime()) return { modifiedCount: 0 };
      entry.appId = String(set["playerCountWatchState.$[entry].appId"]);
      entry.playerCount = Number(set["playerCountWatchState.$[entry].playerCount"]);
      entry.fetchedAt = set["playerCountWatchState.$[entry].fetchedAt"] as Date;
      if (set["playerCountWatchState.$[entry].lastNotifiedAt"] instanceof Date) entry.lastNotifiedAt = set["playerCountWatchState.$[entry].lastNotifiedAt"] as Date;
      if (set["playerCountWatchState.$[entry].lastDirection"] === "up" || set["playerCountWatchState.$[entry].lastDirection"] === "down") entry.lastDirection = set["playerCountWatchState.$[entry].lastDirection"] as "up" | "down";
      return { modifiedCount: 1 };
    }
  };
  const buildService = () => attachPlayerCountSnapshots.createPlayerCountSnapshotService({
    PlayerCountSnapshotModel: makeModel().model,
    PlayerCountHistoryModel: { create: async doc => doc, find: () => ({ sort: () => ({ lean: async () => [] }) }) },
    PlayerCountRecordModel: {
      findById: () => ({ lean: async () => ({ _id: "10", gameKey: "cs2", playerCount: 999999, reachedAt: new Date() }) }),
      find: () => ({ lean: async () => [] }),
      updateOne: async () => ({})
    },
    GuildModel: guildModel,
    fetchSteamCurrentPlayers: async appId => ({ appId: String(appId), playerCount: current, success: true }),
    logger: () => undefined
  });
  const client = { channels: { fetch: async () => ({ send: async (payload: unknown) => { sends.push(payload); return payload; } }) } };
  const game = { key: "cs2", name: "Counter-Strike 2", appId: "10" };
  const service = buildService();

  await service.refreshPlayerCountSnapshots([game], null, client);
  assert.equal(state[0].playerCount, 1000);
  assert.equal(sends.length, 0, "prima masuratoare este baseline");

  current = 1100;
  await service.refreshPlayerCountSnapshots([game], null, client);
  assert.equal(sends.length, 0, "fluctuatia sub prag nu trimite alerta");

  current = 1500;
  await Promise.all([
    buildService().refreshPlayerCountSnapshots([game], null, client),
    buildService().refreshPlayerCountSnapshots([game], null, client)
  ]);
  assert.equal(sends.length, 1, "doua instante revendica o singura alerta pentru aceeasi tranzitie");

  current = 2000;
  await service.refreshPlayerCountSnapshots([game], null, client);
  assert.equal(sends.length, 1, "aceeasi directie este suprimata in cooldown");

  current = 1000;
  await service.refreshPlayerCountSnapshots([game], null, client);
  assert.equal(sends.length, 2, "schimbarea directiei poate produce alerta in cooldown");
});
