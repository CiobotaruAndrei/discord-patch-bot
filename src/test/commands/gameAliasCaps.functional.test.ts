import test from "node:test";
import assert from "node:assert/strict";

import mod from "../../features/command-handlers/watchlistCoverageAndAliasHandler.js";
import { MAX_ALIASES_PER_GAME, MAX_TOTAL_GAME_ALIASES } from "../../features/guild-config/gameAliasService.js";
import type { GameConfig } from "../../types.js";

const game: GameConfig = { key: "cs2", name: "Counter-Strike 2", type: "steam" };

function makeHandler(gameAliases: Record<string, string[]>, writes: unknown[], replies: unknown[]) {
  const settings = { _id: "guild-1", gameAliases };
  return mod.createCoverageAliasHandler({
    logger: () => undefined,
    safeDefer: async () => undefined,
    safeEdit: async (_interaction: unknown, payload: unknown) => { replies.push(payload); return null; },
    getGuildSettings: async () => settings,
    findGameAndSuggestion: () => ({ game, suggestion: null }),
    GuildModel: { updateOne: async (_filter: unknown, update: unknown) => { writes.push(update); return {}; } },
    handlePagination: async () => undefined,
    MessageFlags: { Ephemeral: 64 }
  });
}

function aliasInteraction(alias: string) {
  return {
    commandName: "game-alias",
    guild: { id: "guild-1" },
    user: { id: "u1" },
    options: {
      getString: (name: string) => (name === "joc" ? "cs2" : alias),
      getSubcommand: () => "add"
    },
    reply: async (payload: unknown) => payload,
    followUp: async (payload: unknown) => payload
  };
}

test("game-alias add refuza peste limita per joc, fara scriere in Mongo (audit #5, 154)", async () => {
  const writes: unknown[] = [];
  const replies: unknown[] = [];
  const full = Array.from({ length: MAX_ALIASES_PER_GAME }, (_unused, index) => `alias${index}`);
  const handler = makeHandler({ cs2: full }, writes, replies);

  await handler.handle(aliasInteraction("aliasnou"), [game]);

  assert.equal(writes.length, 0, "peste limita per joc nu se scrie in Mongo");
  assert.match(String(replies.at(-1)), new RegExp(`limita de ${MAX_ALIASES_PER_GAME}`));
});

test("game-alias add refuza peste limita totala pe server, fara scriere (audit #5, 154)", async () => {
  const writes: unknown[] = [];
  const replies: unknown[] = [];
  const distributed: Record<string, string[]> = {};
  let remaining = MAX_TOTAL_GAME_ALIASES;
  let gameIndex = 0;
  while (remaining > 0) {
    const take = Math.min(MAX_ALIASES_PER_GAME, remaining);
    distributed[`g${gameIndex}`] = Array.from({ length: take }, (_unused, index) => `g${gameIndex}a${index}`);
    remaining -= take;
    gameIndex++;
  }
  const handler = makeHandler(distributed, writes, replies);

  await handler.handle(aliasInteraction("aliasnou"), [game]);

  assert.equal(writes.length, 0, "peste limita totala nu se scrie in Mongo");
  assert.match(String(replies.at(-1)), new RegExp(`limita totala de ${MAX_TOTAL_GAME_ALIASES}`));
});

test("game-alias add sub limita scrie doar cheia jocului, nu tot obiectul (atomic per-cheie) (audit #5, 154)", async () => {
  const writes: Array<Record<string, unknown>> = [];
  const replies: unknown[] = [];
  const handler = makeHandler({ cs2: ["cs"] }, writes as unknown[], replies);

  await handler.handle(aliasInteraction("counter"), [game]);

  assert.equal(writes.length, 1);
  const setPart = writes[0].$set as Record<string, unknown> | undefined;
  assert.ok(setPart && "gameAliases.cs2" in setPart, "scrierea tinteste cheia dedicata gameAliases.cs2, nu tot obiectul gameAliases");
  assert.match(String(replies.at(-1)), /a fost adaugat/);
});
