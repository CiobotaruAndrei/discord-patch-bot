import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGuildConfigExport,
  exportFileName,
  resolveGuildExportMode
} from "../../scripts/export-guild-configs.js";
import type { GuildSettings } from "../../features/guild-config/guildSettingsTypes.js";

const guild: GuildSettings = {
  _id: "guild-1",
  subscribed: true,
  notificationChannelId: "updates-channel",
  enabledGames: ["cs2"],
  pendingUpdates: { cs2: [] },
  updatesInitializing: true,
  adminCommandAccess: { mode: "role", roleId: "admin-role" }
};

test("exportul implicit pastreaza doar configuratia restaurabila", () => {
  const result = buildGuildConfigExport([guild], new Date("2026-07-13T08:00:00.000Z"));

  assert.equal(result.mode, "config");
  assert.equal(result.guildCount, 1);
  assert.equal(result.guilds[0]._id, "guild-1");
  assert.equal(result.guilds[0].subscribed, true);
  assert.equal(result.guilds[0].notificationChannelId, "updates-channel");
  assert.deepEqual(result.guilds[0].enabledGames, ["cs2"]);
  assert.equal(Object.hasOwn(result.guilds[0], "pendingUpdates"), false);
  assert.equal(Object.hasOwn(result.guilds[0], "updatesInitializing"), false);
  assert.equal(Object.hasOwn(result.guilds[0], "adminCommandAccess"), false);
});

test("exportul raw pastreaza documentele complete numai la cerere explicita", () => {
  const result = buildGuildConfigExport([guild], new Date("2026-07-13T08:00:00.000Z"), "raw");

  assert.equal(result.mode, "raw");
  assert.deepEqual(result.guilds, [guild]);
  const now = new Date("2026-07-13T08:00:00.000Z");
  assert.equal(exportFileName(now), "guild-configs-export-2026-07-13T08-00-00-000Z.json");
  assert.equal(exportFileName(now, "raw"), "guild-documents-export-2026-07-13T08-00-00-000Z.json");
});

test("modul de export accepta exclusiv optiunea raw cunoscuta", () => {
  assert.equal(resolveGuildExportMode([]), "config");
  assert.equal(resolveGuildExportMode(["--raw"]), "raw");
  assert.throws(() => resolveGuildExportMode(["--all"]), /Argumente export invalide/);
  assert.throws(() => resolveGuildExportMode(["--raw", "--all"]), /Argumente export invalide/);
});
