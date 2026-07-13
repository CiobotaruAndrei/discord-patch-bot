import test from "node:test";
import assert from "node:assert/strict";
import overviewHandler from "../../features/command-handlers/gameOverviewInteractionHandler.js";
import type { GameConfig, PriceValue } from "../../types.js";

test("game overview pastreaza rezultatele utile cand sursele independente esueaza", async () => {
  const edits: unknown[] = [];
  const game: GameConfig = { key: "cs2", name: "Counter-Strike 2", type: "steam", appId: "730" };
  const overview = overviewHandler.createGameOverviewHandler({
    logger: () => undefined,
    enforceCooldown: async () => true,
    safeDefer: async () => undefined,
    safeEdit: async (_interaction: unknown, payload: unknown) => { edits.push(payload); return payload; },
    findGameAndSuggestion: () => ({ game, suggestion: null }),
    executeFetchWithCircuitBreaker: async () => ({
      game,
      latest: { id: "u1", title: "Patch 2.0", link: "https://example.com/update", excerpt: "", fullText: "", image: null, thumbnail: null, timestamp: new Date().toISOString() },
      error: null
    }),
    getDealsCacheData: () => null,
    setDealsCache: () => undefined,
    fetchDeals: async () => { throw new Error("deals offline"); },
    fetchSteamCurrentPlayers: async () => { throw new Error("steam offline"); },
    fetchGameStatusSummary: async () => ({ state: "online", label: "Online", detail: "OK", checkedAt: new Date(), statusUrl: "" }),
    getGuildSettings: async () => ({ _id: "guild-1", enabledGames: ["cs2"], currency: "EUR" }),
    getCurrencyConfig: () => ({ cc: "RO" }),
    formatPrice: (value: PriceValue) => String(value),
    httpReq: async () => { throw new Error("store offline"); },
    safeCheerioLoad: () => { throw new Error("nu trebuie apelat"); },
    DEFAULT_CURRENCY: "EUR",
    MessageFlags: { Ephemeral: 64 }
  });
  await overview.handle({
    commandName: "game",
    guild: { id: "guild-1" },
    options: { getString: () => "cs2" }
  }, [game]);
  const payload = edits[0] as { embeds: Array<{ fields: Array<{ name: string; value: string }> }> };
  const fields = new Map(payload.embeds[0].fields.map(field => [field.name, field.value]));
  assert.match(String(fields.get("Ultimul update")), /Patch 2.0/);
  assert.match(String(fields.get("Server status")), /Online/);
  assert.match(String(fields.get("Cea mai buna oferta")), /Fara oferta/);
  assert.match(String(fields.get("Player count")), /indisponibil/i);
  assert.equal(payload.embeds[0].fields.length, 7);
});
