import test from "node:test";
import assert from "node:assert/strict";

process.env.MONGO_URI ||= "mongodb://localhost:27017/discord-patch-bot-test";
process.env.DISCORD_TOKEN ||= "test_discord_token";
process.env.DISCORD_CLIENT_ID ||= "test_discord_client_id";
process.env.METRICS_PUBLIC ||= "true";

type RegistryTestFunction = (...args: unknown[]) => unknown;
type Installer = (context: Record<string, unknown>) => void;

interface CommandRegistryExports extends Record<string, unknown> {
  createCommandRegistry: (
    context: Record<string, unknown>,
    installers: Installer[]
  ) => Record<string, RegistryTestFunction>;
}

const commandRegistry = require("../features/command-registry/commandRegistry") as CommandRegistryExports;

const requiredKeys = [
  "cleanCache",
  "getCacheSizes",
  "setGlobalCacheTtl",
  "checkForUpdates",
  "checkForDiscounts",
  "buildOptimizedGameList",
  "registerSlashCommands",
  "buildSlashCommandDefinitions",
  "handleInteraction",
  "buildHelpEmbed",
  "findGameAndSuggestion",
  "getFindGameCacheSize",
  "clearFindGameCache",
  "formatUserError"
];

function attachRequiredFunctions(context: Record<string, unknown>) {
  for (const key of requiredKeys) {
    context[key] = (...args: unknown[]) => ({ key, args });
  }
}

test("command registry can be created with explicit mocked installers", () => {
  const calls: string[] = [];
  const baseContext: Record<string, unknown> = {};
  const installers: Installer[] = [
    context => {
      calls.push("cache");
      attachRequiredFunctions(context);
    },
    context => {
      calls.push("interactions");
      context.handleInteraction = (interaction: unknown, games: unknown[]) => ({ interaction, games });
    }
  ];

  const registry = commandRegistry.createCommandRegistry(baseContext, installers);

  assert.deepEqual(calls, ["cache", "interactions"]);
  assert.equal(typeof registry.handleInteraction, "function");
  assert.deepEqual(registry.handleInteraction("interaction", [{ key: "cs2" }]), {
    interaction: "interaction",
    games: [{ key: "cs2" }]
  });
  assert.deepEqual(registry.cleanCache(), { key: "cleanCache", args: [] });
});

test("command registry fails early when an installer misses a required function", () => {
  assert.throws(
    () => commandRegistry.createCommandRegistry({}, [context => {

      context.unrelated = () => null;
    }]),
    /cleanCache/
  );
});
