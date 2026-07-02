import test from "node:test";
import assert from "node:assert/strict";

import type { GuildSettings, SuggestedCommandEntry } from "../types";
import {
  deleteSuggestedCommand,
  listSuggestedCommands,
  saveSuggestedCommand
} from "../features/admin-records/suggestedCommandsRepository";

function suggestedCommandModel(existing: SuggestedCommandEntry[]) {
  const calls: Array<{ update: unknown; options?: unknown }> = [];
  const pulls: Array<Record<string, unknown>> = [];
  return {
    calls,
    pulls,
    updateOne: async (_filter: Record<string, unknown>, update: Record<string, unknown>, _options?: Record<string, unknown>) => {
      pulls.push(update);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    findOneAndUpdate: async (_filter: Record<string, unknown>, update: unknown, options?: Record<string, unknown>): Promise<{ suggestedCommands?: SuggestedCommandEntry[] } | null> => {
      calls.push({ update, options });
      return { suggestedCommands: existing };
    }
  };
}

test("saveSuggestedCommand salveaza atomic (findOneAndUpdate + pipeline) si raporteaza added pentru un nume nou", async () => {
  const model = suggestedCommandModel([]);
  const result = await saveSuggestedCommand(model, "guild-1", { commandName: "calendar", description: "x", createdBy: "u1" });
  assert.equal(result.added, true);
  assert.equal(model.calls.length, 1, "o singura operatie atomica, nu $push separat");
  assert.ok(Array.isArray(model.calls[0].update), "update-ul e un aggregation pipeline (dedupe)");
  assert.deepEqual(model.calls[0].options, { upsert: true });
});

test("saveSuggestedCommand nu dubleaza un nume deja propus (idempotent)", async () => {
  const model = suggestedCommandModel([{ commandName: "calendar", description: "x", createdBy: "u1", createdAt: new Date() }]);
  const result = await saveSuggestedCommand(model, "guild-1", { commandName: "calendar", description: "alta", createdBy: "u2" });
  assert.equal(result.added, false, "numele deja prezent => added=false (nu se dubleaza)");
});

test("listSuggestedCommands sorteaza descrescator si limiteaza; deleteSuggestedCommand normalizeaza numele si face $pull", async () => {
  const settings: GuildSettings = {
    _id: "guild-1",
    suggestedCommands: [
      { commandName: "old", description: "old", createdBy: "u1", createdAt: "2024-01-01T00:00:00.000Z" },
      { commandName: "new", description: "new", createdBy: "u2", createdAt: "2025-01-01T00:00:00.000Z" }
    ]
  };
  assert.deepEqual(listSuggestedCommands(settings, 1).map(entry => entry.commandName), ["new"]);

  const model = suggestedCommandModel([]);
  const removed = await deleteSuggestedCommand(model, "guild-1", "  /Calendar  ");
  assert.equal(removed, true);
  assert.deepEqual(model.pulls[0], { $pull: { suggestedCommands: { commandName: "calendar" } } }, "numele e normalizat (fara slash, lowercase) inainte de $pull");
});
