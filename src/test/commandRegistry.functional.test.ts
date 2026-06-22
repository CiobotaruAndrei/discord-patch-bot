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
