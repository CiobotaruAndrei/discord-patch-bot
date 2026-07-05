import test from "node:test";
import assert from "node:assert/strict";

import type { GuildSettings, WatchlistGameSuggestionEntry } from "../types";
import {
  deleteWatchlistGameSuggestion,
  listWatchlistGameSuggestions,
  saveWatchlistGameSuggestion
} from "../features/admin-records/watchlistGameSuggestionsRepository";

function watchlistModel(existing: WatchlistGameSuggestionEntry[], deleteMatchedCount = 1) {
  const calls: Array<{ update: unknown; options?: unknown }> = [];
  const pulls: Array<Record<string, unknown>> = [];
  const filters: Array<Record<string, unknown>> = [];
  return {
    calls,
    pulls,
    filters,
    updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>, _options?: Record<string, unknown>) => {
      filters.push(filter);
      pulls.push(update);
      return { matchedCount: deleteMatchedCount, modifiedCount: deleteMatchedCount };
    },
    findOneAndUpdate: async (_filter: Record<string, unknown>, update: unknown, options?: Record<string, unknown>): Promise<{ watchlistGameSuggestions?: WatchlistGameSuggestionEntry[] } | null> => {
      calls.push({ update, options });
      return { watchlistGameSuggestions: existing };
    }
  };
}

test("saveWatchlistGameSuggestion salveaza atomic (pipeline) si raporteaza added pentru un joc nou", async () => {
  const model = watchlistModel([]);
  const result = await saveWatchlistGameSuggestion(model, "guild-1", { gameName: "silksong", createdBy: "u1" });
  assert.equal(result.added, true);
  assert.equal(model.calls.length, 1, "o singura operatie atomica");
  assert.ok(Array.isArray(model.calls[0].update), "update-ul e un aggregation pipeline (dedupe)");
  assert.deepEqual(model.calls[0].options, { upsert: true });
});

test("saveWatchlistGameSuggestion nu dubleaza un joc deja propus (idempotent)", async () => {
  const model = watchlistModel([{ gameName: "silksong", createdBy: "u1", createdAt: new Date() }]);
  const result = await saveWatchlistGameSuggestion(model, "guild-1", { gameName: "silksong", createdBy: "u2" });
  assert.equal(result.added, false, "jocul deja propus => added=false");
});

test("listWatchlistGameSuggestions sorteaza descrescator; deleteWatchlistGameSuggestion normalizeaza si face $pull", async () => {
  const settings: GuildSettings = {
    _id: "guild-1",
    watchlistGameSuggestions: [
      { gameName: "old", createdBy: "u1", createdAt: "2024-01-01T00:00:00.000Z" },
      { gameName: "new", createdBy: "u2", createdAt: "2025-01-01T00:00:00.000Z" }
    ]
  };
  assert.deepEqual(listWatchlistGameSuggestions(settings, 1).map(entry => entry.gameName), ["new"]);

  const model = watchlistModel([]);
  const removed = await deleteWatchlistGameSuggestion(model, "guild-1", "  Silksong  ", { userId: "admin-1", action: "watchlist_game_delete", details: "silksong" });
  assert.equal(removed, true);
  assert.deepEqual(model.filters[0], { _id: "guild-1", "watchlistGameSuggestions.gameName": "silksong" }, "filtrul cere existenta propunerii, ca auditul sa nu se scrie pentru un delete inexistent");
  assert.deepEqual(model.pulls[0].$pull, { watchlistGameSuggestions: { gameName: "silksong" } }, "numele e normalizat (trim + lowercase) inainte de $pull");
  const auditPush = model.pulls[0].$push as { serverAuditLog: { $each: Array<Record<string, unknown>> } };
  assert.equal(auditPush.serverAuditLog.$each[0].action, "watchlist_game_delete", "auditul server-log e in ACEEASI scriere cu $pull");
});

test("deleteWatchlistGameSuggestion: propunerea inexistenta => false (matchedCount 0), fara audit scris", async () => {
  const model = watchlistModel([], 0);
  const removed = await deleteWatchlistGameSuggestion(model, "guild-1", "inexistent", { userId: "admin-1", action: "watchlist_game_delete", details: "inexistent" });
  assert.equal(removed, false);
  assert.equal(model.pulls.length, 1, "o singura incercare de scriere, refuzata de filtrul de existenta");
});
