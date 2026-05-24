import test from "node:test";
import assert from "node:assert/strict";

type AnyFunction = (...args: unknown[]) => unknown;
type Installer = (ctx: Record<string, unknown>) => void;

interface CommandRegistryExports extends Record<string, unknown> {
  createCommandRegistry: (
    context: Record<string, unknown>,
    installers: Installer[]
  ) => Record<string, AnyFunction>;
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

function attachRequiredFunctions(ctx: Record<string, unknown>) {
  for (const key of requiredKeys) {
    ctx[key] = (...args: unknown[]) => ({ key, args });
  }
}

test("command registry can be created with explicit mocked installers", () => {
  const calls: string[] = [];
  const baseContext: Record<string, unknown> = {};
  const installers: Installer[] = [
    ctx => {
      calls.push("cache");
      attachRequiredFunctions(ctx);
    },
    ctx => {
      calls.push("interactions");
      ctx.handleInteraction = (interaction: unknown, games: unknown[]) => ({ interaction, games });
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
    () => commandRegistry.createCommandRegistry({}, [ctx => {
      // Attach an irrelevant entry so the error references the missing
      // `cleanCache` (the first required key) rather than a generic empty-ctx
      // message.
      ctx.unrelated = () => null;
    }]),
    /cleanCache/
  );
});
