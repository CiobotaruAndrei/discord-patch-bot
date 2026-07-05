import test from "node:test";
import assert from "node:assert/strict";

const mod = require("../features/command-handlers/sourcesStatusHandler") as typeof import("../features/command-handlers/sourcesStatusHandler");
import { summarizeSourceHealth } from "../sources/sourceHealth";

test("buildSourcesStatusEmbed afiseaza store-uri, feed-uri si vechimea ultimului fetch", () => {
  const now = new Date("2026-06-23T15:00:00.000Z");
  const embed = mod.buildSourcesStatusEmbed(
    [
      { key: "cs2", name: "CS2" },
      { key: "fortnite", name: "Fortnite" }
    ],
    {
      fetchedAt: new Date("2026-06-23T14:50:00.000Z"),
      payload: [
        { game: { key: "cs2" }, latest: { id: "u1" }, error: null },
        { game: { key: "fortnite" }, latest: null, error: "schema drift" }
      ]
    },
    [
      {
        currency: "USD",
        fetchedAt: new Date("2026-06-23T14:45:00.000Z"),
        payload: [
          { store: "Steam", title: "Deal 1" },
          { store: "Epic Games", title: "Deal 2" }
        ]
      }
    ],
    null,
    now
  );

  assert.match(embed.description, /Steam: OK/);
  assert.match(embed.description, /Epic: OK/);
  assert.match(embed.description, /Update feed CS2: OK/);
  assert.match(embed.description, /Update feed Fortnite: eroare/);
  assert.match(embed.description, /Ultimul fetch: acum 10 minute/);
  assert.equal(embed.color, 0xe67e22);
});

test("buildSourcesStatusEmbed randeaza sumarul de sanatate al surselor si listeaza sursele cu probleme (R11 #1)", () => {
  const now = new Date("2026-06-23T15:00:00.000Z");
  const health = summarizeSourceHealth([
    { key: "cs2", fails: 0, cooldownUntil: null, schemaDriftFails: 0 },
    { key: "dota", fails: 3, cooldownUntil: null, schemaDriftFails: 0 },
    { key: "fortnite", fails: 5, cooldownUntil: new Date("2026-06-23T15:10:00.000Z"), schemaDriftFails: 0 },
    { key: "minecraft", fails: 0, cooldownUntil: null, schemaDriftFails: 4 }
  ], now);
  const embed = mod.buildSourcesStatusEmbed([{ key: "cs2", name: "CS2" }], null, [], health, now);
  assert.match(embed.description, /Sanatate surse \(circuit breaker\): 1\/4 sanatoase, 1 degradate, 1 in cooldown, 1 schema-drift/);
  assert.match(embed.description, /dota \(degradata\)/);
  assert.match(embed.description, /fortnite \(in cooldown\)/);
  assert.match(embed.description, /minecraft \(schema-drift\)/);
  assert.equal(embed.color, 0xe67e22, "cooldown/schema-drift => portocaliu");
});

test("summarizeSourceHealth: cooldown activ domina, fails->degradat, schemaDrift->drift, cooldown expirat->dupa fails/drift", () => {
  const now = new Date("2026-06-23T15:00:00.000Z");
  const s = summarizeSourceHealth([
    { key: "a", fails: 0, cooldownUntil: null, schemaDriftFails: 0 },
    { key: "b", fails: 2, cooldownUntil: new Date("2026-06-23T15:05:00.000Z"), schemaDriftFails: 1 },
    { key: "c", fails: 0, cooldownUntil: new Date("2026-06-23T14:55:00.000Z"), schemaDriftFails: 3 },
    { key: "d", fails: 1, cooldownUntil: "not-a-date", schemaDriftFails: 0 }
  ], now);
  assert.equal(s.healthy, 1);
  assert.equal(s.coolingDown, 1, "b are cooldown activ => cooling-down, indiferent de fails/drift");
  assert.equal(s.schemaDrift, 1, "c are cooldown expirat + schemaDrift => schema-drift");
  assert.equal(s.degraded, 1, "d are fails, cooldown invalid ignorat => degradat");
  assert.deepEqual(s.unhealthy.map(u => u.key), ["b", "c", "d"], "sortate alfabetic");
});

test("/sources status incarca snapshot-urile si raspunde ephemeral", async () => {
  const edits: unknown[] = [];
  const handler = mod.createSourcesStatusHandler({
    logger: () => undefined,
    enforceCooldown: async () => true,
    startCommandLog: () => () => undefined,
    safeDefer: async (_interaction, ephemeral) => {
      assert.equal(ephemeral, true);
    },
    safeEdit: async (_interaction, payload) => {
      edits.push(payload);
      return payload;
    },
    loadFetchSnapshot: async () => ({ payload: [], fetchedAt: new Date() }),
    loadDealsFetchSnapshots: async () => [],
    MessageFlags: { Ephemeral: 64 }
  });

  await handler.handleSourcesStatus({
    commandName: "sources",
    guild: { id: "g1" },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    reply: async payload => payload,
    followUp: async payload => payload,
    options: { getSubcommand: () => "status" }
  }, [{ key: "cs2", name: "CS2" }]);

  assert.equal(edits.length, 1);
  assert.match(JSON.stringify(edits[0]), /Status surse/);
});
