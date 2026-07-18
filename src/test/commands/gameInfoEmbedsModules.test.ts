import test from "node:test";
import assert from "node:assert/strict";
import * as cheerio from "cheerio";

import * as barrel from "../../features/command-handlers/gameInfoEmbeds.js";
import * as deals from "../../features/command-handlers/dealsEmbeds.js";
import * as comparison from "../../features/command-handlers/comparisonEmbeds.js";
import * as steamMetadata from "../../features/command-handlers/steamMetadataEmbeds.js";
import * as playerCount from "../../features/command-handlers/playerCountEmbeds.js";
import type { SteamAppDetailsSummary } from "../../sources/sourceApis.js";

test("barrel-ul gameInfoEmbeds re-exporta exact aceleasi referinte ca modulele pe domenii", () => {
  assert.equal(barrel.buildBestDealsEmbed, deals.buildBestDealsEmbed);
  assert.equal(barrel.buildEndingDealsEmbed, deals.buildEndingDealsEmbed);
  assert.equal(barrel.findExternalStores, deals.findExternalStores);
  assert.equal(barrel.buildReviewTrendEmbed, comparison.buildReviewTrendEmbed);
  assert.equal(barrel.buildCrossplayEmbed, comparison.buildCrossplayEmbed);
  assert.equal(barrel.buildPlatformsEmbed, comparison.buildPlatformsEmbed);
  assert.equal(barrel.buildCoopEmbed, comparison.buildCoopEmbed);
  assert.equal(barrel.buildSystemRequirementsEmbed, steamMetadata.buildSystemRequirementsEmbed);
  assert.equal(barrel.buildGameSizeEmbed, steamMetadata.buildGameSizeEmbed);
  assert.equal(barrel.buildPlayerCountEmbed, playerCount.buildPlayerCountEmbed);
  assert.equal(barrel.buildTopActiveGamesEmbed, playerCount.buildTopActiveGamesEmbed);
  assert.equal(barrel.selectTopActiveGames, playerCount.selectTopActiveGames);
});

test("dealsEmbeds: buildBestDealsEmbed sorteaza dupa scor si filtreaza dupa buget", () => {
  const embed = deals.buildBestDealsEmbed(
    [
      { title: "Scump", salePrice: "60", normalPrice: "60", store: "Steam", link: "https://a" },
      { title: "Ieftin bun", salePrice: "10", normalPrice: "40", store: "Steam", link: "https://b", savings: 75 }
    ],
    50,
    "EUR",
    5,
    (value, cur) => `${value} ${cur}`
  );
  assert.equal(embed.fields?.length, 1);
  assert.ok(String(embed.fields?.[0].name).includes("Ieftin bun"));
});

const steamDetails: SteamAppDetailsSummary = {
  name: "Jocul Meu",
  categories: [{ description: "Cross-Platform Multiplayer" }, { description: "Online Co-op" }],
  platforms: { windows: true, mac: false, linux: true }
};

test("comparisonEmbeds: crossplay detectat, co-op enumera modurile, platforms listeaza platformele Steam", () => {
  const crossplay = comparison.buildCrossplayEmbed("q", 1, steamDetails);
  assert.ok(String(crossplay.fields?.[0].value).includes("Detectat"));
  const coop = comparison.buildCoopEmbed("q", 1, steamDetails);
  assert.ok(String(coop.description).includes("Online co-op"));
  const platforms = comparison.buildPlatformsEmbed("q", 1, steamDetails, ["Epic"]);
  assert.ok(String(platforms.fields?.[0].value).includes("Windows"));
  assert.ok(String(platforms.fields?.[0].value).includes("Linux"));
});

test("playerCountEmbeds: buildTopActiveGamesEmbed sorteaza descrescator si omite jocurile fara date", () => {
  const embed = playerCount.buildTopActiveGamesEmbed([
    { game: { key: "a", name: "A" }, players: { appId: "1", playerCount: 100, success: true } },
    { game: { key: "b", name: "B" }, players: { appId: "2", playerCount: 500, success: true } },
    { game: { key: "c", name: "C" }, players: { appId: "3", playerCount: 0, success: false } }
  ]);
  assert.ok(String(embed.fields?.[0].name).includes("B"));
  assert.ok(String(embed.description).includes("1 joc(uri) nu au putut fi verificate"));
});

test("steamMetadataEmbeds: game-size extrage dimensiunea din cerinte, altfel mesaj de indisponibilitate", () => {
  const load = (html: string) => cheerio.load(String(html || ""));
  const withSize = steamMetadata.buildGameSizeEmbed("q", 1, {
    name: "Joc",
    pc_requirements: { minimum: "<p>Storage: 50 GB available space</p>" }
  }, load, { size: "1.2 GB", title: "Update 4", publishedAt: null, sourceUrl: null });
  assert.ok(String(withSize.fields?.[0]?.value).includes("50 GB"));
  assert.ok(String(withSize.fields?.[1]?.value).includes("1.2 GB"));

  const unavailable = steamMetadata.buildGameSizeEmbed("q", 1, { name: "Joc" }, load);
  assert.equal(unavailable.fields?.[0]?.value, "indisponibil");
  assert.equal(unavailable.fields?.[1]?.value, "indisponibil");
});
