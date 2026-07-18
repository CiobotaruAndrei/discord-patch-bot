import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
import test from "node:test";
import assert from "node:assert/strict";

interface FakeCurrencyConfig { cc: string; symbol: string; placement: "prefix" | "suffix" }
interface FakeHttpResponse { data: unknown }
interface SteamSourceDepsShape {
  logger: (level: string, context: string, message: string, meta?: unknown) => void;
  getCurrencyConfig: (code?: string | null) => FakeCurrencyConfig;
  httpReq: (method: string, url: string, options?: unknown) => Promise<FakeHttpResponse>;
  safeCheerioLoad: (html: unknown) => unknown;
}
interface SteamSearchItemShape { id?: string | number; name?: string; type?: string }
interface SteamSourceApiShape {
  searchSteamGameByName: (query: string, currencyCode?: string) => Promise<SteamSearchItemShape[]>;
  chooseBestSteamMatch: (items: SteamSearchItemShape[] | null, query: string, options?: { forceGameOnly?: boolean }) => SteamSearchItemShape | null;
  fetchSteamPriceDetails: (appId: string | number, currencyCode?: string) => Promise<unknown>;
  fetchSteamCurrentPlayers: (appId: string | number) => Promise<{ appId: string; playerCount: number; success: boolean }>;
  fetchSteamLatestUpdateSize: (appId: string | number) => Promise<{ size: string | null; title: string | null; publishedAt: Date | null; sourceUrl: string | null }>;
  extractOfferEndFromHtml: (html: unknown) => string | null;
  extractSteamOfferEndDate: (appId: string | number, currencyCode?: string) => Promise<string | null>;
}

const attachSteam = require("../../sources/steam").default as {
  createSteamSource: (deps: SteamSourceDepsShape) => SteamSourceApiShape;
};

function makeDeps(overrides: Partial<SteamSourceDepsShape> = {}): { deps: SteamSourceDepsShape; calls: string[] } {
  const calls: string[] = [];
  const deps: SteamSourceDepsShape = {
    logger: () => undefined,
    getCurrencyConfig: () => ({ cc: "us", symbol: "$", placement: "prefix" }),
    httpReq: async (_method, url) => { calls.push(url); return { data: {} }; },
    safeCheerioLoad: () => { throw new Error("no cheerio in this test"); },
    ...overrides
  };
  return { deps, calls };
}

test("createSteamSource: factory decuplat cu deps explicit tipate (fara target/Object.assign)", () => {
  const { deps } = makeDeps();
  const api = attachSteam.createSteamSource(deps);
  for (const fn of ["searchSteamGameByName", "chooseBestSteamMatch", "fetchSteamPriceDetails", "fetchSteamCurrentPlayers", "fetchSteamLatestUpdateSize", "extractOfferEndFromHtml", "extractSteamOfferEndDate"] as const) {
    assert.equal(typeof api[fn], "function", `api expune ${fn}`);
  }
});

test("createSteamSource.fetchSteamLatestUpdateSize foloseste doar dimensiuni publicate explicit", async () => {
  const { deps } = makeDeps({
    httpReq: async () => ({
      data: {
        appnews: {
          newsitems: [
            { title: "Patch notes", contents: "The update download size is 2.4 GB.", date: 1782900000, url: "https://store.steampowered.com/news/app/10/view/1" }
          ]
        }
      }
    })
  });
  const result = await attachSteam.createSteamSource(deps).fetchSteamLatestUpdateSize(10);
  assert.equal(result.size, "2.4 GB");
  assert.equal(result.title, "Patch notes");

  const absent = makeDeps({
    httpReq: async () => ({ data: { appnews: { newsitems: [{ title: "Patch notes", contents: "Many fixes and improvements." }] } } })
  });
  assert.equal((await attachSteam.createSteamSource(absent.deps).fetchSteamLatestUpdateSize(10)).size, null);
});

test("createSteamSource.searchSteamGameByName foloseste deps si tolereaza lipsa items", async () => {
  const withItems = makeDeps({ httpReq: async (_m, url) => { withItems.calls.push(url); return { data: { items: [{ id: 1, name: "Half-Life" }] } }; } });
  const apiA = attachSteam.createSteamSource(withItems.deps);
  const items = await apiA.searchSteamGameByName("half life");
  assert.deepEqual(items, [{ id: 1, name: "Half-Life" }]);
  assert.ok(withItems.calls.some(u => u.includes("storesearch")), "a apelat httpReq cu endpoint-ul de cautare");

  const noItems = makeDeps({ httpReq: async () => ({ data: {} }) });
  const apiB = attachSteam.createSteamSource(noItems.deps);
  assert.deepEqual(await apiB.searchSteamGameByName("x"), [], "raspuns fara items -> []");
});

test("createSteamSource.chooseBestSteamMatch alege potrivirea exacta peste fuzzy", () => {
  const { deps } = makeDeps();
  const api = attachSteam.createSteamSource(deps);
  const best = api.chooseBestSteamMatch(
    [{ id: 1, name: "Half-Life 2", type: "game" }, { id: 2, name: "Half-Life", type: "game" }],
    "half-life"
  );
  assert.equal(best?.id, 2, "alege titlul care se potriveste exact");
});

test("createSteamSource.fetchSteamCurrentPlayers citeste player_count din Steam", async () => {
  const { deps, calls } = makeDeps({
    httpReq: async (_m, url) => { calls.push(url); return { data: { response: { player_count: 12345, result: 1 } } }; }
  });
  const api = attachSteam.createSteamSource(deps);

  const result = await api.fetchSteamCurrentPlayers(730);

  assert.deepEqual(result, { appId: "730", playerCount: 12345, success: true });
  assert.ok(calls.some(u => u.includes("GetNumberOfCurrentPlayers") && u.includes("appid=730")));
});

test("createSteamSource.extractSteamOfferEndDate citeste pagina prin httpReq si parseaza", async () => {
  const { deps, calls } = makeDeps({
    httpReq: async (_m, url) => { calls.push(url); return { data: "<div class=\"game_area_purchase\">Offer ends 30 Dec</div>" }; },
    safeCheerioLoad: () => { throw new Error("force raw fallback"); }
  });
  const api = attachSteam.createSteamSource(deps);
  const end = await api.extractSteamOfferEndDate(730, "EUR");
  assert.match(String(end), /30 Dec/, "extrage data din fallback-ul raw");
  assert.ok(calls.some(u => u.includes("/app/730")), "a cerut pagina app-ului prin deps.httpReq");
});
