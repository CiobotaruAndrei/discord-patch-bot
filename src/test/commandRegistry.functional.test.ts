import test from "node:test";
import assert from "node:assert/strict";

process.env.MONGO_URI ||= "mongodb://localhost:27017/discord-patch-bot-test";
process.env.DISCORD_TOKEN ||= "test_discord_token";
process.env.DISCORD_CLIENT_ID ||= "test_discord_client_id";
process.env.METRICS_PUBLIC ||= "true";

type RegistryTestFunction = (...args: unknown[]) => unknown;

interface CommandRegistryExports {
  createCommandRegistry: () => Record<string, RegistryTestFunction>;
}

const commandRegistry = require("../features/command-registry/commandRegistry") as CommandRegistryExports;

const requiredKeys = [
  "cleanCache",
  "getCacheSizes",
  "setGlobalCacheTtl",
  "setUpdatesCache",
  "setDealsCache",
  "checkForUpdates",
  "checkForDiscounts",
  "drainOutbox",
  "buildOptimizedGameList",
  "registerSlashCommands",
  "buildSlashCommandDefinitions",
  "handleInteraction",
  "buildHelpEmbed",
  "findGameAndSuggestion",
  "getFindGameCacheSize",
  "clearFindGameCache",
  "formatUserError",
  "canSendEmbeds"
];

test("command registry compune explicit toate functiile cerute, fara installers dinamici", () => {
  const registry = commandRegistry.createCommandRegistry();
  for (const key of requiredKeys) {
    assert.equal(typeof registry[key], "function", `registry expune ${key} ca functie dupa compunerea explicita prin factory-uri`);
  }
});

test("createCommandRegistry intoarce un registru proaspat si izolat la fiecare apel", () => {
  const first = commandRegistry.createCommandRegistry();
  const second = commandRegistry.createCommandRegistry();

  assert.notEqual(first, second);
  assert.equal(typeof first.handleInteraction, "function");
  assert.equal(typeof second.handleInteraction, "function");
  assert.notEqual(first.handleInteraction, second.handleInteraction);
});

test("dispatcher: /help este rutat catre handler-ul de help prin canHandle loop", async () => {
  const registry = commandRegistry.createCommandRegistry();
  let captured: Record<string, unknown> | null = null;
  const interaction = {
    isChatInputCommand: () => true,
    isAutocomplete: () => false,
    guild: { id: "g1" },
    commandName: "help",
    deferred: false,
    replied: false,
    reply: async (payload: Record<string, unknown>) => { captured = payload; return payload; }
  };

  await registry.handleInteraction(interaction, []);

  const reply = captured as Record<string, unknown> | null;
  assert.ok(reply, "handler-ul de help a apelat reply()");
  assert.ok(Array.isArray(reply?.embeds), "raspunsul /help contine embeds");
});

test("dispatcher: o comanda necunoscuta cade pe fallback (canHandle mereu true, ultimul)", async () => {
  const registry = commandRegistry.createCommandRegistry();
  let captured: { content?: string } | null = null;
  const interaction = {
    isChatInputCommand: () => true,
    isAutocomplete: () => false,
    guild: { id: "g1" },
    commandName: "comanda-inexistenta",
    deferred: false,
    replied: false,
    reply: async (payload: { content?: string }) => { captured = payload; return payload; }
  };

  await registry.handleInteraction(interaction, []);

  const reply = captured as { content?: string } | null;
  assert.ok(reply, "fallback a apelat reply()");
  assert.match(String(reply?.content ?? ""), /nu este recunoscuta/);
});

test("dispatcher: comanda admin de la non-admin e blocata de pre-check inainte de orice handler", async () => {
  const registry = commandRegistry.createCommandRegistry();
  let captured: { content?: string } | null = null;
  const interaction = {
    isChatInputCommand: () => true,
    isAutocomplete: () => false,
    guild: { id: "g1" },
    commandName: "health",
    memberPermissions: { has: () => false },
    deferred: false,
    replied: false,
    reply: async (payload: { content?: string }) => { captured = payload; return payload; }
  };

  await registry.handleInteraction(interaction, []);

  const reply = captured as { content?: string } | null;
  assert.ok(reply, "pre-check-ul admin a apelat reply() de respingere");
  assert.match(String(reply?.content ?? ""), /Administrator/);
});

function makeChatInput(commandName: string, options: { admin?: boolean } = {}) {
  const captured: { payload: unknown } = { payload: null };
  const record = async (payload: unknown) => { captured.payload = payload; return payload; };
  const interaction = {
    isChatInputCommand: () => true,
    isAutocomplete: () => false,
    guild: { id: "g1" },
    commandName,
    memberPermissions: { has: () => options.admin === true },
    deferred: false,
    replied: false,
    reply: record,
    deferReply: record,
    editReply: record,
    followUp: record,
    options: { getSubcommandGroup: () => null, getSubcommand: () => "x", getString: () => null }
  };
  return { interaction, captured };
}

test("dispatcher: toate comenzile admin de la non-admin sunt blocate de pre-check (registry real, table-driven)", async () => {
  const registry = commandRegistry.createCommandRegistry();
  for (const command of ["start", "stop", "set", "outbox", "health", "config", "sources", "watchlist", "snooze", "unsnooze"]) {
    const { interaction, captured } = makeChatInput(command, { admin: false });
    await registry.handleInteraction(interaction, []);
    const payload = captured.payload as { content?: string } | null;
    assert.ok(payload, `/${command} a primit un raspuns (pre-check-ul admin a rulat in dispatcher)`);
    assert.match(String(payload?.content ?? ""), /Administrator/, `/${command} blocat de pre-check inainte de handler`);
  }
});

test("dispatcher: /ping si /games sunt rutate prin registry catre handler-ul lor si raspund (registry real)", async () => {
  const registry = commandRegistry.createCommandRegistry();
  const games = [{ key: "cs2", name: "CS2" }];
  for (const command of ["ping", "games"]) {
    const { interaction, captured } = makeChatInput(command);
    await registry.handleInteraction(interaction, games);
    assert.ok(captured.payload, `/${command} a fost rutat la handler-ul sau si a raspuns (dispatchCommand -> handle)`);
  }
});

test("createCommandRuntimeContext returns a fresh, isolated base on every call", () => {
  const runtimeContextModule = require("../features/command-runtime/commandRuntimeContext") as {
    createCommandRuntimeContext: () => Record<string, unknown>;
  };

  const first = runtimeContextModule.createCommandRuntimeContext();
  const second = runtimeContextModule.createCommandRuntimeContext();

  assert.notEqual(first, second);
  assert.equal(typeof first.EmbedBuilder, "function");
  assert.equal(typeof first.crypto, "object");

  (first as Record<string, unknown>).handleInteraction = () => "installed";
  assert.equal(second.handleInteraction, undefined);
});
