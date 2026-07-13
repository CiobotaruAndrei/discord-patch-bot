import test from "node:test";
import assert from "node:assert/strict";

import mod from "../../features/command-handlers/sourcesRefreshHandler.js";

const GAME = { key: "cs2", name: "Counter-Strike 2" };

function makeInteraction(gameValue: string | null) {
  const edits: unknown[] = [];
  return {
    edits,
    interaction: {
      commandName: "sources",
      guild: { id: "g1" },
      deferred: false,
      replied: false,
      isChatInputCommand: () => true,
      reply: async (payload: unknown) => payload,
      followUp: async (payload: unknown) => payload,
      options: { getSubcommand: () => "refresh", getString: () => gameValue }
    },
    safeEdit: async (_i: unknown, payload: unknown) => { edits.push(payload); return payload; }
  };
}

test("buildSourcesRefreshEmbed: ok cu latest -> verde, cu titlu si link; eroare -> rosu; fara rezultat -> galben", () => {
  const okEmbed = mod.buildSourcesRefreshEmbed(GAME, { game: GAME, latest: { id: "u1", title: "Patch 1.2", link: "https://x/y", excerpt: "", fullText: "", image: null, thumbnail: null, timestamp: "2026-07-05" }, error: null, outcome: "ok" });
  assert.equal(okEmbed.color, 0x2ecc71);
  assert.match(okEmbed.description, /Patch 1\.2/);
  assert.match(okEmbed.description, /https:\/\/x\/y/);
  assert.match(okEmbed.description, /Rezultat fetch: ok/);

  const errEmbed = mod.buildSourcesRefreshEmbed(GAME, { game: GAME, latest: null, error: "connection reset", outcome: "transient-error" });
  assert.equal(errEmbed.color, 0xe74c3c);
  assert.match(errEmbed.description, /connection reset/);

  const emptyEmbed = mod.buildSourcesRefreshEmbed(GAME, { game: GAME, latest: null, error: null, outcome: "ok" });
  assert.equal(emptyEmbed.color, 0xf1c40f);
  assert.match(emptyEmbed.description, /niciun update valid/);
});

test("/sources refresh: fetch live pentru jocul cerut, fara sa scrie in seen; raspunde cu embed", async () => {
  const calls: { games: Array<{ key: string }> }[] = [];
  const { interaction, safeEdit, edits } = makeInteraction("cs2");
  const handler = mod.createSourcesRefreshHandler({
    logger: () => undefined,
    enforceCooldown: async () => true,
    startCommandLog: () => () => undefined,
    safeDefer: async () => undefined,
    safeEdit,
    getLatestForAllGames: async (games) => { calls.push({ games: games as Array<{ key: string }> }); return [{ game: GAME, latest: { id: "u1", title: "Patch nou", link: "https://x", excerpt: "", fullText: "", image: null, thumbnail: null, timestamp: "" }, error: null, outcome: "ok" }]; },
    MessageFlags: { Ephemeral: 64 }
  });
  await handler.handleSourcesRefresh(interaction, [GAME]);
  assert.equal(calls.length, 1, "un singur fetch live");
  assert.deepEqual(calls[0].games.map(g => g.key), ["cs2"], "fetch doar pentru jocul cerut");
  assert.equal(edits.length, 1);
  assert.match(JSON.stringify(edits[0]), /Patch nou/);
});

test("/sources refresh: joc necunoscut => eroare clara, fara fetch", async () => {
  let fetched = false;
  const { interaction, safeEdit, edits } = makeInteraction("inexistent");
  const handler = mod.createSourcesRefreshHandler({
    logger: () => undefined,
    enforceCooldown: async () => true,
    startCommandLog: () => () => undefined,
    safeDefer: async () => undefined,
    safeEdit,
    getLatestForAllGames: async () => { fetched = true; return []; },
    MessageFlags: { Ephemeral: 64 }
  });
  await handler.handleSourcesRefresh(interaction, [GAME]);
  assert.equal(fetched, false, "nu se face fetch pentru un joc inexistent");
  assert.match(String(edits[0]), /nu exista in lista configurata/);
});
