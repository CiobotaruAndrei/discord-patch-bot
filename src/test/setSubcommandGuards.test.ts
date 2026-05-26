import test from "node:test";
import assert from "node:assert/strict";

// V12: dupa retragerea legacy router, testele NU mai pot apela
// `ctx.handleSetInteraction(...)` direct (acea functie nu mai exista pe ctx).
// In schimb instalam aceleasi handlers ca productiunea si testam prin
// `ctx.handleInteraction(interaction, games)` — exact flow-ul real al
// chain-ului wrapper.

const installSetHandler = require("../features/command-handlers/setInteractionHandler") as (ctx: Record<string, any>) => void;
const installGameFilterHandlers = require("../features/command-handlers/gameFilterHandlers") as (ctx: Record<string, any>) => void;
const installRolePingHandlers = require("../features/command-handlers/rolePingHandlers") as (ctx: Record<string, any>) => void;

function makeCtx(replies: unknown[], mongoCalls: unknown[][]) {
  const ctx: Record<string, any> = {
    MessageFlags: { Ephemeral: 64 },
    logger: () => undefined,
    DEFAULT_CURRENCY: "USD",
    SUPPORTED_CURRENCIES: { USD: {}, EUR: {}, GBP: {}, RON: {} },
    GuildModel: {
      updateOne: async (...args: unknown[]) => {
        mongoCalls.push(args);
        return { matchedCount: 1, modifiedCount: 1 };
      }
    },
    invalidateGuildCache: () => undefined,
    getGuildSettings: async () => null,
    safeDefer: async () => undefined,
    safeEdit: async (_interaction: unknown, payload: unknown) => { replies.push(payload); return payload; },
    formatUserError: (_err: unknown, fallback: string) => fallback,
    handleInteraction: async () => { /* bottom of chain — unknown command */ }
  };
  // Install order matches commandRegistry.ts (gameFilterHandlers first, then
  // rolePingHandlers, then setInteractionHandler — runtime order is reversed,
  // so setInteractionHandler intercepts /set with group=null, role intercepts
  // group=role, games intercepts group=games).
  installGameFilterHandlers(ctx);
  installRolePingHandlers(ctx);
  installSetHandler(ctx);
  return ctx;
}

function makeSetInteraction(opts: {
  group: string | null;
  sub: string;
  optionGetter?: (name: string, type: "string" | "integer" | "role") => unknown;
}) {
  return {
    commandName: "set",
    guild: { id: "guild-1" },
    isChatInputCommand: () => true,
    options: {
      getSubcommandGroup: () => opts.group,
      getSubcommand: () => opts.sub,
      getString: (name: string) => opts.optionGetter?.(name, "string") ?? null,
      getInteger: (name: string) => opts.optionGetter?.(name, "integer") ?? null,
      getRole: (name: string) => opts.optionGetter?.(name, "role") ?? null
    },
    deferred: false,
    replied: false,
    reply: async () => undefined,
    followUp: async () => undefined
  };
}

test("/set with unknown sub returns an error instead of writing empty $set", async () => {
  // V11/V12 regression guard: previously this would call
  // `GuildModel.updateOne({_id}, { $set: {} }, { upsert: true })` and on a
  // new guild would create an empty document with only `_id`.
  const replies: unknown[] = [];
  const mongoCalls: unknown[][] = [];
  const ctx = makeCtx(replies, mongoCalls);

  await ctx.handleInteraction(
    makeSetInteraction({ group: null, sub: "future-feature" }),
    []
  );

  assert.equal(mongoCalls.length, 0, "no Mongo write must happen for an unknown /set sub");
  assert.equal(replies.length, 1);
  assert.match(String(replies[0]),
    /Subcomanda `\/set future-feature` nu este recunoscuta/,
    "user should see a clear error naming the unknown sub");
});

test("/set games with unknown sub replies to the user instead of leaving the interaction hanging", async () => {
  // V11/V12 regression guard: the legacy router's handleSetGames used to drop
  // off the end of the function without calling safeEdit for an unknown sub —
  // user stayed on the deferReply loading state forever.
  const replies: unknown[] = [];
  const mongoCalls: unknown[][] = [];
  const ctx = makeCtx(replies, mongoCalls);

  await ctx.handleInteraction(
    makeSetInteraction({
      group: "games",
      sub: "experimental",
      optionGetter: (name) => name === "joc" ? "cs2" : null
    }),
    [{ key: "cs2", name: "Counter-Strike 2" }]
  );

  assert.equal(mongoCalls.length, 0, "no Mongo write must happen for an unknown /set games sub");
  assert.equal(replies.length, 1);
  assert.match(String(replies[0]),
    /Subcomanda `\/set games experimental` nu este recunoscuta/,
    "user should see a clear error naming the unknown sub");
});

test("/set role with unknown sub does not silently target discountRoleId", async () => {
  // V11/V12 regression guard: the old `sub === "updates" ? notificationRoleId :
  // discountRoleId` default meant ANY unknown sub silently wrote to
  // discountRoleId. Confusing and dangerous if a typo'd sub somehow reached
  // this branch.
  const replies: unknown[] = [];
  const mongoCalls: unknown[][] = [];
  const ctx = makeCtx(replies, mongoCalls);

  await ctx.handleInteraction(
    makeSetInteraction({
      group: "role",
      sub: "alerts",
      optionGetter: (name, type) => type === "role" ? { id: "role-999" } : null
    }),
    []
  );

  assert.equal(mongoCalls.length, 0, "no Mongo write must happen for an unknown /set role sub");
  assert.equal(replies.length, 1);
  assert.match(String(replies[0]),
    /Subcomanda `\/set role alerts` nu este recunoscuta/,
    "user should see a clear error naming the unknown sub");
});

test("/set role with known sub still works (regression for the new guard)", async () => {
  const replies: unknown[] = [];
  const mongoCalls: unknown[][] = [];
  const ctx = makeCtx(replies, mongoCalls);

  await ctx.handleInteraction(
    makeSetInteraction({
      group: "role",
      sub: "updates",
      optionGetter: (name, type) => type === "role" ? { id: "role-42" } : null
    }),
    []
  );

  assert.equal(mongoCalls.length, 1, "set role updates must still write");
  const [filter, update] = mongoCalls[0] as [Record<string, unknown>, Record<string, any>];
  assert.deepEqual(filter, { _id: "guild-1" });
  assert.equal(update.$set.notificationRoleId, "role-42");
  assert.match(String(replies[0]), /Rol pentru update-uri:/);
});

// V12: defensive null/range validation per subcomanda directa. Slash schema
// marcheaza optiunile ca required + min/max value, dar un payload manipulat
// (test manual API, client modificat) poate trimite null sau valori in afara
// range-ului. Inainte: persistam null sau valoarea outside-range si raspundeam
// user-ului cu mesaj fals "OK: ...: **null**" / "**150%**".

test("/set mode rejects null/unknown values instead of persisting null", async () => {
  const replies: unknown[] = [];
  const mongoCalls: unknown[][] = [];
  const ctx = makeCtx(replies, mongoCalls);

  await ctx.handleInteraction(
    makeSetInteraction({ group: null, sub: "mode", optionGetter: () => null }),
    []
  );
  assert.equal(mongoCalls.length, 0, "no write on null mode");
  assert.match(String(replies[0]), /accepta doar `compact` sau `detailed`/);

  replies.length = 0;
  await ctx.handleInteraction(
    makeSetInteraction({ group: null, sub: "mode", optionGetter: () => "future-mode" }),
    []
  );
  assert.equal(mongoCalls.length, 0, "no write on unknown mode value");
  assert.match(String(replies[0]), /accepta doar `compact` sau `detailed`/);
});

test("/set mindiscount rejects null and out-of-range integers", async () => {
  const replies: unknown[] = [];
  const mongoCalls: unknown[][] = [];
  const ctx = makeCtx(replies, mongoCalls);

  for (const value of [null, -1, 101, NaN]) {
    replies.length = 0;
    await ctx.handleInteraction(
      makeSetInteraction({ group: null, sub: "mindiscount", optionGetter: () => value }),
      []
    );
    assert.match(String(replies[0]), /intreg intre 0 si 100/, `value=${value} trebuie respinsa`);
  }
  assert.equal(mongoCalls.length, 0, "no write on invalid mindiscount");

  await ctx.handleInteraction(
    makeSetInteraction({ group: null, sub: "mindiscount", optionGetter: () => 50 }),
    []
  );
  assert.equal(mongoCalls.length, 1, "mindiscount=50 trebuie persistat");
});

test("/set maxprice rejects null and out-of-range integers", async () => {
  const replies: unknown[] = [];
  const mongoCalls: unknown[][] = [];
  const ctx = makeCtx(replies, mongoCalls);

  for (const value of [null, -5, 10001]) {
    replies.length = 0;
    await ctx.handleInteraction(
      makeSetInteraction({ group: null, sub: "maxprice", optionGetter: () => value }),
      []
    );
    assert.match(String(replies[0]), /intreg intre 0 si 10000/, `value=${value} trebuie respinsa`);
  }
  assert.equal(mongoCalls.length, 0, "no write on invalid maxprice");
});

test("/set currency rejects null and unsupported codes", async () => {
  const replies: unknown[] = [];
  const mongoCalls: unknown[][] = [];
  const ctx = makeCtx(replies, mongoCalls);

  for (const value of [null, "", "XYZ", "usd"]) {
    replies.length = 0;
    await ctx.handleInteraction(
      makeSetInteraction({ group: null, sub: "currency", optionGetter: () => value }),
      []
    );
    assert.match(String(replies[0]), /USD, EUR, GBP, RON/, `value=${JSON.stringify(value)} trebuie respinsa`);
  }
  assert.equal(mongoCalls.length, 0, "no write on invalid currency");

  await ctx.handleInteraction(
    makeSetInteraction({ group: null, sub: "currency", optionGetter: () => "EUR" }),
    []
  );
  assert.equal(mongoCalls.length, 1, "currency=EUR trebuie persistat");
  const [, update] = mongoCalls[0] as [unknown, Record<string, any>];
  assert.equal(update.$set.currency, "EUR");
});
