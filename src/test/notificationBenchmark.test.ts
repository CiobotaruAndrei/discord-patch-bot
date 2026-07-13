import test from "node:test";
import assert from "node:assert/strict";
import { runNotificationBenchmark } from "../scripts/notificationBenchmark.js";

test("benchmark: masoara fluxurile pentru mai multe dimensiuni de guild-uri", async () => {
  const rows = await runNotificationBenchmark([3, 6], { gamesPerCycle: 4 });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].guilds, 3);
  assert.equal(rows[1].guilds, 6);

  for (const row of rows) {
    assert.ok(row.updates.durationMs >= 0, "durata update este masurata");
    assert.ok(row.discounts.durationMs >= 0, "durata reduceri este masurata");
  }
});

test("benchmark: trimiterile Discord scaleaza cu numarul de guild-uri (batch -> 1 mesaj/guild)", async () => {
  const rows = await runNotificationBenchmark([3, 6], { gamesPerCycle: 4 });

  assert.equal(rows[0].updates.discordSends, 3, "3 guild-uri -> 3 mesaje batch de update-uri");
  assert.equal(rows[1].updates.discordSends, 6, "6 guild-uri -> 6 mesaje batch de update-uri");
  assert.equal(rows[0].discounts.discordSends, 3, "3 guild-uri -> 3 mesaje batch de reduceri");
  assert.equal(rows[1].discounts.discordSends, 6, "6 guild-uri -> 6 mesaje batch de reduceri");
  assert.ok(rows[0].updates.mongoWrites > 0, "exista write-uri Mongo (claim + persist pending)");
});

test("benchmark: fetch-ul este partajat intre guild-uri (O(surse), nu O(guild-uri))", async () => {
  const rows = await runNotificationBenchmark([3, 6], { gamesPerCycle: 4 });

  assert.equal(rows[0].updates.fetches, 4, "update-urile fac fetch o data pe joc, nu pe guild");
  assert.equal(rows[1].updates.fetches, 4, "acelasi numar de fetch-uri indiferent de numarul de guild-uri");
  assert.equal(rows[0].discounts.fetches, 1, "reducerile fac fetch o data pe moneda, partajat intre guild-uri");
  assert.equal(rows[1].discounts.fetches, 1);
});
