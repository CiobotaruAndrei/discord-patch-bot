import test from "node:test";
import assert from "node:assert/strict";

const installSetHandler = require("../features/command-handlers/setInteractionHandler") as
  ((context: Record<string, unknown>) => void) & { createSetInteractionHandler?: (deps: unknown) => unknown };

type SetInteractionRuntime = {
  handleInteraction: (interaction: unknown, games?: unknown[]) => Promise<unknown>;
};

function makeOptions(opts: {
  group: string | null;
  sub: string;
  string?: Record<string, string | null>;
  integer?: Record<string, number | null>;
}) {
  return {
    getSubcommandGroup: () => opts.group,
    getSubcommand: () => opts.sub,
    getString: (name: string) => opts.string?.[name] ?? null,
    getInteger: (name: string) => opts.integer?.[name] ?? null
  };
}

function makeInteraction(opts: {
  command: string;
  group: string | null;
  sub: string;
  string?: Record<string, string | null>;
  integer?: Record<string, number | null>;
}) {
  return {
    commandName: opts.command,
    guild: { id: "guild-1" },
    options: makeOptions(opts),
    isChatInputCommand: () => true,
    deferred: false,
    replied: false,
    reply: async () => undefined,
    followUp: async () => undefined
  };
}

function makeContext(opts: {
  prevDelegated?: (interaction: unknown, games: unknown[]) => Promise<unknown>;
  updateOneResult?: { matchedCount: number; modifiedCount: number };
  updateOneThrows?: Error;
  guildSettings?: { notificationChannelId?: string | null; discountChannelId?: string | null };
  readHistory?: (channelId: string) => boolean | null;
}) {
  const updateCalls: Array<{ filter: unknown; update: unknown; opts?: unknown }> = [];
  const replies: string[] = [];
  const delegateCalls: Array<{ commandName: string }> = [];
  const cacheInvalidations: string[] = [];
  const logs: Array<{ level: string; context: string; msg: string }> = [];

  const context = {
    GuildModel: {
      updateOne: async (filter: unknown, update: unknown, options?: unknown) => {
        updateCalls.push({ filter, update, opts: options });
        if (opts.updateOneThrows) throw opts.updateOneThrows;
        return opts.updateOneResult ?? { matchedCount: 1, modifiedCount: 1 };
      }
    },
    invalidateGuildCache: (gid: string) => { cacheInvalidations.push(gid); },
    formatUserError: (_err: unknown, fallback: string) => fallback,
    safeDefer: async () => undefined,
    safeEdit: async (_interaction: unknown, content: string) => { replies.push(content); return content; },
    logger: (level: string, c: string, msg: string) => { logs.push({ level, context: c, msg }); },
    SUPPORTED_CURRENCIES: { USD: {}, EUR: {}, GBP: {}, RON: {} },
    MessageFlags: { Ephemeral: 64 },
    getGuildSettings: async () => opts.guildSettings ?? null,
    checkReadMessageHistory: async (_interaction: unknown, channelId: string) => (opts.readHistory ? opts.readHistory(channelId) : null),
    handleInteraction: opts.prevDelegated || (async (interaction: unknown) => {
      delegateCalls.push({ commandName: (interaction as { commandName: string }).commandName });
    })
  };

  installSetHandler(context);
  return { context: context as typeof context & SetInteractionRuntime, updateCalls, replies, delegateCalls, cacheInvalidations, logs };
}

test("handles /set mode and writes notificationMode + confirms", async () => {
  const { context, updateCalls, replies, cacheInvalidations, delegateCalls } = makeContext({});
  await context.handleInteraction(
    makeInteraction({ command: "set", group: null, sub: "mode", string: { value: "detailed" } }),
    []
  );
  assert.equal(updateCalls.length, 1);
  const update = (updateCalls[0].update as { $set: Record<string, unknown> }).$set;
  assert.equal(update.notificationMode, "detailed");
  assert.deepEqual(updateCalls[0].filter, { _id: "guild-1" });
  assert.equal(cacheInvalidations[0], "guild-1");
  assert.match(replies[0], /Mod setat: \*\*detailed\*\*/);
  assert.equal(delegateCalls.length, 0, "nu trebuie sa delegheze mai jos");
});

test("handles /set mindiscount with valid 50 and rejects out-of-range", async () => {
  const { context, updateCalls, replies } = makeContext({});
  await context.handleInteraction(
    makeInteraction({ command: "set", group: null, sub: "mindiscount", integer: { value: 50 } }),
    []
  );
  assert.equal(updateCalls.length, 1);
  const update = (updateCalls[0].update as { $set: Record<string, unknown> }).$set;
  assert.equal(update.minDiscountPercent, 50);
  assert.deepEqual(update.pendingDiscounts, [], "filter change reseteaza pendingDiscounts");

  await context.handleInteraction(
    makeInteraction({ command: "set", group: null, sub: "mindiscount", integer: { value: 150 } }),
    []
  );
  assert.equal(updateCalls.length, 1, "nu trebuie scriere pe valoare invalida");
  assert.match(replies[1], /intre 0 si 100/);
});

test("handles /set currency with USD and rejects unknown codes", async () => {
  const { context, updateCalls, replies } = makeContext({});
  await context.handleInteraction(
    makeInteraction({ command: "set", group: null, sub: "currency", string: { value: "EUR" } }),
    []
  );
  assert.equal(updateCalls.length, 1);
  const update = (updateCalls[0].update as { $set: Record<string, unknown> }).$set;
  assert.equal(update.currency, "EUR");

  await context.handleInteraction(
    makeInteraction({ command: "set", group: null, sub: "currency", string: { value: "XYZ" } }),
    []
  );
  assert.equal(updateCalls.length, 1, "nu trebuie scriere pe currency necunoscut");
  assert.match(replies[1], /USD, EUR, GBP, RON/);
});

test("handles /set stores with steam,epic + rejects unknown store", async () => {
  const { context, updateCalls, replies } = makeContext({});
  await context.handleInteraction(
    makeInteraction({ command: "set", group: null, sub: "stores", string: { value: "steam,epic" } }),
    []
  );
  assert.equal(updateCalls.length, 1);
  const update = (updateCalls[0].update as { $set: Record<string, unknown> }).$set;
  assert.deepEqual(update.enabledStores, ["Steam", "Epic Games"]);

  await context.handleInteraction(
    makeInteraction({ command: "set", group: null, sub: "stores", string: { value: "gog" } }),
    []
  );
  assert.equal(updateCalls.length, 1, "nu trebuie scriere pe store necunoscut");
  assert.match(replies[1], /Store necunoscut/);
});

test("handles /set outbox-recovery-verify on -> writes boolean true, no pending reset", async () => {
  const { context, updateCalls, replies, cacheInvalidations } = makeContext({});
  await context.handleInteraction(
    makeInteraction({ command: "set", group: null, sub: "outbox-recovery-verify", string: { value: "on" } }),
    []
  );
  assert.equal(updateCalls.length, 1);
  const update = (updateCalls[0].update as { $set: Record<string, unknown> }).$set;
  assert.equal(update.outboxRecoveryVerify, true);
  assert.equal("pendingDiscounts" in update, false, "nu e filter change -> nu reseteaza pendingDiscounts");
  assert.equal(cacheInvalidations[0], "guild-1");
  assert.match(replies[0], /ON/);
});

test("/set outbox-recovery-verify on warns when bot lacks Read Message History on the channel", async () => {
  const { context, replies } = makeContext({
    guildSettings: { notificationChannelId: "chan-1" },
    readHistory: () => false
  });
  await context.handleInteraction(
    makeInteraction({ command: "set", group: null, sub: "outbox-recovery-verify", string: { value: "on" } }),
    []
  );
  assert.match(replies[0], /ON/);
  assert.match(replies[0], /Read Message History/);
  assert.match(replies[0], /<#chan-1>/);
});

test("/set outbox-recovery-verify on does not warn when permission is present", async () => {
  const { context, replies } = makeContext({
    guildSettings: { notificationChannelId: "chan-1" },
    readHistory: () => true
  });
  await context.handleInteraction(
    makeInteraction({ command: "set", group: null, sub: "outbox-recovery-verify", string: { value: "on" } }),
    []
  );
  assert.match(replies[0], /ON/);
  assert.equal(/Read Message History/.test(replies[0]), false, "permisiune prezenta -> fara avertisment");
});

test("/set outbox-recovery-verify off never runs the permission check", async () => {
  let checked = 0;
  const { context, replies } = makeContext({
    guildSettings: { notificationChannelId: "chan-1" },
    readHistory: () => { checked++; return false; }
  });
  await context.handleInteraction(
    makeInteraction({ command: "set", group: null, sub: "outbox-recovery-verify", string: { value: "off" } }),
    []
  );
  assert.match(replies[0], /OFF/);
  assert.equal(checked, 0, "la off nu se verifica permisiunea");
});

test("handles /set outbox-recovery-verify off -> writes boolean false", async () => {
  const { context, updateCalls, replies } = makeContext({});
  await context.handleInteraction(
    makeInteraction({ command: "set", group: null, sub: "outbox-recovery-verify", string: { value: "off" } }),
    []
  );
  assert.equal(updateCalls.length, 1);
  const update = (updateCalls[0].update as { $set: Record<string, unknown> }).$set;
  assert.equal(update.outboxRecoveryVerify, false);
  assert.match(replies[0], /OFF/);
});

test("rejects /set outbox-recovery-verify with invalid value without writing", async () => {
  const { context, updateCalls, replies } = makeContext({});
  await context.handleInteraction(
    makeInteraction({ command: "set", group: null, sub: "outbox-recovery-verify", string: { value: "maybe" } }),
    []
  );
  assert.equal(updateCalls.length, 0, "valoare invalida -> nicio scriere");
  assert.match(replies[0], /doar `on` sau `off`/);
});

test("unknown sub returns explicit reply without empty $set write", async () => {
  const { context, updateCalls, replies, logs } = makeContext({});
  await context.handleInteraction(
    makeInteraction({ command: "set", group: null, sub: "future-feature" }),
    []
  );
  assert.equal(updateCalls.length, 0);
  assert.match(replies[0], /nu este recunoscuta/);
  assert.ok(logs.some(l => l.level === "WARN" && l.context === "SET_COMMAND"));
});

test("delegates `/set games *` and `/set role *` to next handler (intercepted earlier in chain)", async () => {
  const { context, updateCalls, delegateCalls } = makeContext({});

  await context.handleInteraction(
    makeInteraction({ command: "set", group: "games", sub: "add", string: { joc: "cs2" } }),
    []
  );
  assert.equal(updateCalls.length, 0, "set games * NU trebuie scris de setInteractionHandler");
  assert.equal(delegateCalls.length, 1);

  await context.handleInteraction(
    makeInteraction({ command: "set", group: "role", sub: "updates" }),
    []
  );
  assert.equal(updateCalls.length, 0, "set role * NU trebuie scris de setInteractionHandler");
  assert.equal(delegateCalls.length, 2);
});

test("delegates non-/set commands to next handler", async () => {
  const { context, updateCalls, delegateCalls } = makeContext({});
  await context.handleInteraction(
    makeInteraction({ command: "ping", group: null, sub: "" }),
    []
  );
  assert.equal(updateCalls.length, 0);
  assert.equal(delegateCalls.length, 1);
  assert.equal(delegateCalls[0].commandName, "ping");
});

test("Mongo updateOne failure surfaces via formatUserError", async () => {
  const { context, replies, logs } = makeContext({
    updateOneThrows: new Error("simulated mongo write failure")
  });
  await context.handleInteraction(
    makeInteraction({ command: "set", group: null, sub: "mode", string: { value: "compact" } }),
    []
  );
  assert.match(replies[0], /Eroare la salvarea preferintelor/);
  assert.ok(logs.some(l => l.level === "WARN" && /salvarea preferintelor/.test(l.msg)));
});
