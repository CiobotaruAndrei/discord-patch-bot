import test from "node:test";
import assert from "node:assert/strict";
import { steamNewsFixture } from "./fixtures/sources/steamNews";
import { epicFreeGamesFixture } from "./fixtures/sources/epicFreeGames";

process.env.MONGO_URI ||= "mongodb://localhost:27017/discord-patch-bot-test";
process.env.DISCORD_TOKEN ||= "test_discord_token";
process.env.DISCORD_CLIENT_ID ||= "test_discord_client_id";
process.env.METRICS_PUBLIC ||= "true";

const attachUpdates = require("../sources/updates") as (context: Record<string, unknown>) => void;
const attachDeals = require("../sources/deals") as (context: Record<string, unknown>) => void;

type UpdatesRuntime = {
  fetchSteamUpdate: (game: Record<string, unknown>) => Promise<{ id: string; title: string; link: string; timestamp: string }>;
};
type DealsRuntime = {
  fetchDeals: (options: { currency: string }) => Promise<Array<Record<string, unknown>>>;
};

function normalizeUpdate(data: Record<string, unknown>) {
  return {
    id: String(data.id || "id"),
    title: String(data.title || "title"),
    link: String(data.link || ""),
    excerpt: String(data.excerpt || ""),
    fullText: String(data.fullText || ""),
    image: data.image || null,
    thumbnail: data.thumbnail || null,
    timestamp: String(data.timestamp || "")
  };
}

test("contract: Steam ISteamNews fixture yields the newest valid patch note", async () => {
  const context = {
    httpReq: async (_method: string, url: string) => {
      if (url.includes("GetNewsForApp")) return { data: steamNewsFixture };
      throw new Error(`unexpected url ${url}`);
    },
    normalizeUpdate,
    cleanText: (value: unknown) => String(value || "").replace(/\s+/g, " ").trim()
  };
  attachUpdates(context);
  const runtime = context as typeof context & UpdatesRuntime;

  const update = await runtime.fetchSteamUpdate({ appId: 730, key: "cs2", name: "Counter-Strike 2" });

  assert.equal(update.id, "5800000000000000042");
  assert.equal(update.link, "https://store.steampowered.com/news/app/730/view/123456789");
  assert.equal(update.title, "Counter-Strike 2 Update - 2024-05-20");
  assert.equal(update.timestamp, new Date(1716200000 * 1000).toISOString());
});

test("contract: Epic GraphQL fixture yields a free deal with correct fields", async () => {
  const context = {
    logger() {},
    getCurrencyConfig: () => ({ cc: "US", symbol: "$", placement: "prefix" }),
    httpReq: async (_method: string, url: string) => {
      if (String(url).includes("featuredcategories")) return { data: { specials: { items: [] } } };
      if (String(url).includes("graphql.epicgames.com")) return { data: epicFreeGamesFixture };
      throw new Error(`unexpected url ${url}`);
    },
    normalizeTitleForDedupe: (value: unknown) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
    trackInflight: <T>(map: Map<string, Promise<T>>, key: string, promise: Promise<T>) => {
      map.set(key, promise);
      promise.finally(() => { if (map.get(key) === promise) map.delete(key); }).catch(() => undefined);
    },
    withInflightTimeout: <T>(promise: Promise<T>) => promise,
    extractOfferEndFromHtml: () => null,
    STEAM_REVIEW_BATCH_SIZE: 5,
    STEAM_REVIEW_BATCH_DELAY_MS: 0,
    ENRICHED_DEAL_CACHE_TTL_MS: 60_000,
    ENRICHED_DEAL_CACHE_MAX_SIZE: 20,
    STEAM_SPECIALS_LIMIT: 10,
    EPIC_SPECIALS_LIMIT: 10,
    MAX_DEALS: 10
  };
  attachDeals(context);
  const runtime = context as typeof context & DealsRuntime;

  const deals = await runtime.fetchDeals({ currency: "USD" });
  const epic = deals.find(deal => deal.store === "Epic Games");

  assert.ok(epic, "trebuie sa existe o oferta Epic extrasa din fixture");
  assert.equal(epic.title, "Free Epic Game");
  assert.equal(epic.link, "https://store.epicgames.com/en-US/p/free-epic-game");
  assert.equal(epic.salePrice, "0.00");
  assert.equal(epic.savings, 100);
  assert.equal(epic.thumbnail, "https://cdn.epic/free-epic-game-wide.jpg");
  assert.notEqual(epic.endDateStr, "Nespecificat");
});
