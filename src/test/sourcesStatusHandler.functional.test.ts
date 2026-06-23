import test from "node:test";
import assert from "node:assert/strict";

const mod = require("../features/command-handlers/sourcesStatusHandler") as typeof import("../features/command-handlers/sourcesStatusHandler");

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
    now
  );

  assert.match(embed.description, /Steam: OK/);
  assert.match(embed.description, /Epic: OK/);
  assert.match(embed.description, /Update feed CS2: OK/);
  assert.match(embed.description, /Update feed Fortnite: eroare/);
  assert.match(embed.description, /Ultimul fetch: acum 10 minute/);
  assert.equal(embed.color, 0xe67e22);
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
