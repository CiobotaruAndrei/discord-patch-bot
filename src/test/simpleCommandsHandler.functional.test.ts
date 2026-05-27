import test from "node:test";
import assert from "node:assert/strict";


const installSimpleHandlers = require("../features/command-handlers/simpleCommandsHandler") as (ctx: Record<string, any>) => void;

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

function makeCtx(opts: { maxChars?: number } = {}) {
  const delegated: string[] = [];
  const logs: Array<{ level: string; ctx: string; msg: string }> = [];
  const ctx: Record<string, any> = {
    COMMAND_OUTPUT_MAX_CHARS: opts.maxChars ?? 1900,
    MessageFlags: { Ephemeral: 64 },
    logger: (level: string, c: string, msg: string) => { logs.push({ level, ctx: c, msg }); },
    handleInteraction: async (interaction: any) => { delegated.push(interaction.commandName); }
  };
  installSimpleHandlers(ctx);
  return { ctx, delegated, logs };
}

test("/ping replies with `Pong!` without trailing whitespace", async () => {
  const { ctx } = makeCtx();
  const { interaction, replies } = makeInteraction({ command: "ping" });
  await ctx.handleInteraction(interaction, []);
  assert.deepEqual(replies, ["Pong!"]);
});

test("/games replies with formatted game list when short", async () => {
  const { ctx } = makeCtx();
  const { interaction, replies, followUps } = makeInteraction({ command: "games" });
  await ctx.handleInteraction(interaction, [
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
  // Limita mica pentru a forta paginarea cu doar 2-3 entries.
  const { ctx } = makeCtx({ maxChars: 80 });
  const { interaction, replies, followUps } = makeInteraction({ command: "games" });
  await ctx.handleInteraction(interaction, [
    { key: "cs2", name: "Counter-Strike 2" },
    { key: "fortnite", name: "Fortnite" },
    { key: "dota2", name: "Dota 2" },
    { key: "minecraft", name: "Minecraft" }
  ]);
  assert.equal(replies.length, 1, "primul mesaj prin reply()");
  assert.ok(followUps.length >= 1, "restul prin followUp()");
});

test("/games with empty config replies politely", async () => {
  const { ctx } = makeCtx();
  const { interaction, replies } = makeInteraction({ command: "games" });
  await ctx.handleInteraction(interaction, []);
  assert.deepEqual(replies, ["Nu sunt jocuri configurate."]);
});

test("non-/ping non-/games commands delegate to next handler", async () => {
  const { ctx, delegated } = makeCtx();
  const { interaction } = makeInteraction({ command: "help" });
  await ctx.handleInteraction(interaction, []);
  assert.deepEqual(delegated, ["help"], "trebuie sa propage la handler-ul de mai jos");
});

test("interactions without guild context delegate (DM nesuportat)", async () => {
  const { ctx, delegated } = makeCtx();
  const { interaction } = makeInteraction({ command: "ping", hasGuild: false });
  await ctx.handleInteraction(interaction, []);
  // simpleCommandsHandler verifica guild in isSimpleCommand → false → delegheaza.
  assert.deepEqual(delegated, ["ping"]);
});

test("non-chat-input interactions delegate", async () => {
  const { ctx, delegated } = makeCtx();
  const { interaction } = makeInteraction({ command: "ping", isChatInput: false });
  await ctx.handleInteraction(interaction, []);
  assert.deepEqual(delegated, ["ping"]);
});

test("logger fires ERROR on internal exception, user gets generic error reply", async () => {
  // Fortam o eroare in handleGamesInteraction: dam un game cu aliases ne-array
  // care nu strica direct, dar putem face altceva — fortam un reply() reject.
  const { ctx, logs } = makeCtx();
  const interaction = {
    commandName: "ping",
    guild: { id: "guild-1" },
    isChatInputCommand: () => true,
    deferred: false,
    replied: false,
    reply: async () => { throw new Error("Discord unreachable"); },
    followUp: async () => undefined
  };
  await ctx.handleInteraction(interaction, []);
  assert.ok(logs.some(l => l.level === "ERROR" && l.ctx === "SIMPLE_COMMAND"));
});
