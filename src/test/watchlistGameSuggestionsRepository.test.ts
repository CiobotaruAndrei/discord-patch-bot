import test from "node:test";
import assert from "node:assert/strict";

import type { GuildSettings, WatchlistGameSuggestionEntry } from "../types";
import {
  deleteWatchlistGameSuggestion,
  listWatchlistGameSuggestions,
  saveWatchlistGameSuggestion
} from "../features/admin-records/watchlistGameSuggestionsRepository";

function watchlistModel(existing: WatchlistGameSuggestionEntry[]) {
  const calls: Array<{ update: unknown; options?: unknown }> = [];
  const pulls: Array<Record<string, unknown>> = [];
  return {
    calls,
    pulls,
    updateOne: async (_filter: Record<string, unknown>, update: Record<string, unknown>, _options?: Record<string, unknown>) => {
      pulls.push(update);
      return { matchedCount: 1, modifiedCount: 1 };
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
  const removed = await deleteWatchlistGameSuggestion(model, "guild-1", "  Silksong  ");
  assert.equal(removed, true);
  assert.deepEqual(model.pulls[0], { $pull: { watchlistGameSuggestions: { gameName: "silksong" } } }, "numele e normalizat (trim + lowercase) inainte de $pull");
});
