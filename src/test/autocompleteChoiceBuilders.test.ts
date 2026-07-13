import test from "node:test";
import assert from "node:assert/strict";

import {
  createAutocompleteChoiceBuilders,
  type GameConfig,
  type GuildSettingsLite
} from "../features/command-handlers/autocompleteChoiceBuilders.js";

const GUILD = { id: "guild-1" };

function makeBuilders(settings: GuildSettingsLite | null, onError?: () => never) {
  const warnings: string[] = [];
  const builders = createAutocompleteChoiceBuilders({
    logger: (_level, _ctx, msg) => { warnings.push(msg); },
    getGuildSettings: async () => {
      if (onError) onError();
      return settings;
    }
  });
  return { builders, warnings };
}

const GAMES: GameConfig[] = [
  { key: "cyberpunk", name: "Cyberpunk 2077" },
  { key: "witcher", name: "The Witcher 3" },
  { key: "hades", name: "Hades" }
];

test("buildSetGamesRemovePool: fara guild -> toate jocurile", async () => {
  const { builders } = makeBuilders({ enabledGames: ["cyberpunk"] });
  const out = await builders.buildSetGamesRemovePool({ guild: null, options: { getString: () => null } }, GAMES);
  assert.deepEqual(out, GAMES);
});

test("buildSetGamesRemovePool: enabledGames gol -> toate jocurile", async () => {
  const { builders } = makeBuilders({ enabledGames: [] });
  const out = await builders.buildSetGamesRemovePool({ guild: GUILD, options: { getString: () => null } }, GAMES);
  assert.deepEqual(out, GAMES);
});

test("buildSetGamesRemovePool: doar cele activate + placeholder pentru cheie stale", async () => {
  const { builders } = makeBuilders({ enabledGames: ["cyberpunk", "stale-key"] });
  const out = await builders.buildSetGamesRemovePool({ guild: GUILD, options: { getString: () => null } }, GAMES);
  assert.deepEqual(out.map(g => g.key), ["cyberpunk", "stale-key"]);
  assert.match(String(out[1].name), /cheie stale/);
});

test("buildSetGamesRemovePool: eroare la citire -> fallback pe toate jocurile + log", async () => {
  const { builders, warnings } = makeBuilders(null, () => { throw new Error("boom"); });
  const out = await builders.buildSetGamesRemovePool({ guild: GUILD, options: { getString: () => null } }, GAMES);
  assert.deepEqual(out, GAMES);
  assert.equal(warnings.length, 1);
});

test("buildPriceAlertRemovePool: fara alerte -> lista goala", async () => {
  const { builders } = makeBuilders({ priceAlerts: [] });
  const out = await builders.buildPriceAlertRemovePool({ guild: GUILD, options: { getString: () => null } }, GAMES);
  assert.deepEqual(out, []);
});

test("buildPriceAlertRemovePool: configurate + stale, deduplicate", async () => {
  const { builders } = makeBuilders({ priceAlerts: [{ gameKey: "hades" }, { gameKey: "gone" }, { gameKey: "hades" }] });
  const out = await builders.buildPriceAlertRemovePool({ guild: GUILD, options: { getString: () => null } }, GAMES);
  assert.deepEqual(out.map(g => g.key), ["hades", "gone"]);
  assert.match(String(out[1].name), /indisponibila/);
});

test("buildYouTubeChannelChoices: filtreaza pe input si adauga optiunea 'toate' cand includeAll", async () => {
  const { builders } = makeBuilders({
    youtubeChannels: [
      { channelId: "c1", channelName: "Gaming News" },
      { channelId: "c2", channelName: "Music" }
    ]
  });
  const all = await builders.buildYouTubeChannelChoices({ guild: GUILD, options: { getString: () => null } }, "gam", true);
  assert.equal(all[0].value, "toate");
  assert.deepEqual(all.slice(1).map(c => c.value), ["c1"]);

  const plain = await builders.buildYouTubeChannelChoices({ guild: GUILD, options: { getString: () => null } }, "", false);
  assert.deepEqual(plain.map(c => c.value), ["c1", "c2"]);
});

test("buildYouTubeRouteChoices: ruta dupa canal + optiunea 'toate rutele'", async () => {
  const { builders } = makeBuilders({
    youtubeChannelRoutes: [{ channelId: "c1", discordChannelIds: ["d1", "d2"] }]
  });
  const out = await builders.buildYouTubeRouteChoices(
    { guild: GUILD, options: { getString: () => "c1" } },
    ""
  );
  assert.equal(out[0].value, "toate");
  assert.deepEqual(out.slice(1).map(c => c.value), ["d1", "d2"]);
});

test("buildYouTubeTitleWordChoices: filtreaza cuvintele dupa input", async () => {
  const { builders } = makeBuilders({ youtubeTitleIncludeWords: ["update", "patch", "news"] });
  const out = await builders.buildYouTubeTitleWordChoices({ guild: GUILD, options: { getString: () => null } }, "pa");
  assert.deepEqual(out.map(c => c.value), ["patch"]);
});
