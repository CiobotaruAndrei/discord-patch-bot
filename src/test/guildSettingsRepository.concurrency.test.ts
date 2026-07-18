import test from "node:test";
import assert from "node:assert/strict";
import { createGuildSettingsRepository, GuildSettingsConflictError } from "../features/guild-config/guildSettingsRepository.js";

test("guild settings repository rejects a stale optimistic version", async () => {
  const calls: Array<{ filter: Record<string, unknown>; update: Record<string, unknown> }> = [];
  const repository = createGuildSettingsRepository({
    updateOne: async (filter, update) => { calls.push({ filter, update }); return { matchedCount: 0 }; }
  });
  await assert.rejects(() => repository.setFieldIfVersion("g1", "currency", "EUR", 4), GuildSettingsConflictError);
  assert.deepEqual(calls[0], { filter: { _id: "g1", settingsVersion: 4 }, update: { $set: { currency: "EUR" }, $inc: { settingsVersion: 1 } } });
});

test("guild settings repository refuza campurile care nu fac parte din aggregate", async () => {
  const repository = createGuildSettingsRepository({ updateOne: async () => ({ matchedCount: 1 }) });
  await assert.rejects(
    () => repository.setField("g1", "unknown-field" as Parameters<typeof repository.setField>[1], true),
    /Camp GuildSettings necunoscut/
  );
});
