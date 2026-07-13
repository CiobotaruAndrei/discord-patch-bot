import test from "node:test";
import { installCommandChain, type ChainableCommandModule } from "./commandChainTestKit.js";
import assert from "node:assert/strict";

type StatusModule = ChainableCommandModule & {
  createStatusInteractionHandler: (deps: Record<string, unknown>) => {
    handleStatusInteraction: (interaction: Record<string, unknown>, games: Array<Record<string, unknown>>) => Promise<unknown>;
  };
};

import statusHandler from "../features/command-handlers/statusInteractionHandler.js";

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

type GameLike = { key: string; name: string };
type FindGameResult = { game: GameLike | null; suggestion: GameLike | null };
type InteractionRuntime = {
  handleInteraction: (interaction: unknown, games?: GameLike[]) => Promise<unknown>;
};
type StatusDeps = {
  MessageFlags: { Ephemeral: number };
  logger: (level: string, context: string, msg?: string, meta?: unknown) => void;
  enforceCooldown: (interaction: Record<string, unknown>, command: string) => Promise<boolean>;
  startCommandLog: (interaction: Record<string, unknown>, command: string) => (status?: string, extra?: unknown) => void;
  safeDefer: (interaction: Record<string, unknown>) => Promise<void>;
  safeEdit: (interaction: Record<string, unknown>, payload: unknown) => Promise<unknown>;
  findGameAndSuggestion: (text: unknown, games: GameLike[]) => FindGameResult;
  fetchGameStatus: (game: GameLike) => Promise<unknown>;
};

function makeBaseDeps(replies: unknown[], logs: Array<{ level: string; context: string }>) {
  let endCalls = 0;
  const deps: StatusDeps = {
    MessageFlags: { Ephemeral: 64 },
    logger: (level: string, context: string) => { logs.push({ level, context }); },
    enforceCooldown: async () => true,
    startCommandLog: () => () => { endCalls++; },
    safeDefer: async () => undefined,
    safeEdit: async (_interaction: Record<string, unknown>, payload: unknown) => { replies.push(payload); return payload; },
    findGameAndSuggestion: (text: unknown, games: GameLike[]) => {
      const game = games.find((g) => g.key === String(text || ""));
      return { game: game || null, suggestion: null };
    },
    fetchGameStatus: async () => ({ title: "Status" })
  };
  return { deps, endCalls: () => endCalls };
}

test("status handler factory replies with embed for a known game", async () => {
  const { interaction, replies } = makeStatusInteraction("cs2");
  const logs: Array<{ level: string; context: string }> = [];
  const { deps } = makeBaseDeps(replies, logs);
  const handlers = statusHandler.createStatusInteractionHandler(deps);
  const games = [{ key: "cs2", name: "Counter-Strike 2" }];

  await handlers.handleStatusInteraction(interaction, games);

  const last = replies[replies.length - 1] as { content?: string; embeds?: unknown[] };
  assert.match(String(last.content), /OK: Informatii preluate pentru \*\*Counter-Strike 2\*\*:/);
  assert.deepEqual(last.embeds, [{ title: "Status" }]);
});

test("status handler factory rejects empty gameText with ephemeral reply before cooldown/log/defer", async () => {
  const { interaction, replies } = makeStatusInteraction(null);
  const logs: Array<{ level: string; context: string }> = [];
  const { deps, endCalls } = makeBaseDeps(replies, logs);
  let cooldownCalled = false;
  let deferCalled = false;
  deps.enforceCooldown = async () => { cooldownCalled = true; return true; };
  deps.safeDefer = async () => { deferCalled = true; };
  const handlers = statusHandler.createStatusInteractionHandler(deps);

  await handlers.handleStatusInteraction(interaction, []);

  assert.equal(cooldownCalled, false, "cooldown must NOT run for empty gameText");
  assert.equal(deferCalled, false, "safeDefer must NOT run for empty gameText");
  assert.equal(endCalls(), 0, "startCommandLog must NOT produce an endLog");
  assert.equal(replies.length, 1);
  assert.match(String((replies[0] as { content?: string }).content), /Trebuie sa specifici un joc/);
});

test("status handler factory surfaces suggestion when game not found", async () => {
  const { interaction, replies } = makeStatusInteraction("starcraf");
  const logs: Array<{ level: string; context: string }> = [];
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
  const logs: Array<{ level: string; context: string }> = [];
  const { deps } = makeBaseDeps(replies, logs);
  const delegated: string[] = [];
  const context = {
    ...deps,
    handleInteraction: async (handled: { commandName: string }) => {
      delegated.push(handled.commandName);
      return "delegated";
    }
  };

  installCommandChain(context, [statusHandler] as object as ChainableCommandModule[]);
  const runtime = context as typeof context & InteractionRuntime;
  await runtime.handleInteraction(interaction, [{ key: "cs2", name: "Counter-Strike 2" }]);
  const result = await runtime.handleInteraction({
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
