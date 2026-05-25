import test from "node:test";
import assert from "node:assert/strict";

type StatusModule = ((ctx: Record<string, any>) => void) & {
  createStatusInteractionHandler: (deps: Record<string, any>) => {
    handleStatusInteraction: (interaction: Record<string, any>, games: Array<Record<string, any>>) => Promise<unknown>;
  };
};

const statusHandler = require("../features/command-handlers/statusInteractionHandler") as StatusModule;

function makeStatusInteraction(gameText: string | null = "cs2") {
  const replies: unknown[] = [];
  return {
    interaction: {
      commandName: "status",
      guild: { id: "guild-1" },
      user: { id: "user-1" },
      deferred: false,
      replied: false,
      isChatInputCommand: () => true,
      options: { getString: (name: string) => name === "joc" ? gameText : null },
      reply: async (payload: unknown) => { replies.push(payload); return payload; },
      followUp: async (payload: unknown) => { replies.push(payload); return payload; }
    },
    replies
  };
}

function makeBaseDeps(replies: unknown[], logs: Array<{ level: string; ctx: string }>) {
  let endCalls = 0;
  return {
    deps: {
      MessageFlags: { Ephemeral: 64 },
      logger: (level: string, ctx: string) => { logs.push({ level, ctx }); },
      enforceCooldown: async () => true,
      startCommandLog: () => (_status?: string) => { endCalls++; },
      safeDefer: async () => undefined,
      safeEdit: async (_interaction: unknown, payload: unknown) => { replies.push(payload); return payload; },
      findGameAndSuggestion: (text: unknown, games: Array<Record<string, any>>) => {
        const game = games.find((g) => g.key === String(text || ""));
        return { game: game || null, suggestion: null };
      },
      fetchGameStatus: async () => ({ title: "Status" })
    },
    endCalls: () => endCalls
  };
}

test("status handler factory replies with embed for a known game", async () => {
  const { interaction, replies } = makeStatusInteraction("cs2");
  const logs: Array<{ level: string; ctx: string }> = [];
  const { deps } = makeBaseDeps(replies, logs);
  const handlers = statusHandler.createStatusInteractionHandler(deps);
  const games = [{ key: "cs2", name: "Counter-Strike 2" }];

  await handlers.handleStatusInteraction(interaction, games);

  const last = replies[replies.length - 1] as { content?: string; embeds?: unknown[] };
  assert.match(String(last.content), /OK: Informatii preluate pentru \*\*Counter-Strike 2\*\*:/);
  assert.deepEqual(last.embeds, [{ title: "Status" }]);
});

test("status handler factory rejects empty gameText with ephemeral reply BEFORE any cooldown/log/defer", async () => {
  // V11 regression guard: gameText null/empty must short-circuit before
  // enforceCooldown / startCommandLog / safeDefer. The interaction.reply
  // (not safeEdit) is the ephemeral message.
  const { interaction, replies } = makeStatusInteraction(null);
  const logs: Array<{ level: string; ctx: string }> = [];
  const { deps, endCalls } = makeBaseDeps(replies, logs);
  let cooldownCalled = false;
  let deferCalled = false;
  deps.enforceCooldown = async () => { cooldownCalled = true; return true; };
  deps.safeDefer = async () => { deferCalled = true; };
  const handlers = statusHandler.createStatusInteractionHandler(deps);

  await handlers.handleStatusInteraction(interaction, []);

  assert.equal(cooldownCalled, false, "cooldown must NOT run for empty gameText");
  assert.equal(deferCalled, false, "safeDefer must NOT run for empty gameText");
  assert.equal(endCalls(), 0, "startCommandLog must NOT produce any endLog");
  assert.equal(replies.length, 1);
  assert.match(String((replies[0] as { content?: string }).content), /Trebuie sa specifici un joc/);
});

test("status handler factory surfaces suggestion when game not found", async () => {
  const { interaction, replies } = makeStatusInteraction("starcraf");
  const logs: Array<{ level: string; ctx: string }> = [];
  const { deps } = makeBaseDeps(replies, logs);
  deps.findGameAndSuggestion = () => ({
    game: null,
    suggestion: { key: "starcraft2", name: "StarCraft 2" }
  });
  const handlers = statusHandler.createStatusInteractionHandler(deps);

  await handlers.handleStatusInteraction(interaction, []);

  const last = String(replies[replies.length - 1]);
  assert.match(last, /Nu am gasit jocul/);
  assert.match(last, /Te refereai cumva la \*\*StarCraft 2\*\* \(`starcraft2`\)\?/);
});

test("status installer intercepts only /status and delegates everything else", async () => {
  const { interaction, replies } = makeStatusInteraction("cs2");
  const logs: Array<{ level: string; ctx: string }> = [];
  const { deps } = makeBaseDeps(replies, logs);
  const delegated: string[] = [];
  const ctx: Record<string, any> = {
    ...deps,
    handleInteraction: async (handled: Record<string, any>) => {
      delegated.push(handled.commandName);
      return "delegated";
    }
  };

  statusHandler(ctx);
  await ctx.handleInteraction(interaction, [{ key: "cs2", name: "Counter-Strike 2" }]);
  const result = await ctx.handleInteraction({
    commandName: "latest",
    guild: { id: "guild-1" },
    isChatInputCommand: () => true,
    reply: async () => undefined,
    options: { getString: () => null }
  }, []);

  assert.match(String((replies[replies.length - 1] as { content?: string }).content), /Informatii preluate/);
  assert.deepEqual(delegated, ["latest"]);
  assert.equal(result, "delegated");
});
