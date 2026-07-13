import test from "node:test";
import assert from "node:assert/strict";

import type { FutureReleaseGameEntry, GuildSettings } from "../../types.js";
import {
  deleteFutureReleaseGame,
  listFutureReleaseGames,
  saveFutureReleaseGame,
  startFutureReleaseNotifications,
  stopFutureReleaseNotifications
} from "../../features/admin-records/futureReleaseGamesRepository.js";

function captureModel() {
  const calls: Array<{ filter: Record<string, unknown>; update: Record<string, unknown>; options?: Record<string, unknown> }> = [];
  return {
    calls,
    updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>) => {
      calls.push({ filter, update, options });
      return { matchedCount: 1, modifiedCount: 1 };
    }
  };
}

function futureReleaseModel(existing: FutureReleaseGameEntry[]) {
  const calls: Array<{ update: unknown; options?: unknown }> = [];
  const pulls: Array<Record<string, unknown>> = [];
  return {
    calls,
    pulls,
    updateOne: async (_filter: Record<string, unknown>, update: Record<string, unknown>, _options?: Record<string, unknown>) => {
      pulls.push(update);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    findOneAndUpdate: async (_filter: Record<string, unknown>, update: unknown, options?: Record<string, unknown>): Promise<{ futureReleaseGames?: FutureReleaseGameEntry[] } | null> => {
      calls.push({ update, options });
      const stage = (update as Array<{ $set?: { futureReleaseGames?: { $let?: { in?: { $cond?: unknown[] } } } } }>)[0];
      const cond = stage.$set?.futureReleaseGames?.$let?.in?.$cond as Array<{ $concatArrays?: unknown[] }>;
      const record = (cond[1].$concatArrays?.[1] as FutureReleaseGameEntry[])[0];
      const kept = existing.filter(game => game.gameName !== record.gameName);
      const futureReleaseGames = kept.length < 20 ? [...kept, record] : kept;
      return { futureReleaseGames };
    }
  };
}

test("saveFutureReleaseGame salveaza atomic printr-un singur findOneAndUpdate cu pipeline", async () => {
  const model = futureReleaseModel([]);
  const result = await saveFutureReleaseGame(model, "guild-1", { gameName: "silksong", releaseDate: "", preorderPrice: "", addedBy: "admin" });
  assert.equal(result.saved, true);
  assert.equal(model.calls.length, 1, "o singura operatie atomica, nu pull+push separat");
  assert.ok(Array.isArray(model.calls[0].update), "update-ul e un aggregation pipeline");
  assert.deepEqual(model.calls[0].options, { upsert: true, new: true });
});

test("saveFutureReleaseGame refuza al 21-lea joc nou fara sa evacueze tacut alt entry", async () => {
  const full = Array.from({ length: 20 }, (_value, index) => ({ gameName: `game-${index}`, addedBy: "admin", addedAt: new Date() }));
  const model = futureReleaseModel(full);
  const result = await saveFutureReleaseGame(model, "guild-1", { gameName: "silksong", releaseDate: "", preorderPrice: "", addedBy: "admin" });
  assert.equal(result.saved, false, "lista plina => add refuzat atomic (concurenta nu poate depasi limita)");
});

test("listFutureReleaseGames sorteaza alfabetic; deleteFutureReleaseGame normalizeaza si face $pull", async () => {
  const settings: GuildSettings = {
    _id: "guild-1",
    futureReleaseGames: [
      { gameName: "zelda", addedBy: "a", addedAt: new Date() },
      { gameName: "anno", addedBy: "a", addedAt: new Date() }
    ]
  };
  assert.deepEqual(listFutureReleaseGames(settings).map(game => game.gameName), ["anno", "zelda"]);

  const model = futureReleaseModel([]);
  const removed = await deleteFutureReleaseGame(model, "guild-1", "  Silksong  ");
  assert.equal(removed, true);
  assert.deepEqual(model.pulls[0], { $pull: { futureReleaseGames: { gameName: "silksong" } } }, "numele e normalizat inainte de $pull");
});

test("startFutureReleaseNotifications: $set subscribe/canal/activare cu upsert (scriere mutata din handler)", async () => {
  const model = captureModel();
  await startFutureReleaseNotifications(model, "guild-1", "chan-9", "act-abc");
  assert.equal(model.calls.length, 1);
  assert.deepEqual(model.calls[0].filter, { _id: "guild-1" });
  assert.deepEqual(model.calls[0].update, {
    $set: {
      futureReleaseSubscribed: true,
      futureReleaseChannelId: "chan-9",
      futureReleaseInitializing: false,
      futureReleaseActivationId: "act-abc"
    }
  });
  assert.deepEqual(model.calls[0].options, { upsert: true });
});

test("stopFutureReleaseNotifications: $set unsubscribe + $unset activationId, fara upsert", async () => {
  const model = captureModel();
  await stopFutureReleaseNotifications(model, "guild-1");
  assert.equal(model.calls.length, 1);
  assert.deepEqual(model.calls[0].filter, { _id: "guild-1" });
  assert.deepEqual(model.calls[0].update, {
    $set: { futureReleaseSubscribed: false, futureReleaseChannelId: null, futureReleaseInitializing: false },
    $unset: { futureReleaseActivationId: "" }
  });
  assert.equal(model.calls[0].options, undefined, "stop nu foloseste upsert");
});
