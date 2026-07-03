import test from "node:test";
import assert from "node:assert/strict";
import { load } from "cheerio";

import type { DealInfo } from "../types";

const installGameInfo = require("../features/command-handlers/gameInfoInteractionHandler") as typeof import("../features/command-handlers/gameInfoInteractionHandler");

function makeInteraction(commandName: string, values: Record<string, string | number | null>) {
  return {
    commandName,
    guild: { id: "guild-1" },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    options: {
      getSubcommand: () => commandName === "best" ? "under" : commandName === "ending" ? "deals" : commandName === "top" ? "games" : "game",
      getSubcommandGroup: () => commandName === "best" ? "deals" : commandName === "system" ? "requirements" : commandName === "top" ? "active" : null,
      getString: (name: string) => typeof values[name] === "string" ? String(values[name]) : null,
      getNumber: (name: string) => typeof values[name] === "number" ? Number(values[name]) : null,
      getInteger: (name: string) => typeof values[name] === "number" ? Number(values[name]) : null
    },
    reply: async (payload: string | object) => typeof payload === "object" ? payload : {},
    followUp: async (payload: string | object) => typeof payload === "object" ? payload : {}
  };
}

function makeDeps(deals: DealInfo[] = []) {
  const replies: Array<string | object> = [];
  const deferModes: boolean[] = [];
  const deps = {
    logger: () => undefined,
    enforceCooldown: async () => true,
    startCommandLog: () => () => undefined,
    safeDefer: async (_interaction: object, ephemeral?: boolean) => { deferModes.push(ephemeral === true); },
    safeEdit: async (_interaction: object, payload: string | object) => {
      replies.push(payload);
      return typeof payload === "object" ? payload : null;
    },
    searchSteamGameByName: async () => [{ id: "10", name: "Portal" }],
    chooseBestSteamMatch: (items: Array<{ id?: string | number; name?: string }>) => items[0] ?? null,
    fetchSteamPriceDetails: async () => ({
      name: "Portal",
      platforms: { windows: true, mac: true, linux: true },
      categories: [
        { id: 1, description: "Single-player" },
        { id: 2, description: "Cross-Platform Multiplayer" },
        { id: 3, description: "Steam Cloud" }
      ],
      pc_requirements: {
        minimum: "<strong>Storage:</strong> 8 GB available space",
        recommended: "<strong>Storage:</strong> 12 GB available space"
      },
      price_overview: { initial: 999, final: 199, discount_percent: 80 }
    }),
    fetchSteamReviewData: async () => ({ totalReviews: 12000, qualityPercent: 96, success: true }),
    fetchSteamCurrentPlayers: async (appId: string | number) => ({ appId: String(appId), playerCount: String(appId) === "730" ? 1200000 : 550, success: true }),
    getDealsCacheData: () => deals,
    setDealsCache: () => undefined,
    fetchDeals: async () => deals,
    enrichDealData: async (deal: DealInfo) => deal,
    getGuildSettings: async () => ({ _id: "guild-1", currency: "EUR", enabledGames: ["cs2"] }),
    formatPrice: (value: string | number, currency?: string | null) => `${value} ${currency || "EUR"}`,
    safeCheerioLoad: load,
    DEFAULT_CURRENCY: "EUR",
    MessageFlags: { Ephemeral: 64 }
  };
  return { deps, replies, deferModes };
}

test("/best deals under cauta in toate sursele, nu doar in watchlist-ul serverului", async () => {
  const deals: DealInfo[] = [
    { title: "Counter-Strike 2", store: "Steam", salePrice: 0, normalPrice: 0, currency: "EUR", savings: 0, link: "https://store.test/cs2" },
    { title: "Portal", store: "Humble", salePrice: 3, normalPrice: 10, currency: "EUR", savings: 70, qualityScore: 95, totalReviews: 10000, link: "https://store.test/portal" },
    { title: "Expensive", store: "GOG", salePrice: 99, normalPrice: 100, currency: "EUR", savings: 1, link: "https://store.test/expensive" }
  ];
  const { deps, replies, deferModes } = makeDeps(deals);
  const handler = installGameInfo.createGameInfoInteractionHandler(deps);

  await handler.handleGameInfo(makeInteraction("best", { buget: 5, currency: "EUR", numar: 5 }));

  assert.deepEqual(deferModes, [false]);
  const payload = replies[0] as { embeds?: Array<{ fields?: Array<{ value: string }> }> };
  const fieldValues = payload.embeds?.[0]?.fields?.map(field => field.value).join("\n") || "";
  assert.match(fieldValues, /Portal/);
  assert.doesNotMatch(fieldValues, /Expensive/);
});

test("comenzile Steam metadata folosesc appdetails pentru crossplay si dimensiune instalare", () => {
  const details = {
    name: "Portal",
    platforms: { windows: true, mac: true },
    categories: [
      { id: 2, description: "Cross-Platform Multiplayer" },
      { id: 3, description: "Steam Cloud" }
    ],
    pc_requirements: {
      minimum: "<strong>Storage:</strong> 8 GB available space",
      recommended: "<strong>Storage:</strong> 12 GB available space"
    }
  };

  const crossplay = installGameInfo.buildCrossplayEmbed("portal", 10, details);
  const gameSize = installGameInfo.buildGameSizeEmbed("portal", 10, details, load);

  assert.match(String(crossplay.fields?.[0]?.value), /Cross-Platform Multiplayer/);
  assert.match(String(gameSize.description), /8 GB/);
});

test("/player-count game afiseaza numarul curent de jucatori Steam", async () => {
  const { deps, replies } = makeDeps();
  deps.searchSteamGameByName = async () => [{ id: "730", name: "Counter-Strike 2" }];
  deps.fetchSteamPriceDetails = async () => ({
    name: "Counter-Strike 2",
    platforms: { windows: true, mac: false, linux: true },
    categories: [],
    pc_requirements: { minimum: "", recommended: "" },
    price_overview: { initial: 0, final: 0, discount_percent: 0 }
  });
  const handler = installGameInfo.createGameInfoInteractionHandler(deps);

  await handler.handleGameInfo(makeInteraction("player-count", { game: "Counter-Strike 2" }));

  const payload = replies[0] as { embeds?: Array<{ description?: string }> };
  assert.match(String(payload.embeds?.[0]?.description), /1,200,000/);
});

test("/top active games calculeaza global din jocurile botului, nu din watchlist-ul serverului", async () => {
  const { deps, replies } = makeDeps();
  deps.getGuildSettings = async () => ({ _id: "guild-1", currency: "EUR", enabledGames: ["portal"], playerCountGames: ["portal"] });
  const handler = installGameInfo.createGameInfoInteractionHandler(deps);

  await handler.handleGameInfo(makeInteraction("top", { numar: 2 }), [
    { key: "portal", name: "Portal", appId: "10" },
    { key: "cs2", name: "Counter-Strike 2", appId: "730" },
    { key: "minecraft", name: "Minecraft" }
  ]);

  const payload = replies[0] as { embeds?: Array<{ fields?: Array<{ name: string; value: string }> }> };
  assert.match(String(payload.embeds?.[0]?.fields?.[0]?.name), /Counter-Strike 2/);
  assert.match(String(payload.embeds?.[0]?.fields?.[0]?.value), /1,200,000/);
});

test("/top active games nu pica complet daca un request Steam esueaza: rezultate partiale + avertisment (R[P2] #1)", async () => {
  const { deps, replies } = makeDeps();
  deps.getGuildSettings = async () => ({ _id: "guild-1", currency: "EUR", enabledGames: ["cs2"], playerCountGames: ["cs2", "portal"] });
  deps.fetchSteamCurrentPlayers = async (appId: string | number) => {
    if (String(appId) === "10") throw new Error("Steam 500 pentru portal");
    return { appId: String(appId), playerCount: 1200000, success: true };
  };
  const handler = installGameInfo.createGameInfoInteractionHandler(deps);

  await handler.handleGameInfo(makeInteraction("top", { numar: 5 }), [
    { key: "portal", name: "Portal", appId: "10" },
    { key: "cs2", name: "Counter-Strike 2", appId: "730" }
  ]);

  const payload = replies[0] as { embeds?: Array<{ description?: string; fields?: Array<{ name: string; value: string }> }> };
  const embed = payload.embeds?.[0];
  assert.ok(embed, "comanda a raspuns cu un embed, nu a picat complet din cauza unui singur request esuat");
  assert.equal(embed.fields?.length, 1, "jocul cu request reusit apare in top");
  assert.match(String(embed.fields?.[0]?.name), /Counter-Strike 2/);
  assert.match(String(embed.description), /nu au putut fi verificate/, "embed-ul avertizeaza ca un joc a fost omis");
});

function freshSnapshot(playerCount: number) {
  return { appId: "", gameKey: "", playerCount, fetchedAt: new Date() };
}

test("/top active games foloseste snapshot-urile proaspete din cron si nu mai apeleaza Steam live (R[Arh] #7)", async () => {
  const { deps, replies } = makeDeps();
  let liveCalls = 0;
  const depsWithSnapshots = {
    ...deps,
    getGuildSettings: async () => ({ _id: "guild-1", currency: "EUR", enabledGames: ["cs2"], playerCountGames: ["cs2", "portal"] }),
    fetchSteamCurrentPlayers: async (appId: string | number) => {
      liveCalls += 1;
      return { appId: String(appId), playerCount: 1, success: true };
    },
    readPlayerCountSnapshots: async (appIds: readonly (string | number)[]) => {
      const map = new Map<string, { appId: string; gameKey: string; playerCount: number; fetchedAt: Date }>();
      for (const id of appIds) {
        map.set(String(id), { ...freshSnapshot(String(id) === "730" ? 900000 : 40000), appId: String(id) });
      }
      return map;
    }
  };
  const handler = installGameInfo.createGameInfoInteractionHandler(depsWithSnapshots);

  await handler.handleGameInfo(makeInteraction("top", { numar: 5 }), [
    { key: "portal", name: "Portal", appId: "10" },
    { key: "cs2", name: "Counter-Strike 2", appId: "730" }
  ]);

  assert.equal(liveCalls, 0, "cu snapshot-uri proaspete pentru toate jocurile nu se face niciun request Steam la comanda");
  const payload = replies[0] as { embeds?: Array<{ description?: string; fields?: Array<{ name: string }> }> };
  assert.match(String(payload.embeds?.[0]?.fields?.[0]?.name), /Counter-Strike 2/, "topul e sortat dupa valorile din snapshot");
  assert.doesNotMatch(String(payload.embeds?.[0]?.description), /nu au fost verificate/, "toate jocurile au fost acoperite");
});

test("/top active games cu snapshot-uri acopera si liste peste 25 de jocuri (cap-ul se aplica doar fetch-ului live) (R[Arh] #7)", async () => {
  const { deps, replies } = makeDeps();
  let liveCalls = 0;
  const games = Array.from({ length: 30 }, (_v, index) => ({ key: `game-${index}`, name: `Game ${index}`, appId: String(1000 + index) }));
  const depsWithSnapshots = {
    ...deps,
    getGuildSettings: async () => ({ _id: "guild-1", currency: "EUR", enabledGames: [] as string[] }),
    fetchSteamCurrentPlayers: async (appId: string | number) => {
      liveCalls += 1;
      return { appId: String(appId), playerCount: 1, success: true };
    },
    readPlayerCountSnapshots: async (appIds: readonly (string | number)[]) => {
      const map = new Map<string, { appId: string; gameKey: string; playerCount: number; fetchedAt: Date }>();
      for (const id of appIds) map.set(String(id), { ...freshSnapshot(Number(id)), appId: String(id) });
      return map;
    }
  };
  const handler = installGameInfo.createGameInfoInteractionHandler(depsWithSnapshots);

  await handler.handleGameInfo(makeInteraction("top", { numar: 5 }), games);

  assert.equal(liveCalls, 0, "toate cele 30 de jocuri sunt acoperite din snapshot, fara fetch live");
  const payload = replies[0] as { embeds?: Array<{ description?: string; fields?: Array<{ name: string }> }> };
  assert.match(String(payload.embeds?.[0]?.fields?.[0]?.name), /Game 29/, "jocul cu cei mai multi jucatori (peste pozitia 25) intra in top");
  assert.doesNotMatch(String(payload.embeds?.[0]?.description), /nu au fost verificate/, "nu mai exista subset nedeclarat");
});

test("/top active games: snapshot vechi (stale) => se face fetch live pentru jocul respectiv (R[Arh] #7)", async () => {
  const { deps, replies } = makeDeps();
  const liveFor: string[] = [];
  const depsWithSnapshots = {
    ...deps,
    getGuildSettings: async () => ({ _id: "guild-1", currency: "EUR", enabledGames: ["cs2"], playerCountGames: ["cs2", "portal"] }),
    fetchSteamCurrentPlayers: async (appId: string | number) => {
      liveFor.push(String(appId));
      return { appId: String(appId), playerCount: 777, success: true };
    },
    readPlayerCountSnapshots: async () => {
      const map = new Map<string, { appId: string; gameKey: string; playerCount: number; fetchedAt: Date }>();
      map.set("730", { appId: "730", gameKey: "cs2", playerCount: 900000, fetchedAt: new Date() });
      map.set("10", { appId: "10", gameKey: "portal", playerCount: 5, fetchedAt: new Date(Date.now() - 16 * 60_000) });
      return map;
    }
  };
  const handler = installGameInfo.createGameInfoInteractionHandler(depsWithSnapshots);

  await handler.handleGameInfo(makeInteraction("top", { numar: 5 }), [
    { key: "portal", name: "Portal", appId: "10" },
    { key: "cs2", name: "Counter-Strike 2", appId: "730" }
  ]);

  assert.deepEqual(liveFor, ["10"], "doar jocul cu snapshot expirat e verificat live");
  const payload = replies[0] as { embeds?: Array<{ fields?: Array<{ name: string; value: string }> }> };
  assert.equal(payload.embeds?.[0]?.fields?.length, 2, "ambele jocuri apar in top (snapshot + live)");
});

test("/player-count foloseste snapshot-ul proaspat si sare peste fetch-ul live (R[Arh] #7)", async () => {
  const { deps, replies } = makeDeps();
  let liveCalls = 0;
  const depsWithSnapshots = {
    ...deps,
    fetchSteamCurrentPlayers: async (appId: string | number) => {
      liveCalls += 1;
      return { appId: String(appId), playerCount: 1, success: true };
    },
    readPlayerCountSnapshots: async (appIds: readonly (string | number)[]) => {
      const map = new Map<string, { appId: string; gameKey: string; playerCount: number; fetchedAt: Date }>();
      map.set(String(appIds[0]), { ...freshSnapshot(4321), appId: String(appIds[0]) });
      return map;
    }
  };
  const handler = installGameInfo.createGameInfoInteractionHandler(depsWithSnapshots);

  await handler.handleGameInfo(makeInteraction("player-count", { game: "Portal" }));

  assert.equal(liveCalls, 0, "snapshot proaspat => fara request live");
  const payload = replies[0] as { embeds?: Array<{ description?: string }> };
  assert.match(String(payload.embeds?.[0]?.description), /4,321/, "embed-ul afiseaza player count-ul din snapshot");
});
