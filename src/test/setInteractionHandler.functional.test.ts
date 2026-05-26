import test from "node:test";
import assert from "node:assert/strict";

// V12: handler /set extras intr-o factory tipata. Verificam ca:
// 1. Intercepteaza sub-comenzile directe (mode, mindiscount, maxprice, free,
//    paid, currency, stores) — scrie Mongo + raspunde user-ului.
// 2. Deleagheaza `/set games *` si `/set role *` mai jos in chain (intercepted
//    earlier in commandRegistry).
// 3. Sub-comenzi necunoscute primesc reply explicit fara $set: {} in Mongo.
// 4. Validarile noi (mode/mindiscount/maxprice/currency) raman in factory.

const installSetHandler = require("../features/command-handlers/setInteractionHandler") as
  ((ctx: Record<string, any>) => void) & { createSetInteractionHandler?: (deps: any) => any };

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

function makeCtx(opts: {
  prevDelegated?: (interaction: any, games: any[]) => Promise<unknown>;
  updateOneResult?: { matchedCount: number; modifiedCount: number };
  updateOneThrows?: Error;
}) {
  const updateCalls: Array<{ filter: unknown; update: unknown; opts?: unknown }> = [];
  const replies: string[] = [];
  const delegateCalls: Array<{ commandName: string }> = [];
  const cacheInvalidations: string[] = [];
  const logs: Array<{ level: string; ctx: string; msg: string }> = [];

  const ctx: Record<string, any> = {
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
    safeEdit: async (_interaction: any, content: string) => { replies.push(content); return content; },
    logger: (level: string, c: string, msg: string) => { logs.push({ level, ctx: c, msg }); },
    SUPPORTED_CURRENCIES: { USD: {}, EUR: {}, GBP: {}, RON: {} },
    MessageFlags: { Ephemeral: 64 },
    handleInteraction: opts.prevDelegated || (async (interaction: any) => {
      delegateCalls.push({ commandName: interaction.commandName });
    })
  };

  installSetHandler(ctx);
  return { ctx, updateCalls, replies, delegateCalls, cacheInvalidations, logs };
}

test("handles /set mode and writes notificationMode + confirms", async () => {
  const { ctx, updateCalls, replies, cacheInvalidations, delegateCalls } = makeCtx({});
  await ctx.handleInteraction(
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
  const { ctx, updateCalls, replies } = makeCtx({});
  await ctx.handleInteraction(
    makeInteraction({ command: "set", group: null, sub: "mindiscount", integer: { value: 50 } }),
    []
  );
  assert.equal(updateCalls.length, 1);
  const update = (updateCalls[0].update as { $set: Record<string, unknown> }).$set;
  assert.equal(update.minDiscountPercent, 50);
  assert.deepEqual(update.pendingDiscounts, [], "filter change reseteaza pendingDiscounts");

  // Out-of-range respins
  await ctx.handleInteraction(
    makeInteraction({ command: "set", group: null, sub: "mindiscount", integer: { value: 150 } }),
    []
  );
  assert.equal(updateCalls.length, 1, "nu trebuie scriere pe valoare invalida");
  assert.match(replies[1], /intre 0 si 100/);
});

test("handles /set currency with USD and rejects unknown codes", async () => {
  const { ctx, updateCalls, replies } = makeCtx({});
  await ctx.handleInteraction(
    makeInteraction({ command: "set", group: null, sub: "currency", string: { value: "EUR" } }),
    []
  );
  assert.equal(updateCalls.length, 1);
  const update = (updateCalls[0].update as { $set: Record<string, unknown> }).$set;
  assert.equal(update.currency, "EUR");

  await ctx.handleInteraction(
    makeInteraction({ command: "set", group: null, sub: "currency", string: { value: "XYZ" } }),
    []
  );
  assert.equal(updateCalls.length, 1, "nu trebuie scriere pe currency necunoscut");
  assert.match(replies[1], /USD, EUR, GBP, RON/);
});

test("handles /set stores with steam,epic + rejects unknown store", async () => {
  const { ctx, updateCalls, replies } = makeCtx({});
  await ctx.handleInteraction(
    makeInteraction({ command: "set", group: null, sub: "stores", string: { value: "steam,epic" } }),
    []
  );
  assert.equal(updateCalls.length, 1);
  const update = (updateCalls[0].update as { $set: Record<string, unknown> }).$set;
  assert.deepEqual(update.enabledStores, ["Steam", "Epic Games"]);

  await ctx.handleInteraction(
    makeInteraction({ command: "set", group: null, sub: "stores", string: { value: "gog" } }),
    []
  );
  assert.equal(updateCalls.length, 1, "nu trebuie scriere pe store necunoscut");
  assert.match(replies[1], /Store necunoscut/);
});

test("unknown sub returns explicit reply without empty $set write", async () => {
  // V11 regression guard pastrat in noul handler.
  const { ctx, updateCalls, replies, logs } = makeCtx({});
  await ctx.handleInteraction(
    makeInteraction({ command: "set", group: null, sub: "future-feature" }),
    []
  );
  assert.equal(updateCalls.length, 0);
  assert.match(replies[0], /nu este recunoscuta/);
  assert.ok(logs.some(l => l.level === "WARN" && l.ctx === "SET_COMMAND"));
});

test("delegates `/set games *` and `/set role *` to next handler (intercepted earlier in chain)", async () => {
  // V12: install order plaseaza setInteractionHandler DUPA gameFilterHandlers
  // si rolePingHandlers. La runtime (reverse order), routing-ul curge prin
  // setHandler care DELEGEAZA grupurile games/role mai jos, iar acolo sunt
  // intercepted. In test simulam asta verificand ca grupurile sunt delegate
  // si NU sunt scrise direct.
  const { ctx, updateCalls, delegateCalls } = makeCtx({});

  await ctx.handleInteraction(
    makeInteraction({ command: "set", group: "games", sub: "add", string: { joc: "cs2" } }),
    []
  );
  assert.equal(updateCalls.length, 0, "set games * NU trebuie scris de setInteractionHandler");
  assert.equal(delegateCalls.length, 1);

  await ctx.handleInteraction(
    makeInteraction({ command: "set", group: "role", sub: "updates" }),
    []
  );
  assert.equal(updateCalls.length, 0, "set role * NU trebuie scris de setInteractionHandler");
  assert.equal(delegateCalls.length, 2);
});

test("delegates non-/set commands to next handler", async () => {
  const { ctx, updateCalls, delegateCalls } = makeCtx({});
  await ctx.handleInteraction(
    makeInteraction({ command: "ping", group: null, sub: "" }),
    []
  );
  assert.equal(updateCalls.length, 0);
  assert.equal(delegateCalls.length, 1);
  assert.equal(delegateCalls[0].commandName, "ping");
});

test("Mongo updateOne failure surfaces via formatUserError", async () => {
  const { ctx, replies, logs } = makeCtx({
    updateOneThrows: new Error("simulated mongo write failure")
  });
  await ctx.handleInteraction(
    makeInteraction({ command: "set", group: null, sub: "mode", string: { value: "compact" } }),
    []
  );
  assert.match(replies[0], /Eroare la salvarea preferintelor/);
  assert.ok(logs.some(l => l.level === "WARN" && /salvarea preferintelor/.test(l.msg)));
});
