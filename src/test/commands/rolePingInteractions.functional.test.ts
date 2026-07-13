import test from "node:test";
import { installCommandChain, type ChainableCommandModule } from "../commandChainTestKit.js";
import assert from "node:assert/strict";

type RolePingModule = ChainableCommandModule & {
  createRolePingInteractionHandlers: (deps: Record<string, unknown>) => {
    handleSetRole: (interaction: Record<string, unknown>, sub: string, guildId: string) => Promise<unknown>;
    handleSetRoleInteraction: (interaction: Record<string, unknown>) => Promise<unknown>;
  };
};

import rolePingInteractionsModule from "../../features/command-handlers/rolePingHandlers.js";
const rolePingInteractions = rolePingInteractionsModule as object as RolePingModule;

type InteractionRuntime = {
  handleInteraction: (interaction: unknown, games?: unknown[]) => Promise<unknown>;
};
type MongoCall = unknown[];

function makeSetRoleInteraction(sub: string, role: Record<string, unknown> | null = { id: "role-1" }) {
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

function makeBaseContext(calls: MongoCall[], replies: unknown[]) {
  return {
    MessageFlags: { Ephemeral: 64 },
    GuildModel: {
      updateOne: async (...args: unknown[]) => {
        calls.push(args);
        return { matchedCount: 1, modifiedCount: 1 };
      }
    },
    logger: (_level: string, _context: string, ..._args: unknown[]) => undefined,
    safeDefer: async (interaction: Record<string, unknown>) => { interaction.deferred = true; },
    safeEdit: async (_interaction: unknown, payload: unknown) => { replies.push(payload); return payload; },
    formatUserError: (_err: unknown, fallback: string) => fallback
  };
}

test("role ping factory writes /set role updates through explicit deps", async () => {
  const calls: MongoCall[] = [];
  const replies: unknown[] = [];
  const handlers = rolePingInteractions.createRolePingInteractionHandlers(makeBaseContext(calls, replies));

  await handlers.handleSetRole(makeSetRoleInteraction("updates"), "updates", "guild-1");

  assert.deepEqual(calls[0][0], { _id: "guild-1" });
  assert.deepEqual(calls[0][1], { $set: { notificationRoleId: "role-1" } });
  assert.deepEqual(calls[0][2], { upsert: true });
  assert.equal(replies[0], "OK: Rol pentru update-uri: <@&role-1> *(ping doar la prima notificare per ciclu)*");
});

test("role ping factory clears /set role discounts when role is omitted", async () => {
  const calls: MongoCall[] = [];
  const replies: unknown[] = [];
  const handlers = rolePingInteractions.createRolePingInteractionHandlers(makeBaseContext(calls, replies));

  await handlers.handleSetRole(makeSetRoleInteraction("discounts", null), "discounts", "guild-1");

  assert.deepEqual(calls[0][0], { _id: "guild-1" });
  assert.deepEqual(calls[0][1], { $set: { discountRoleId: null } });
  assert.equal(replies[0], "OK: Rol pentru reduceri eliminat (fara ping).");
});

test("role ping rejects unknown sub-commands instead of silently defaulting to discountRoleId", async () => {
  const calls: MongoCall[] = [];
  const replies: unknown[] = [];
  const logs: Array<[string, string, ...unknown[]]> = [];
  const context = makeBaseContext(calls, replies);
  const loggingContext = context as typeof context & { logger: (...args: [string, string, ...unknown[]]) => void };
  loggingContext.logger = (...args: [string, string, ...unknown[]]) => { logs.push(args); };
  const handlers = rolePingInteractions.createRolePingInteractionHandlers(loggingContext);

  await handlers.handleSetRole(makeSetRoleInteraction("typo-not-real"), "typo-not-real", "guild-1");

  assert.equal(calls.length, 0,
    "no DB write must happen for an unknown sub — old code silently $set discountRoleId");
  assert.equal(replies.length, 1);
  assert.match(String(replies[0]), /typo-not-real.*nu este recunoscuta/);
  assert.ok(logs.some(([level, context]) => level === "WARN" && context === "SET_ROLE"),
    "must emit a WARN log so operators see the rejected sub");
});

test("role ping installer intercepts only /set role commands", async () => {
  const calls: MongoCall[] = [];
  const replies: unknown[] = [];
  const delegated: string[] = [];
  const context = makeBaseContext(calls, replies);
  const runtimeContext = context as typeof context & Partial<InteractionRuntime>;
  runtimeContext.handleInteraction = async (interaction: unknown) => {
    delegated.push((interaction as { commandName: string }).commandName);
    return "delegated";
  };

  installCommandChain(runtimeContext, [rolePingInteractions] as object as ChainableCommandModule[]);
  const runtime = runtimeContext as typeof context & InteractionRuntime;
  await runtime.handleInteraction(makeSetRoleInteraction("updates"), []);
  const result = await runtime.handleInteraction({
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
