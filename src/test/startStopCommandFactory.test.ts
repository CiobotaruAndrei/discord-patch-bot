import test from "node:test";
import assert from "node:assert/strict";

import { createStartStopHandlers } from "../features/command-handlers/startStopCommandFactory.js";
import type { SubscriptionFamily, SubscriptionInteraction } from "../features/command-handlers/subscriptionCommandContracts.js";

type FactoryDeps = Parameters<typeof createStartStopHandlers>[0];

function makeDeps(overrides: Partial<FactoryDeps> = {}): FactoryDeps & { edits: string[]; warns: string[] } {
  const edits: string[] = [];
  const warns: string[] = [];
  return {
    edits,
    warns,
    logger: (level, _context, message) => { if (level === "WARN") warns.push(message); },
    safeDefer: async () => {},
    safeEdit: async (_interaction, payload) => { edits.push(String(payload)); return payload; },
    canSendEmbeds: () => true,
    listMissingChannelPerms: () => null,
    missingChannelPermsMessage: () => "LIPSA PERMISIUNI",
    formatUserError: (_err, fallback) => fallback,
    ...overrides
  } as FactoryDeps & { edits: string[]; warns: string[] };
}

function makeFamily(calls: string[], name: string): SubscriptionFamily {
  return {
    start: async () => { calls.push(`${name}:start`); return undefined; },
    stop: async () => { calls.push(`${name}:stop`); return undefined; }
  };
}

function makeInteraction(commandName: string, sub: string, overrides: Partial<SubscriptionInteraction> = {}): SubscriptionInteraction {
  return {
    commandName,
    guild: { id: "g1" },
    channel: { id: "c1" },
    client: { user: { id: "bot" } },
    options: { getSubcommand: () => sub },
    ...overrides
  };
}

test("start ruteaza catre familia potrivita dupa subcomanda", async () => {
  const calls: string[] = [];
  const deps = makeDeps();
  const handlers = createStartStopHandlers(deps, {
    updates: makeFamily(calls, "updates"),
    reduceri: makeFamily(calls, "reduceri")
  });
  await handlers.handleStartInteraction(makeInteraction("start", "reduceri"), []);
  assert.deepEqual(calls, ["reduceri:start"]);
});

test("stop ruteaza catre familia potrivita dupa subcomanda", async () => {
  const calls: string[] = [];
  const deps = makeDeps();
  const handlers = createStartStopHandlers(deps, {
    updates: makeFamily(calls, "updates"),
    "player-count": makeFamily(calls, "player-count")
  });
  await handlers.handleStopInteraction(makeInteraction("stop", "player-count"), []);
  assert.deepEqual(calls, ["player-count:stop"]);
});

test("subcomanda necunoscuta la start raspunde cu eroare si logheaza WARN, fara sa apeleze vreo familie", async () => {
  const calls: string[] = [];
  const deps = makeDeps();
  const handlers = createStartStopHandlers(deps, { updates: makeFamily(calls, "updates") });
  await handlers.handleStartInteraction(makeInteraction("start", "necunoscut"), []);
  assert.equal(calls.length, 0);
  assert.equal(deps.warns.length, 1);
  assert.ok(deps.edits[0].includes("nu este recunoscuta"));
});

test("start refuza cand botul nu poate posta embed-uri pe canal, fara sa apeleze familia", async () => {
  const calls: string[] = [];
  const deps = makeDeps({ canSendEmbeds: () => false });
  const handlers = createStartStopHandlers(deps, { updates: makeFamily(calls, "updates") });
  await handlers.handleStartInteraction(makeInteraction("start", "updates"), []);
  assert.equal(calls.length, 0);
  assert.equal(deps.edits[0], "LIPSA PERMISIUNI");
});

test("stop prinde exceptia unei familii si o converteste intr-un mesaj de eroare de baza de date", async () => {
  const deps = makeDeps();
  const throwingFamily: SubscriptionFamily = {
    start: async () => undefined,
    stop: async () => { throw new Error("mongo down"); }
  };
  const handlers = createStartStopHandlers(deps, { updates: throwingFamily });
  await handlers.handleStopInteraction(makeInteraction("stop", "updates"), []);
  assert.equal(deps.edits[0], "Eroare la baza de date.");
});
