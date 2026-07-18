import test from "node:test";
import assert from "node:assert/strict";
import { applyGuildSettingsPatch, normalizeGuildSettings } from "../features/guild-config/guildAggregate.js";

test("guild aggregate normalizes collection fields and versions", () => {
  const current = normalizeGuildSettings({ _id: "g1", enabledGames: ["a", "a", ""], settingsVersion: undefined });
  assert.deepEqual(current.enabledGames, ["a"]);
  assert.equal(current.settingsSchemaVersion, 1);
  assert.equal(applyGuildSettingsPatch(current, { currency: "EUR" }).currency, "EUR");
});
