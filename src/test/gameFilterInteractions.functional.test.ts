import test from "node:test";
import assert from "node:assert/strict";

type GameFilterModule = ((ctx: Record<string, any>) => void) & {
  createGameFilterInteractionHandlers: (deps: Record<string, any>) => {
    handleSetGames: (interaction: Record<string, any>, games: Array<Record<string, any>>, sub: string, guildId: string) => Promise<unknown>;
    handleSetGamesInteraction: (interaction: Record<string, any>, games: Array<Record<string, any>>) => Promise<unknown>;
  };
};

const gameFilterInteractions = require("../features/command-handlers/gameFilterHandlers") as GameFilterModule;

const games = [
  { key: "cs2", name: "Counter-Strike 2" },
  { key: "fortnite", name: "Fortnite" }
];

function makeSetGamesInteraction(sub: string, gameKey: string | null = "cs2") {
  return {
    commandName: "set",
    guild: { id: "guild-1" },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    options: {
      getSubcommandGroup: () => "games",
      getSubcommand: () => sub,
      getString: (name: string) => name === "joc" ? gameKey : null
    },
    followUp: async () => undefined,
    reply: async () => undefined
  };
}

function makeBaseContext(calls: any[], replies: any[]) {
  return {
    MessageFlags: { Ephemeral: 64 },
    GuildModel: {
      updateOne: async (...args: any[]) => {
        calls.push(args);
        return { matchedCount: 1, modifiedCount: 1 };
      }
    },
    logger: () => undefined,
    getGuildSettings: async () => ({ enabledGames: ["cs2"] }),
    invalidateGuildCache: (guildId: string) => calls.push(["invalidate", guildId]),
    safeDefer: async (interaction: Record<string, any>) => { interaction.deferred = true; },
    safeEdit: async (_interaction: unknown, payload: unknown) => { replies.push(payload); return payload; },
    formatUserError: (_err: unknown, fallback: string) => fallback
  };
}

test("game filter factory writes /set games add through explicit deps", async () => {
  const calls: any[] = [];
  const replies: any[] = [];
  const handlers = gameFilterInteractions.createGameFilterInteractionHandlers(makeBaseContext(calls, replies));

  await handlers.handleSetGames(makeSetGamesInteraction("add"), games, "add", "guild-1");

  assert.deepEqual(calls[0][0], { _id: "guild-1" });
  assert.deepEqual(calls[0][1], { $addToSet: { enabledGames: "cs2" } });
  assert.deepEqual(calls[0][2], { upsert: true });
  assert.deepEqual(calls[1], ["invalidate", "guild-1"]);
  assert.equal(replies[0], "OK: **Counter-Strike 2** adaugat la lista activa.");
});

test("game filter allows /set games remove for stale keys not in current config", async () => {
  // V11 regression guard: when an operator removes a game from config.json,
  // existing guilds still have the key in `enabledGames`. The old form
  // rejected `/set games remove <stale-key>` with "Cheia nu exista in config"
  // BEFORE running the $pull, so operators were stuck with stale entries in
  // their guild settings forever. The fix in `legacyInteractionRouter.ts`
  // never actually mattered — that handler is shadow-ed in the install chain
  // by gameFilterHandlers, which still had the old strict behavior. Now
  // gameFilterHandlers also accepts stale keys for `remove` (with a clear
  // "curatat-o" note) but keeps strict validation on `add`.
  const calls: any[] = [];
  const replies: any[] = [];
  const handlers = gameFilterInteractions.createGameFilterInteractionHandlers(makeBaseContext(calls, replies));

  // gameKey = "starcraft2" is NOT in `games` (only cs2 and fortnite are).
  await handlers.handleSetGames(makeSetGamesInteraction("remove", "starcraft2"), games, "remove", "guild-1");

  // Must have actually run the $pull (no early "Cheia nu exista" rejection).
  assert.deepEqual(calls[0][0], { _id: "guild-1" });
  assert.deepEqual(calls[0][1], { $pull: { enabledGames: "starcraft2" } });
  assert.deepEqual(calls[1], ["invalidate", "guild-1"]);
  assert.match(String(replies[0]), /starcraft2.*scos din lista activa/);
  assert.match(String(replies[0]), /cheie nu mai exista in config/,
    "must explicitly note the key was stale so operators understand the curatare");
});

test("game filter still rejects /set games add for unknown keys", async () => {
  // V11: `add` keeps strict validation — we don't want random keys polluting
  // enabledGames. Only `remove` was loosened.
  const calls: any[] = [];
  const replies: any[] = [];
  const handlers = gameFilterInteractions.createGameFilterInteractionHandlers(makeBaseContext(calls, replies));

  await handlers.handleSetGames(makeSetGamesInteraction("add", "starcraft2"), games, "add", "guild-1");

  assert.equal(calls.length, 0, "must NOT issue a DB write for unknown add key");
  assert.match(String(replies[0]), /Cheia.*nu exista in config/);
});

test("game filter reports no-op when /set games remove finds nothing to pull", async () => {
  // If the key wasn't in enabledGames (already removed, or never added), the
  // $pull is a no-op (modifiedCount === 0). The user should see an informative
  // "nimic de scos" message instead of a misleading "scos cu succes" one.
  const calls: any[] = [];
  const replies: any[] = [];
  const ctx = makeBaseContext(calls, replies);
  ctx.GuildModel = {
    updateOne: async (...args: any[]) => {
      calls.push(args);
      return { matchedCount: 1, modifiedCount: 0 };
    }
  };
  const handlers = gameFilterInteractions.createGameFilterInteractionHandlers(ctx);

  await handlers.handleSetGames(makeSetGamesInteraction("remove", "cs2"), games, "remove", "guild-1");

  assert.match(String(replies[0]), /nu era in lista activa, nimic de scos/);
});

test("game filter rejects unknown sub-commands explicitly instead of leaving deferReply hanging", async () => {
  // V11: any sub that's not list/reset/add/remove (e.g. future schema change
  // without matching handler update) was silently dropped — user stuck on the
  // deferReply spinner forever. Now we WARN-log and reply with an explicit
  // error.
  const calls: any[] = [];
  const replies: any[] = [];
  const logs: any[] = [];
  const ctx = makeBaseContext(calls, replies);
  ctx.logger = (...args: any[]) => logs.push(args);
  const handlers = gameFilterInteractions.createGameFilterInteractionHandlers(ctx);

  await handlers.handleSetGames(makeSetGamesInteraction("totally-unknown"), games, "totally-unknown", "guild-1");

  assert.equal(replies.length, 1, "must reply, not leave deferReply hanging");
  assert.match(String(replies[0]), /totally-unknown.*nu este recunoscuta/);
  assert.ok(logs.some(([level, ctx]) => level === "WARN" && ctx === "SET_GAMES"));
});

test("game filter installer intercepts only /set games commands", async () => {
  const calls: any[] = [];
  const replies: any[] = [];
  const delegated: string[] = [];
  const ctx: Record<string, any> = makeBaseContext(calls, replies);
  ctx.handleInteraction = async (interaction: Record<string, any>) => {
    delegated.push(interaction.commandName);
    return "delegated";
  };

  gameFilterInteractions(ctx);
  await ctx.handleInteraction(makeSetGamesInteraction("remove", "fortnite"), games);
  const result = await ctx.handleInteraction({
    commandName: "latest",
    guild: { id: "guild-1" },
    isChatInputCommand: () => true,
    options: { getSubcommandGroup: () => null }
  }, []);

  assert.deepEqual(calls[0][1], { $pull: { enabledGames: "fortnite" } });
  assert.equal(replies[0], "OK: **Fortnite** scos din lista activa.");
  assert.deepEqual(delegated, ["latest"]);
  assert.equal(result, "delegated");
});
