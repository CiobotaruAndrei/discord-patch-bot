import test from "node:test";
import assert from "node:assert/strict";

import mod from "../../features/command-handlers/watchlistCoverageAndAliasHandler.js";
import { MAX_ALIASES_PER_GAME, MAX_TOTAL_GAME_ALIASES } from "../../features/guild-config/gameAliasService.js";
import type { GameConfig } from "../../types.js";

const game: GameConfig = { key: "cs2", name: "Counter-Strike 2", type: "steam" };

interface WriteLog {
  finds: Array<Record<string, unknown> | Array<Record<string, unknown>>>;
  updates: Array<Record<string, unknown> | Array<Record<string, unknown>>>;
}

function makeHandler(
  gameAliases: Record<string, string[]>,
  log: WriteLog,
  replies: unknown[],
  options: { addResult?: Record<string, string[]>; removeModified?: number } = {}
) {
  const settings = { _id: "guild-1", gameAliases };
  return mod.createCoverageAliasHandler({
    logger: () => undefined,
    safeDefer: async () => undefined,
    safeEdit: async (_interaction: unknown, payload: unknown) => { replies.push(payload); return null; },
    getGuildSettings: async () => settings,
    findGameAndSuggestion: () => ({ game, suggestion: null }),
    GuildModel: {
      findOneAndUpdate: async (_filter: Record<string, unknown>, update: Record<string, unknown> | Array<Record<string, unknown>>) => {
        log.finds.push(update);
        return { gameAliases: options.addResult ?? gameAliases };
      },
      updateOne: async (_filter: Record<string, unknown>, update: Record<string, unknown> | Array<Record<string, unknown>>) => {
        log.updates.push(update);
        return { modifiedCount: options.removeModified ?? 1 };
      }
    },
    handlePagination: async () => undefined,
    MessageFlags: { Ephemeral: 64 }
  });
}

function aliasInteraction(alias: string, subcommand: "add" | "remove" = "add") {
  return {
    commandName: "game-alias",
    guild: { id: "guild-1" },
    user: { id: "u1" },
    options: {
      getString: (name: string) => (name === "joc" ? "cs2" : alias),
      getSubcommand: () => subcommand
    },
    reply: async (payload: unknown) => payload,
    followUp: async (payload: unknown) => payload
  };
}

function emptyLog(): WriteLog {
  return { finds: [], updates: [] };
}

test("game-alias add refuza peste limita per joc, fara scriere in Mongo (audit #5, 154)", async () => {
  const log = emptyLog();
  const replies: unknown[] = [];
  const full = Array.from({ length: MAX_ALIASES_PER_GAME }, (_unused, index) => `alias${index}`);
  const handler = makeHandler({ cs2: full }, log, replies);

  await handler.handle(aliasInteraction("aliasnou"), [game]);

  assert.equal(log.finds.length + log.updates.length, 0, "peste limita per joc nu se scrie in Mongo");
  assert.match(String(replies.at(-1)), new RegExp(`limita de ${MAX_ALIASES_PER_GAME}`));
});

test("game-alias add refuza peste limita totala pe server, fara scriere (audit #5, 154)", async () => {
  const log = emptyLog();
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
  const handler = makeHandler(distributed, log, replies);

  await handler.handle(aliasInteraction("aliasnou"), [game]);

  assert.equal(log.finds.length + log.updates.length, 0, "peste limita totala nu se scrie in Mongo");
  assert.match(String(replies.at(-1)), new RegExp(`limita totala de ${MAX_TOTAL_GAME_ALIASES}`));
});

test("game-alias add sub limita foloseste pipeline atomic pe cheia jocului, nu tot obiectul (audit 154b #2)", async () => {
  const log = emptyLog();
  const replies: unknown[] = [];
  const handler = makeHandler({ cs2: ["cs"] }, log, replies, { addResult: { cs2: ["cs", "counter"] } });

  await handler.handle(aliasInteraction("counter"), [game]);

  assert.equal(log.finds.length, 1, "adaugarea foloseste findOneAndUpdate atomic");
  const pipeline = log.finds[0];
  assert.ok(Array.isArray(pipeline), "update-ul e un pipeline de agregare (conditie de plafon atomica)");
  const setPart = (pipeline[0] as { $set?: Record<string, unknown> }).$set ?? {};
  assert.ok("gameAliases.cs2" in setPart, "pipeline-ul tinteste cheia dedicata gameAliases.cs2, nu tot obiectul gameAliases");
  assert.match(String(replies.at(-1)), /a fost adaugat/);
});

test("game-alias add raporteaza cursa cand plafonul atomic respinge scrierea (aliasul nu apare dupa update) (audit 154b #2)", async () => {
  const log = emptyLog();
  const replies: unknown[] = [];
  const handler = makeHandler({ cs2: ["cs"] }, log, replies, { addResult: { cs2: ["cs"] } });

  await handler.handle(aliasInteraction("counter"), [game]);

  assert.match(String(replies.at(-1)), /comanda concurenta/, "cand aliasul nu e prezent dupa update-ul atomic, se raporteaza cursa, nu succes");
});

test("game-alias remove foloseste $pull pe cheia jocului (fara clobber) si raporteaza inexistenta (audit 154b #2)", async () => {
  const log = emptyLog();
  const replies: unknown[] = [];
  const handler = makeHandler({ cs2: ["cs", "counter"] }, log, replies, { removeModified: 1 });

  await handler.handle(aliasInteraction("counter", "remove"), [game]);

  assert.equal(log.updates.length, 1, "stergerea foloseste updateOne atomic");
  const update = log.updates[0] as { $pull?: Record<string, unknown> };
  assert.ok(update.$pull && "gameAliases.cs2" in update.$pull, "stergerea foloseste $pull doar pe cheia jocului, nu $set pe tot obiectul");
  assert.match(String(replies.at(-1)), /a fost sters/);

  const missingLog = emptyLog();
  const missingReplies: unknown[] = [];
  const missingHandler = makeHandler({ cs2: ["cs"] }, missingLog, missingReplies, { removeModified: 0 });
  await missingHandler.handle(aliasInteraction("counter", "remove"), [game]);
  assert.match(String(missingReplies.at(-1)), /nu exista/, "modifiedCount 0 -> aliasul nu exista");
});
