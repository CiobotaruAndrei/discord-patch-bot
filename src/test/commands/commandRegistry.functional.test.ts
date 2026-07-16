import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
import test from "node:test";
import assert from "node:assert/strict";

process.env.MONGO_URI ||= "mongodb://localhost:27017/discord-patch-bot-test";
process.env.DISCORD_TOKEN ||= "test_discord_token";
process.env.DISCORD_CLIENT_ID ||= "test_discord_client_id";
process.env.METRICS_PUBLIC ||= "true";

type RegistryTestFunction = (...args: unknown[]) => unknown;

interface CommandRegistryExports {
  createCommandRegistry: (overrides?: Record<string, unknown>) => Record<string, RegistryTestFunction>;
}

const commandRegistry = (await import("../../features/command-registry/commandRegistry.js")).default;
const { commandRuntimeInput } = await import("./commandTestInput.js");

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
  const registry = commandRegistry.createCommandRegistry(commandRuntimeInput, { getGuildSettings: async () => null });
  for (const key of requiredKeys) {
    assert.equal(typeof (registry as Record<string, unknown>)[key], "function", `registry expune ${key} ca functie dupa compunerea explicita prin factory-uri`);
  }
});

test("createCommandRegistry intoarce un registru proaspat si izolat la fiecare apel", () => {
  const first = commandRegistry.createCommandRegistry(commandRuntimeInput, { getGuildSettings: async () => null });
  const second = commandRegistry.createCommandRegistry(commandRuntimeInput, { getGuildSettings: async () => null });

  assert.notEqual(first, second);
  assert.equal(typeof first.handleInteraction, "function");
  assert.equal(typeof second.handleInteraction, "function");
  assert.notEqual(first.handleInteraction, second.handleInteraction);
});

test("createCommandRegistry intoarce un registru INGHETAT (imutabil), compus prin createAppServices fara mutatie in-place (R14 #4)", () => {
  const registry = commandRegistry.createCommandRegistry(commandRuntimeInput, { getGuildSettings: async () => null });
  assert.ok(Object.isFrozen(registry), "registrul public e inghetat: consumatorii nu mai pot muta wiring-ul dupa compunere");
  const before = registry.handleInteraction;
  try {
    (registry as Record<string, unknown>).handleInteraction = () => undefined;
  } catch {
    assert.ok(true);
  }
  assert.equal(registry.handleInteraction, before, "o scriere pe registrul inghetat nu schimba valoarea (ignorata sau aruncata)");
  assert.equal(typeof registry.checkForUpdates, "function", "contractul inchis ramane complet");
});

test("dispatcher: /help este rutat catre handler-ul de help prin canHandle loop", async () => {
  const registry = commandRegistry.createCommandRegistry(commandRuntimeInput, { getGuildSettings: async () => null });
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
  const registry = commandRegistry.createCommandRegistry(commandRuntimeInput, { getGuildSettings: async () => null });
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
  const registry = commandRegistry.createCommandRegistry(commandRuntimeInput, { getGuildSettings: async () => null });
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
  assert.equal(String(reply?.content ?? ""), "Access denied.");
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
  const registry = commandRegistry.createCommandRegistry(commandRuntimeInput, { getGuildSettings: async () => null });
  for (const command of [
    "start", "stop", "set", "template", "notification", "game-alias", "health", "config", "reset-config",
    "admin-alerts", "price-alert", "sources", "watchlist", "snooze", "unsnooze",
    "backup", "bot-log", "server-log", "future-release", "maintenance", "admin-command-access", "delete"
  ]) {
    const { interaction, captured } = makeChatInput(command, { admin: false });
    await registry.handleInteraction(interaction, []);
    const payload = captured.payload as { content?: string } | null;
    assert.ok(payload, `/${command} a primit un raspuns (pre-check-ul admin a rulat in dispatcher)`);
    assert.equal(String(payload?.content ?? ""), "Access denied.", `/${command} blocat de pre-check inainte de handler`);
  }
});

test("dispatcher: /ping si /games sunt rutate prin registry catre handler-ul lor si raspund (registry real)", async () => {
  const registry = commandRegistry.createCommandRegistry(commandRuntimeInput, { getGuildSettings: async () => null });
  const games = [{ key: "cs2", name: "CS2" }];
  for (const command of ["ping", "games"]) {
    const { interaction, captured } = makeChatInput(command);
    await registry.handleInteraction(interaction, games);
    assert.ok(captured.payload, `/${command} a fost rutat la handler-ul sau si a raspuns (dispatchCommand -> handle)`);
  }
});

test("createCommandRuntimeContext returns a fresh, isolated base on every call", () => {
  const runtimeContextModule = require("../../features/command-runtime/commandRuntimeContext").default as {
    createCommandRuntimeContext: (input: unknown) => { discord: Record<string, unknown>; mongo: Record<string, unknown>; sources: Record<string, unknown>; platform: Record<string, unknown> };
  };

  const first = runtimeContextModule.createCommandRuntimeContext(commandRuntimeInput);
  const second = runtimeContextModule.createCommandRuntimeContext(commandRuntimeInput);

  assert.notEqual(first, second);
  assert.equal(typeof first.discord.EmbedBuilder, "function");
  assert.equal(typeof first.discord.crypto, "object");

  first.platform.handleInteraction = () => "installed";
  assert.equal(second.platform.handleInteraction, undefined);
});
