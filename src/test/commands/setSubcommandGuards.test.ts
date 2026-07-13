import test from "node:test";
import { installCommandChain, type ChainableCommandModule } from "../commandChainTestKit.js";
import assert from "node:assert/strict";

import installSetHandler from "../../features/command-handlers/setInteractionHandler.js";
import installGameFilterHandlers from "../../features/command-handlers/gameFilterHandlers.js";
import installRolePingHandlers from "../../features/command-handlers/rolePingHandlers.js";

type InteractionRuntime = {
  handleInteraction: (interaction: unknown, games?: Array<Record<string, unknown>>) => Promise<unknown>;
};
type SetUpdate = { $set: Record<string, unknown> };

function makeContext(replies: unknown[], mongoCalls: unknown[][]) {
  const context = {
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
    handleInteraction: async (_interaction?: unknown, _games?: Array<Record<string, unknown>>) => {  }
  };

  installCommandChain(context, [installGameFilterHandlers, installRolePingHandlers, installSetHandler] as object as ChainableCommandModule[]);
  return context as typeof context & InteractionRuntime;
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
  const replies: unknown[] = [];
  const mongoCalls: unknown[][] = [];
  const context = makeContext(replies, mongoCalls);

  await context.handleInteraction(
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
  const replies: unknown[] = [];
  const mongoCalls: unknown[][] = [];
  const context = makeContext(replies, mongoCalls);

  await context.handleInteraction(
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
  const replies: unknown[] = [];
  const mongoCalls: unknown[][] = [];
  const context = makeContext(replies, mongoCalls);

  await context.handleInteraction(
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
  const context = makeContext(replies, mongoCalls);

  await context.handleInteraction(
    makeSetInteraction({
      group: "role",
      sub: "updates",
      optionGetter: (name, type) => type === "role" ? { id: "role-42" } : null
    }),
    []
  );

  assert.equal(mongoCalls.length, 1, "set role updates must still write");
  const [filter, update] = mongoCalls[0] as [Record<string, unknown>, SetUpdate];
  assert.deepEqual(filter, { _id: "guild-1" });
  assert.equal(update.$set.notificationRoleId, "role-42");
  assert.match(String(replies[0]), /Rol pentru update-uri:/);
});

test("/set mode rejects null/unknown values instead of persisting null", async () => {
  const replies: unknown[] = [];
  const mongoCalls: unknown[][] = [];
  const context = makeContext(replies, mongoCalls);

  await context.handleInteraction(
    makeSetInteraction({ group: null, sub: "mode", optionGetter: () => null }),
    []
  );
  assert.equal(mongoCalls.length, 0, "no write on null mode");
  assert.match(String(replies[0]), /accepta doar `compact` sau `detailed`/);

  replies.length = 0;
  await context.handleInteraction(
    makeSetInteraction({ group: null, sub: "mode", optionGetter: () => "future-mode" }),
    []
  );
  assert.equal(mongoCalls.length, 0, "no write on unknown mode value");
  assert.match(String(replies[0]), /accepta doar `compact` sau `detailed`/);
});

test("/set mindiscount rejects null and out-of-range integers", async () => {
  const replies: unknown[] = [];
  const mongoCalls: unknown[][] = [];
  const context = makeContext(replies, mongoCalls);

  for (const value of [null, -1, 101, NaN]) {
    replies.length = 0;
    await context.handleInteraction(
      makeSetInteraction({ group: null, sub: "mindiscount", optionGetter: () => value }),
      []
    );
    assert.match(String(replies[0]), /intreg intre 0 si 100/, `value=${value} trebuie respinsa`);
  }
  assert.equal(mongoCalls.length, 0, "no write on invalid mindiscount");

  await context.handleInteraction(
    makeSetInteraction({ group: null, sub: "mindiscount", optionGetter: () => 50 }),
    []
  );
  assert.equal(mongoCalls.length, 1, "mindiscount=50 trebuie persistat");
});

test("/set maxprice rejects null and out-of-range integers", async () => {
  const replies: unknown[] = [];
  const mongoCalls: unknown[][] = [];
  const context = makeContext(replies, mongoCalls);

  for (const value of [null, -5, 10001]) {
    replies.length = 0;
    await context.handleInteraction(
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
  const context = makeContext(replies, mongoCalls);

  for (const value of [null, "", "XYZ", "usd"]) {
    replies.length = 0;
    await context.handleInteraction(
      makeSetInteraction({ group: null, sub: "currency", optionGetter: () => value }),
      []
    );
    assert.match(String(replies[0]), /USD, EUR, GBP, RON/, `value=${JSON.stringify(value)} trebuie respinsa`);
  }
  assert.equal(mongoCalls.length, 0, "no write on invalid currency");

  await context.handleInteraction(
    makeSetInteraction({ group: null, sub: "currency", optionGetter: () => "EUR" }),
    []
  );
  assert.equal(mongoCalls.length, 1, "currency=EUR trebuie persistat");
  const [, update] = mongoCalls[0] as [unknown, SetUpdate];
  assert.equal(update.$set.currency, "EUR");
});

test("/set free rejects null/invalid values instead of mis-reporting them", async () => {
  const replies: unknown[] = [];
  const mongoCalls: unknown[][] = [];
  const context = makeContext(replies, mongoCalls);

  for (const value of [null, "", "maybe", "ON"]) {
    replies.length = 0;
    await context.handleInteraction(
      makeSetInteraction({ group: null, sub: "free", optionGetter: () => value }),
      []
    );
    assert.match(String(replies[0]), /`free` accepta doar `on` sau `off`/, `value=${JSON.stringify(value)} trebuie respinsa`);
  }
  assert.equal(mongoCalls.length, 0, "no write on invalid free");

  for (const [value, expected] of [["on", true], ["off", false]] as Array<[string, boolean]>) {
    mongoCalls.length = 0;
    await context.handleInteraction(
      makeSetInteraction({ group: null, sub: "free", optionGetter: () => value }),
      []
    );
    assert.equal(mongoCalls.length, 1, `free=${value} trebuie persistat`);
    const [, update] = mongoCalls[0] as [unknown, SetUpdate];
    assert.equal(update.$set.includeFreeGames, expected, `free=${value} -> includeFreeGames=${expected}`);
  }
});

test("/set paid rejects null/invalid values instead of mis-reporting them", async () => {
  const replies: unknown[] = [];
  const mongoCalls: unknown[][] = [];
  const context = makeContext(replies, mongoCalls);

  for (const value of [null, "", "maybe", "OFF"]) {
    replies.length = 0;
    await context.handleInteraction(
      makeSetInteraction({ group: null, sub: "paid", optionGetter: () => value }),
      []
    );
    assert.match(String(replies[0]), /`paid` accepta doar `on` sau `off`/, `value=${JSON.stringify(value)} trebuie respinsa`);
  }
  assert.equal(mongoCalls.length, 0, "no write on invalid paid");

  for (const [value, expected] of [["on", true], ["off", false]] as Array<[string, boolean]>) {
    mongoCalls.length = 0;
    await context.handleInteraction(
      makeSetInteraction({ group: null, sub: "paid", optionGetter: () => value }),
      []
    );
    assert.equal(mongoCalls.length, 1, `paid=${value} trebuie persistat`);
    const [, update] = mongoCalls[0] as [unknown, SetUpdate];
    assert.equal(update.$set.includePaidDiscounts, expected, `paid=${value} -> includePaidDiscounts=${expected}`);
  }
});
