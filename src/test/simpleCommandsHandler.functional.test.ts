import test from "node:test";
import { installCommandChain, type ChainableCommandModule } from "./commandChainTestKit";
import assert from "node:assert/strict";

const installSimpleHandlers = require("../features/command-handlers/simpleCommandsHandler") as ChainableCommandModule;

type InteractionRuntime = {
  handleInteraction: (interaction: unknown, games?: unknown[]) => Promise<unknown>;
};

function makeInteraction(opts: {
  command?: string;
  hasGuild?: boolean;
  isChatInput?: boolean;
}) {
  const replies: unknown[] = [];
  const followUps: unknown[] = [];
  return {
    interaction: {
      commandName: opts.command ?? "ping",
      guild: opts.hasGuild === false ? null : { id: "guild-1" },
      isChatInputCommand: () => opts.isChatInput !== false,
      deferred: false,
      replied: false,
      reply: async (payload: unknown) => { replies.push(payload); return payload; },
      followUp: async (payload: unknown) => { followUps.push(payload); return payload; }
    },
    replies,
    followUps
  };
}

function makeContext(opts: { maxChars?: number } = {}) {
  const delegated: string[] = [];
  const logs: Array<{ level: string; context: string; msg: string }> = [];
  const context = {
    COMMAND_OUTPUT_MAX_CHARS: opts.maxChars ?? 1900,
    MessageFlags: { Ephemeral: 64 },
    logger: (level: string, c: string, msg: string) => { logs.push({ level, context: c, msg }); },
    handleInteraction: async (interaction: { commandName: string }) => { delegated.push(interaction.commandName); }
  };
  installCommandChain(context, [installSimpleHandlers]);
  return { context: context as typeof context & InteractionRuntime, delegated, logs };
}

test("/ping replies with `Pong!` without trailing whitespace", async () => {
  const { context } = makeContext();
  const { interaction, replies } = makeInteraction({ command: "ping" });
  await context.handleInteraction(interaction, []);
  assert.deepEqual(replies, ["Pong!"]);
});

test("/games replies with formatted game list when short", async () => {
  const { context } = makeContext();
  const { interaction, replies, followUps } = makeInteraction({ command: "games" });
  await context.handleInteraction(interaction, [
    { key: "cs2", name: "Counter-Strike 2", aliases: ["cs"] },
    { key: "fortnite", name: "Fortnite" }
  ]);
  assert.equal(replies.length, 1);
  assert.equal(followUps.length, 0, "lista scurta nu necesita follow-up");
  assert.match(String(replies[0]), /Jocuri urmarite/);
  assert.match(String(replies[0]), /Counter-Strike 2.*cs2.*Alias.*cs/);
  assert.match(String(replies[0]), /Fortnite/);
});

test("/games paginates via followUp when content exceeds COMMAND_OUTPUT_MAX_CHARS", async () => {

  const { context } = makeContext({ maxChars: 80 });
  const { interaction, replies, followUps } = makeInteraction({ command: "games" });
  await context.handleInteraction(interaction, [
    { key: "cs2", name: "Counter-Strike 2" },
    { key: "fortnite", name: "Fortnite" },
    { key: "dota2", name: "Dota 2" },
    { key: "minecraft", name: "Minecraft" }
  ]);
  assert.equal(replies.length, 1, "primul mesaj prin reply()");
  assert.ok(followUps.length >= 1, "restul prin followUp()");
});

test("/games with empty config replies politely", async () => {
  const { context } = makeContext();
  const { interaction, replies } = makeInteraction({ command: "games" });
  await context.handleInteraction(interaction, []);
  assert.deepEqual(replies, ["Nu sunt jocuri configurate."]);
});

test("non-/ping non-/games commands delegate to next handler", async () => {
  const { context, delegated } = makeContext();
  const { interaction } = makeInteraction({ command: "help" });
  await context.handleInteraction(interaction, []);
  assert.deepEqual(delegated, ["help"], "trebuie sa propage la handler-ul de mai jos");
});

test("interactions without guild context delegate (DM nesuportat)", async () => {
  const { context, delegated } = makeContext();
  const { interaction } = makeInteraction({ command: "ping", hasGuild: false });
  await context.handleInteraction(interaction, []);

  assert.deepEqual(delegated, ["ping"]);
});

test("non-chat-input interactions delegate", async () => {
  const { context, delegated } = makeContext();
  const { interaction } = makeInteraction({ command: "ping", isChatInput: false });
  await context.handleInteraction(interaction, []);
  assert.deepEqual(delegated, ["ping"]);
});

test("logger fires ERROR on internal exception, user gets generic error reply", async () => {

  const { context, logs } = makeContext();
  const interaction = {
    commandName: "ping",
    guild: { id: "guild-1" },
    isChatInputCommand: () => true,
    deferred: false,
    replied: false,
    reply: async () => { throw new Error("Discord unreachable"); },
    followUp: async () => undefined
  };
  await context.handleInteraction(interaction, []);
  assert.ok(logs.some(l => l.level === "ERROR" && l.context === "SIMPLE_COMMAND"));
});
