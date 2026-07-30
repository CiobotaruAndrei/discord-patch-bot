import test from "node:test";
import assert from "node:assert/strict";

import type { PriceAlertRule } from "../../features/notifications/notificationTypes.js";
import { isHandledCommandError } from "../../features/command-security/commandOutcome.js";

import mod from "../../features/command-handlers/priceAlertInteractionHandler.js";
import { PRICE_ALERT_MAX_THRESHOLD, PRICE_ALERT_MIN_THRESHOLD } from "../../features/notifications/priceAlertRepository.js";

type MongoCall = {
  filter: Record<string, unknown>;
  update: Record<string, unknown> | Array<Record<string, unknown>>;
  options?: Record<string, unknown>;
};

function ruleFromPipeline(update: unknown): Record<string, unknown> {
  const stage = (Array.isArray(update) ? update[0] : undefined) as { $set?: { priceAlerts?: { $let?: { in?: { $cond?: unknown[] } } } } } | undefined;
  const cond = stage?.$set?.priceAlerts?.$let?.in?.$cond as Array<{ $concatArrays?: unknown[] }> | undefined;
  const appended = cond?.[1]?.$concatArrays?.[1] as unknown[] | undefined;
  return (appended?.[0] as Record<string, unknown>) ?? {};
}

function makeHarness(settings: Record<string, unknown> = {}) {
  const calls: MongoCall[] = [];
  const replies: unknown[] = [];
  const existing = Array.isArray((settings as { priceAlerts?: unknown[] }).priceAlerts) ? (settings as { priceAlerts: unknown[] }).priceAlerts : [];
  const handler = mod.createPriceAlertInteractionHandler({
    GuildModel: {
      updateOne: async (filter, update, options) => {
        calls.push({ filter, update, options });
        return { matchedCount: 1, modifiedCount: 1 };
      },
      findOneAndUpdate: async (filter, update, options) => {
        calls.push({ filter, update, options });
        return { priceAlerts: [...existing, ruleFromPipeline(update)] } as { priceAlerts: PriceAlertRule[] };
      }
    },
    getGuildSettings: async () => ({ _id: "guild-1", ...settings }),
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload) => { replies.push(payload); return payload; },
    formatUserError: (_err, fallback) => fallback,
    SUPPORTED_CURRENCIES: { USD: {}, EUR: {}, GBP: {}, RON: {} },
    logger: () => undefined,
    MessageFlags: { Ephemeral: 64 }
  });
  return { handler, calls, replies };
}

function interaction(subcommand: string, values: { joc?: string; price?: number; currency?: string } = {}) {
  return {
    commandName: "price-alert",
    guild: { id: "guild-1" },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    options: {
      getSubcommand: () => subcommand,
      getString: (name: string) => {
        if (name === "joc") return values.joc || null;
        if (name === "currency") return values.currency || null;
        return null;
      },
      getNumber: (name: string) => name === "price" ? values.price ?? null : null
    },
    reply: async (payload: unknown) => payload,
    followUp: async (payload: unknown) => payload
  };
}

const games = [{
  key: "elden-ring",
  name: "Elden Ring",
  appId: "1245620",
  aliases: ["elden ring"]
}];

test("/price-alert add salveaza regula tipata si pastreaza o singura regula per joc+valuta", async () => {
  const { handler, calls, replies } = makeHarness({
    discountsSubscribed: true,
    discountChannelId: "deals-channel",
    priceAlerts: []
  });

  await handler.handlePriceAlertInteraction(
    interaction("add", { joc: "elden-ring", price: 30, currency: "EUR" }),
    games
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].filter, { _id: "guild-1" });
  assert.ok(Array.isArray(calls[0].update));
  const serialized = JSON.stringify(calls[0].update);
  assert.match(serialized, /priceAlerts/);
  assert.match(serialized, /elden-ring/);
  assert.match(serialized, /1245620/);
  assert.match(serialized, /EUR/);
  assert.deepEqual(calls[0].options, { upsert: true, returnDocument: "after" }, "findOneAndUpdate cu returnDocument:after ca handler-ul sa confirme din doc-ul actualizat");
  assert.match(JSON.stringify(replies[0]), /30 EUR/);
  assert.match(JSON.stringify(replies[0]), /deals-channel/);
});

test("/price-alert add: refuza un prag peste PRICE_ALERT_MAX_THRESHOLD fara sa scrie in Mongo (politica handler, audit #12)", async () => {
  const { handler, calls, replies } = makeHarness({ discountsSubscribed: true, discountChannelId: "deals", priceAlerts: [] });

  await handler.handlePriceAlertInteraction(
    interaction("add", { joc: "elden-ring", price: PRICE_ALERT_MAX_THRESHOLD + 1, currency: "EUR" }),
    games
  );

  assert.equal(calls.length, 0, "un prag peste politica nu ajunge in Mongo");
  assert.match(JSON.stringify(replies.at(-1)), new RegExp(`${PRICE_ALERT_MAX_THRESHOLD}`), "eroarea citeaza pragul maxim din politica");
});

test("/price-alert add: accepta pragul minim exact PRICE_ALERT_MIN_THRESHOLD (politica handler, audit #12)", async () => {
  const { handler, calls } = makeHarness({ discountsSubscribed: true, discountChannelId: "deals", priceAlerts: [] });

  await handler.handlePriceAlertInteraction(
    interaction("add", { joc: "elden-ring", price: PRICE_ALERT_MIN_THRESHOLD, currency: "EUR" }),
    games
  );

  assert.equal(calls.length, 1, "pragul minim exact este acceptat si scris");
});

test("/price-alert remove sterge toate valutele jocului", async () => {
  const { handler, calls, replies } = makeHarness();

  await handler.handlePriceAlertInteraction(
    interaction("remove", { joc: "elden-ring" }),
    games
  );

  assert.deepEqual(calls[0].update, { $pull: { priceAlerts: { gameKey: "elden-ring" } } });
  assert.match(JSON.stringify(replies[0]), /toate alertele de pret/);
});

test("/price-alert list afiseaza pragul si starea fiecarei alerte", async () => {
  const { handler, replies } = makeHarness({
    discountsSubscribed: true,
    discountChannelId: "deals",
    priceAlerts: [{
      gameKey: "elden-ring",
      gameName: "Elden Ring",
      threshold: 30,
      currency: "EUR",
      triggeredAt: null,
      lastObservedPrice: 49.99
    }]
  });

  await handler.handlePriceAlertInteraction(interaction("list"), games);

  assert.match(JSON.stringify(replies[0]), /Elden Ring/);
  assert.match(JSON.stringify(replies[0]), /30 EUR/);
  assert.match(JSON.stringify(replies[0]), /armata/);
  assert.match(JSON.stringify(replies[0]), /49.99 EUR/);
});

test("/price-alert list: o alerta ne-declansata e 'inactiva', nu 'armata', cand reducerile nu sunt pornite (audit 154 #8)", async () => {
  const alert = { gameKey: "elden-ring", gameName: "Elden Ring", threshold: 30, currency: "EUR", triggeredAt: null, lastObservedPrice: null };
  const dormant = makeHarness({ priceAlerts: [alert] });
  await dormant.handler.handlePriceAlertInteraction(interaction("list"), games);
  assert.match(JSON.stringify(dormant.replies[0]), /inactiva/, "fara canal activ, o alerta ne-declansata NU mai e numita 'armata'");
  assert.doesNotMatch(JSON.stringify(dormant.replies[0]), /- armata/, "starea per-alerta reflecta dormanta modulului");

  const active = makeHarness({ discountsSubscribed: true, discountChannelId: "deals", priceAlerts: [alert] });
  await active.handler.handlePriceAlertInteraction(interaction("list"), games);
  assert.match(JSON.stringify(active.replies[0]), /armata/, "cand reducerile au canal, aceeasi alerta e 'armata'");
});

test("/price-alert list marcheaza explicit starea INACTIVA cand reducerile nu sunt pornite (audit #6)", async () => {
  const { handler, replies } = makeHarness({
    priceAlerts: [{ gameKey: "elden-ring", gameName: "Elden Ring", threshold: 30, currency: "EUR", triggeredAt: null, lastObservedPrice: null }]
  });

  await handler.handlePriceAlertInteraction(interaction("list"), games);

  assert.match(JSON.stringify(replies[0]), /INACTIVE/, "listarea arata explicit ca alertele salvate nu sunt inca livrate");
  assert.match(JSON.stringify(replies[0]), /\/start reduceri/, "listarea indruma catre /start reduceri pentru activare");
});

test("/price-alert list marcheaza livrarea activa cand reducerile au canal (audit #6)", async () => {
  const { handler, replies } = makeHarness({
    discountsSubscribed: true,
    discountChannelId: "deals-chan",
    priceAlerts: [{ gameKey: "elden-ring", gameName: "Elden Ring", threshold: 30, currency: "EUR", triggeredAt: null, lastObservedPrice: null }]
  });

  await handler.handlePriceAlertInteraction(interaction("list"), games);

  assert.match(JSON.stringify(replies[0]), /Livrare activa in <#deals-chan>/, "cand reducerile au canal, listarea confirma livrarea activa");
});

test("buildPriceAlertUpsertPipeline are conditie atomica de dimensiune ($size < max), nu doar concat (R[P2/P3] race)", () => {
  const rule = mod.buildPriceAlertRule(games[0], 30, "EUR");
  const pipeline = mod.buildPriceAlertUpsertPipeline(rule, 25);
  const json = JSON.stringify(pipeline);
  assert.match(json, /\$cond/, "append-ul e conditionat (nu neconditionat)");
  assert.match(json, /"\$size"/, "conditia foloseste dimensiunea array-ului");
  assert.match(json, /"\$lt":\[\{"\$size":"\$\$kept"\},25\]/, "apendeaza doar daca dimensiunea curenta < max");
});

test("/price-alert add: refuza un joc NOU peste limita (pre-check), fara sa scrie in Mongo (R[P2/P3])", async () => {
  const full = Array.from({ length: 25 }, (_unused, index) => ({ gameKey: `g${index}`, gameName: `G${index}`, threshold: 5, currency: "EUR" }));
  const calls: MongoCall[] = [];
  const replies: unknown[] = [];
  const handler = mod.createPriceAlertInteractionHandler({
    GuildModel: {
      updateOne: async (filter, update, options) => { calls.push({ filter, update, options }); return { matchedCount: 1, modifiedCount: 1 }; },
      findOneAndUpdate: async (filter, update, options) => { calls.push({ filter, update, options }); return { priceAlerts: full as PriceAlertRule[] }; }
    },
    getGuildSettings: async () => ({ _id: "guild-1", priceAlerts: full }),
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload) => { replies.push(payload); return payload; },
    formatUserError: (_err, fallback) => fallback,
    SUPPORTED_CURRENCIES: { USD: {}, EUR: {}, GBP: {}, RON: {} },
    logger: () => undefined,
    MessageFlags: { Ephemeral: 64 }
  });

  await handler.handlePriceAlertInteraction(interaction("add", { joc: "elden-ring", price: 30, currency: "EUR" }), games);

  assert.equal(calls.length, 0, "pre-check-ul respinge un joc nou peste limita, fara scriere");
  assert.match(JSON.stringify(replies.at(-1)), /limita de 25/, "raspunde cu eroarea de limita; pipeline-ul atomic ramane plasa de siguranta pentru race-uri concurente");
});

test("/price-alert add: cand findOneAndUpdate confirma ca regula NU s-a salvat (race la limita), raspunde cu eroare, nu fals OK (R[P3] #4)", async () => {
  const full = Array.from({ length: 25 }, (_unused, index) => ({ gameKey: `g${index}`, gameName: `G${index}`, threshold: 5, currency: "EUR" } as PriceAlertRule));
  const replies: unknown[] = [];
  const handler = mod.createPriceAlertInteractionHandler({
    GuildModel: {
      updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 }),
      findOneAndUpdate: async () => ({ priceAlerts: full })
    },
    getGuildSettings: async () => ({ _id: "guild-1", priceAlerts: full.slice(0, 24) }),
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload) => { replies.push(payload); return payload; },
    formatUserError: (_err, fallback) => fallback,
    SUPPORTED_CURRENCIES: { USD: {}, EUR: {}, GBP: {}, RON: {} },
    logger: () => undefined,
    MessageFlags: { Ephemeral: 64 }
  });

  await handler.handlePriceAlertInteraction(interaction("add", { joc: "elden-ring", price: 30, currency: "EUR" }), games);

  assert.match(JSON.stringify(replies.at(-1)), /limita de 25/, "doc-ul returnat de findOneAndUpdate nu contine regula -> handler-ul nu mai confirma fals succesul");
});

test("/price-alert: o eroare interna intoarce handledCommandError (audit onest, R[P2] #2)", async () => {
  const command = mod.buildCommandHandler({
    GuildModel: { updateOne: async () => ({}), findOneAndUpdate: async () => { throw new Error("mongo down"); } },
    getGuildSettings: async () => ({ _id: "guild-1", priceAlerts: [] }),
    safeDefer: async () => undefined,
    safeEdit: async () => undefined,
    formatUserError: (_e: unknown, f: string) => f,
    SUPPORTED_CURRENCIES: { EUR: {} },
    logger: () => undefined,
    MessageFlags: { Ephemeral: 64 }
  });
  const result = await command.handle(interaction("add", { joc: "elden-ring", price: 30, currency: "EUR" }), games);
  assert.equal(isHandledCommandError(result), true, "eroarea interna devine handledCommandError, deci /bot-log nu mai zice Access granted.");
});

function verbInteraction(commandName: "add" | "remove", values: { joc?: string; price?: number; currency?: string } = {}) {
  const base = interaction("price-alert", values);
  return { ...base, commandName, options: { ...base.options, getSubcommand: () => "price-alert" } };
}

test("/add price-alert (verb in fata) ruteaza la add si salveaza regula", async () => {
  const { handler, calls, replies } = makeHarness({ discountsSubscribed: true, discountChannelId: "deals", priceAlerts: [] });
  await handler.handlePriceAlertInteraction(verbInteraction("add", { joc: "elden-ring", price: 30, currency: "EUR" }), games);
  assert.equal(calls.length, 1);
  assert.ok(Array.isArray(calls[0].update), "/add price-alert foloseste pipeline-ul de upsert (actiunea vine din commandName, nu din subcomanda)");
  assert.match(JSON.stringify(replies[0]), /alerta pentru \*\*Elden Ring\*\*/);
});

test("/remove price-alert (verb in fata) ruteaza la remove ($pull)", async () => {
  const { handler, calls } = makeHarness({ priceAlerts: [] });
  await handler.handlePriceAlertInteraction(verbInteraction("remove", { joc: "elden-ring" }), games);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].update, { $pull: { priceAlerts: { gameKey: "elden-ring" } } });
});
