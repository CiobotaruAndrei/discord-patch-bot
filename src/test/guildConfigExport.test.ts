import test from "node:test";
import assert from "node:assert/strict";

import { buildGuildConfigExport, exportFileName } from "../scripts/export-guild-configs.js";

test("buildGuildConfigExport: pastreaza documentele si numara guild-urile, cu timestamp ISO determinist", () => {
  const now = new Date("2026-07-05T12:34:56.789Z");
  const docs = [
    { _id: "g1", subscribed: true, enabledGames: ["cs2"] },
    { _id: "g2", discountsSubscribed: false }
  ];
  const exportDoc = buildGuildConfigExport(docs, now);
  assert.equal(exportDoc.exportedAt, "2026-07-05T12:34:56.789Z");
  assert.equal(exportDoc.guildCount, 2);
  assert.deepEqual(exportDoc.guilds, docs, "documentele se exporta integral, fara transformari tacute");
  assert.deepEqual(buildGuildConfigExport([], now), { exportedAt: "2026-07-05T12:34:56.789Z", guildCount: 0, guilds: [] });
});

test("exportFileName: nume determinist, fara caractere invalide pentru sisteme de fisiere", () => {
  const name = exportFileName(new Date("2026-07-05T12:34:56.789Z"));
  assert.equal(name, "guild-configs-export-2026-07-05T12-34-56-789Z.json");
  assert.ok(!/[:*?"<>|]/.test(name), "fara caractere respinse de Windows");
});
