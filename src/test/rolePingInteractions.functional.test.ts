import test from "node:test";
import assert from "node:assert/strict";

type RolePingModule = ((ctx: Record<string, any>) => void) & {
  createRolePingInteractionHandlers: (deps: Record<string, any>) => {
    handleSetRole: (interaction: Record<string, any>, sub: string, guildId: string) => Promise<unknown>;
    handleSetRoleInteraction: (interaction: Record<string, any>) => Promise<unknown>;
  };
};

const rolePingInteractions = require("../features/command-handlers/rolePingHandlers") as RolePingModule;

function makeSetRoleInteraction(sub: string, role: Record<string, any> | null = { id: "role-1" }) {
  return {
    commandName: "set",
    guild: { id: "guild-1" },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    options: {
      getSubcommandGroup: () => "role",
      getSubcommand: () => sub,
      getRole: (name: string) => name === "value" ? role : null
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
    invalidateGuildCache: (guildId: string) => calls.push(["invalidate", guildId]),
    safeDefer: async (interaction: Record<string, any>) => { interaction.deferred = true; },
    safeEdit: async (_interaction: unknown, payload: unknown) => { replies.push(payload); return payload; },
    formatUserError: (_err: unknown, fallback: string) => fallback
  };
}

test("role ping factory writes /set role updates through explicit deps", async () => {
  const calls: any[] = [];
  const replies: any[] = [];
  const handlers = rolePingInteractions.createRolePingInteractionHandlers(makeBaseContext(calls, replies));

  await handlers.handleSetRole(makeSetRoleInteraction("updates"), "updates", "guild-1");

  assert.deepEqual(calls[0][0], { _id: "guild-1" });
  assert.deepEqual(calls[0][1], { $set: { notificationRoleId: "role-1" } });
  assert.deepEqual(calls[0][2], { upsert: true });
  assert.deepEqual(calls[1], ["invalidate", "guild-1"]);
  assert.equal(replies[0], "OK: Rol pentru update-uri: <@&role-1> *(ping doar la prima notificare per ciclu)*");
});

test("role ping factory clears /set role discounts when role is omitted", async () => {
  const calls: any[] = [];
  const replies: any[] = [];
  const handlers = rolePingInteractions.createRolePingInteractionHandlers(makeBaseContext(calls, replies));

  await handlers.handleSetRole(makeSetRoleInteraction("discounts", null), "discounts", "guild-1");

  assert.deepEqual(calls[0][0], { _id: "guild-1" });
  assert.deepEqual(calls[0][1], { $set: { discountRoleId: null } });
  assert.deepEqual(calls[1], ["invalidate", "guild-1"]);
  assert.equal(replies[0], "OK: Rol pentru reduceri eliminat (fara ping).");
});

test("role ping installer intercepts only /set role commands", async () => {
  const calls: any[] = [];
  const replies: any[] = [];
  const delegated: string[] = [];
  const ctx: Record<string, any> = makeBaseContext(calls, replies);
  ctx.handleInteraction = async (interaction: Record<string, any>) => {
    delegated.push(interaction.commandName);
    return "delegated";
  };

  rolePingInteractions(ctx);
  await ctx.handleInteraction(makeSetRoleInteraction("updates"), []);
  const result = await ctx.handleInteraction({
    commandName: "latest",
    guild: { id: "guild-1" },
    isChatInputCommand: () => true,
    options: { getSubcommandGroup: () => null }
  }, []);

  assert.deepEqual(calls[0][1], { $set: { notificationRoleId: "role-1" } });
  assert.equal(replies[0], "OK: Rol pentru update-uri: <@&role-1> *(ping doar la prima notificare per ciclu)*");
  assert.deepEqual(delegated, ["latest"]);
  assert.equal(result, "delegated");
});
