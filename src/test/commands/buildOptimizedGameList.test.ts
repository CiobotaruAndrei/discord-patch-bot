
"use strict";

process.env.MONGO_URI ||= "mongodb://localhost:27017/discord-patch-bot-test";
process.env.DISCORD_TOKEN ||= "test_discord_token";
process.env.DISCORD_CLIENT_ID ||= "test_discord_client_id";
process.env.METRICS_PUBLIC ||= "true";

import test from "node:test";
import assert from "node:assert/strict";
const commandRegistryFactories = (await import("../../features/command-registry/commandRegistry.js")).default;
const { commandRuntimeInput } = await import("./commandTestInput.js");
const { buildOptimizedGameList } = commandRegistryFactories.createCommandRegistry(commandRuntimeInput);

type TestGame = { key: string; name: string; type: string; appId?: string };
type TestGuild = { _id: string; subscribed: boolean; notificationChannelId: string; enabledGames: string[] };

const allGames: TestGame[] = [
  { key: "cs2", name: "CS2", type: "steam", appId: "730" },
  { key: "minecraft", name: "Minecraft", type: "minecraft" },
  { key: "fortnite", name: "Fortnite", type: "epic_games" },
  { key: "rocket-league", name: "Rocket League", type: "epic_games" },
  { key: "nvidiagr", name: "NVIDIA", type: "nvidia" }
];

function guild(overrides: Partial<TestGuild> = {}): TestGuild {
  return {
    _id: "g1",
    subscribed: true,
    notificationChannelId: "c1",
    enabledGames: [],
    ...overrides
  };
}

test("fara guild-uri abonate returneaza lista completa", () => {
  const result = buildOptimizedGameList(allGames, []);
  assert.equal(result.length, allGames.length);
});

test("un guild fara filtru include toate jocurile", () => {
  const result = buildOptimizedGameList(allGames, [guild({ enabledGames: [] })]);
  assert.equal(result.length, allGames.length);
});

test("un guild cu filtru de 2 jocuri include doar acele jocuri", () => {
  const result = buildOptimizedGameList(allGames, [
    guild({ _id: "g1", enabledGames: ["cs2", "minecraft"] })
  ]);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((game: TestGame) => game.key).sort(), ["cs2", "minecraft"]);
});

test("doua guild-uri cu filtre disjuncte produc uniune", () => {
  const result = buildOptimizedGameList(allGames, [
    guild({ _id: "g1", enabledGames: ["cs2"] }),
    guild({ _id: "g2", enabledGames: ["minecraft", "fortnite"] })
  ]);
  assert.equal(result.length, 3);
  assert.deepEqual(result.map((game: TestGame) => game.key).sort(), ["cs2", "fortnite", "minecraft"]);
});

test("daca un guild are filtru gol, toate jocurile raman incluse", () => {
  const result = buildOptimizedGameList(allGames, [
    guild({ _id: "g1", enabledGames: ["cs2"] }),
    guild({ _id: "g2", enabledGames: [] })
  ]);
  assert.equal(result.length, allGames.length);
});

test("filtrul cu chei stale revine la full list", () => {
  const result = buildOptimizedGameList(allGames, [
    guild({ _id: "g1", enabledGames: ["nonexistent-key"] })
  ]);
  assert.equal(result.length, allGames.length);
});

test("cheile sunt tratate case-insensitive", () => {
  const result = buildOptimizedGameList(allGames, [
    guild({ _id: "g1", enabledGames: ["CS2", "MINECRAFT"] })
  ]);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((game: TestGame) => game.key).sort(), ["cs2", "minecraft"]);
});

export {};
