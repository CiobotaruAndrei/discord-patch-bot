import test from "node:test";
import assert from "node:assert/strict";

type GameShape = { key: string; type?: string };
interface FetchResultShape { game: GameShape; latest: { id: string } | null; error: string | null }
interface NormalizedUpdateShape { id: string; title: string; [key: string]: unknown }

interface UpdatesDepsShape {
  logger: (level: string, context: string, message: string, meta?: unknown) => void;
  crypto: { createHash: (algo: string) => { update: (value: unknown) => { digest: (enc: string) => string } } };
  withInflightTimeout: <T>(promise: Promise<T>, label?: string) => Promise<T>;
  trackInflight: <T>(map: Map<string, Promise<T>>, key: string, promise: Promise<T>) => void;
  runConcurrent: (
    items: Array<{ game: GameShape; idx: number }>,
    concurrency: number,
    fn: (item: { game: GameShape; idx: number }) => Promise<void>,
    options?: unknown
  ) => Promise<{ errors: unknown[] }>;
  FETCH_CONCURRENCY: number;
  FETCH_CONCURRENCY_STEAM: number;
  FETCH_CONCURRENCY_EPIC: number;
  FETCH_CONCURRENCY_LISTING: number;
  FETCH_CONCURRENCY_DRIVER: number;
  conditionalGet: <T>(url: string, parse: (raw: unknown) => T | Promise<T>, options?: unknown) => Promise<T>;
  normalizeUpdate: (data: Record<string, unknown>) => NormalizedUpdateShape;
  cleanText: (text: unknown) => string;
  rssParser: { parseString: (input: string) => Promise<{ items?: Array<Record<string, unknown>> }> };
  stableUpdateId: (title: string, link: string) => string;
  executeFetchWithCircuitBreaker?: (game: GameShape) => Promise<FetchResultShape>;
}

interface UpdatesApiShape {
  absoluteUrl: (base: string | undefined, rel: string | undefined) => string;
  sourceConcurrencyGroup: (game: GameShape) => string;
  isLikelyPatchNote: (item: Record<string, unknown>) => boolean;
  fetchMinecraftUpdate: () => Promise<NormalizedUpdateShape>;
  getLatestForAllGames: (games: GameShape[], shouldAbort?: () => boolean) => Promise<FetchResultShape[]>;
  [key: string]: unknown;
}

const attachUpdates = require("../sources/updates") as {
  createUpdates: (deps: UpdatesDepsShape) => UpdatesApiShape;
};

function makeDeps(overrides: Partial<UpdatesDepsShape> = {}): { deps: UpdatesDepsShape; runCalls: Array<{ count: number; concurrency: number }>; conditionalUrls: string[] } {
  const runCalls: Array<{ count: number; concurrency: number }> = [];
  const conditionalUrls: string[] = [];
  const deps: UpdatesDepsShape = {
    logger: () => undefined,
    crypto: { createHash: () => ({ update: () => ({ digest: () => "deadbeefcafe" }) }) },
    withInflightTimeout: <T>(promise: Promise<T>) => promise,
    trackInflight: <T>(map: Map<string, Promise<T>>, key: string, promise: Promise<T>) => {
      map.set(key, promise);
      const cleanup = () => { if (map.get(key) === promise) map.delete(key); };
      promise.then(cleanup, cleanup);
    },
    runConcurrent: async (items, concurrency, fn) => {
      runCalls.push({ count: items.length, concurrency });
      for (const item of items) await fn(item);
      return { errors: [] };
    },
    FETCH_CONCURRENCY: 10,
    FETCH_CONCURRENCY_STEAM: 4,
    FETCH_CONCURRENCY_EPIC: 2,
    FETCH_CONCURRENCY_LISTING: 8,
    FETCH_CONCURRENCY_DRIVER: 2,
    conditionalGet: async <T>(url: string, parse: (raw: unknown) => T | Promise<T>) => {
      conditionalUrls.push(url);
      return parse({});
    },
    normalizeUpdate: (data) => ({ id: String(data.id), title: String(data.title), ...data }),
    cleanText: (text) => String(text == null ? "" : text).trim(),
    rssParser: { parseString: async () => ({ items: [] }) },
    stableUpdateId: (title, link) => `stable:${title}:${link}`,
    ...overrides
  };
  return { deps, runCalls, conditionalUrls };
}

test("createUpdates: factory decuplat cu deps explicit tipate (fara target/Object.assign)", () => {
  const { deps } = makeDeps();
  const api = attachUpdates.createUpdates(deps);
  for (const fn of ["absoluteUrl", "sourceConcurrencyGroup", "isLikelyPatchNote", "fetchMinecraftUpdate", "getLatestForAllGames", "fetchSteamUpdate", "executeFetchWithCircuitBreaker"] as const) {
    assert.equal(typeof api[fn], "function", `api expune ${fn}`);
  }
});

test("createUpdates helperele pure: absoluteUrl si sourceConcurrencyGroup", () => {
  const { deps } = makeDeps();
  const api = attachUpdates.createUpdates(deps);
  assert.equal(api.absoluteUrl("https://example.com/news/", "patch-1"), "https://example.com/news/patch-1");
  assert.equal(api.absoluteUrl("https://example.com", "bad value with spaces"), "https://example.com/bad%20value%20with%20spaces");
  assert.equal(api.sourceConcurrencyGroup({ key: "cs2", type: "steam" }), "steam");
  assert.equal(api.sourceConcurrencyGroup({ key: "nv", type: "nvidia" }), "driver");
  assert.equal(api.sourceConcurrencyGroup({ key: "mc", type: "minecraft" }), "other");
  assert.equal(api.sourceConcurrencyGroup({ key: "wow", type: "rss" }), "rss");
});

type RssGame = GameShape & { name?: string; url?: string; thumbnail?: string };

test("createUpdates.fetchGameUpdate tip 'rss' citeste feed-ul si foloseste guid ca id", async () => {
  const { deps, conditionalUrls } = makeDeps({
    conditionalGet: async <T>(url: string, parse: (raw: unknown) => T | Promise<T>) => { conditionalUrls.push(url); return parse("<rss/>"); },
    rssParser: { parseString: async () => ({ items: [{ title: "Patch 1.5", link: "https://ex/patch", pubDate: "2026-06-01", guid: "g-15", contentSnippet: "Note." }] }) }
  });
  const api = attachUpdates.createUpdates(deps);
  const fetchGameUpdate = api.fetchGameUpdate as (game: RssGame) => Promise<NormalizedUpdateShape>;
  const update = await fetchGameUpdate({ key: "wow", name: "WoW", type: "rss", url: "https://ex/feed.xml" });
  assert.equal(update.id, "g-15");
  assert.equal(update.title, "Patch 1.5");
  assert.equal(update.link, "https://ex/patch");
  assert.ok(conditionalUrls.includes("https://ex/feed.xml"), "a cerut feed-ul configurat prin conditionalGet");
});

test("createUpdates.fetchGameUpdate tip 'rss' fara guid cade pe stableUpdateId", async () => {
  const { deps } = makeDeps({
    conditionalGet: async <T>(url: string, parse: (raw: unknown) => T | Promise<T>) => parse("<rss/>"),
    rssParser: { parseString: async () => ({ items: [{ title: "Hotfix", link: "https://ex/h" }] }) }
  });
  const api = attachUpdates.createUpdates(deps);
  const fetchGameUpdate = api.fetchGameUpdate as (game: RssGame) => Promise<NormalizedUpdateShape>;
  const update = await fetchGameUpdate({ key: "g", name: "G", type: "rss", url: "https://ex/feed" });
  assert.equal(update.id, "stable:Hotfix:https://ex/h");
});

test("createUpdates.fetchGameUpdate tip 'rss' arunca pe feed gol sau lipsa url", async () => {
  const { deps } = makeDeps({
    conditionalGet: async <T>(url: string, parse: (raw: unknown) => T | Promise<T>) => parse("<rss/>"),
    rssParser: { parseString: async () => ({ items: [] }) }
  });
  const api = attachUpdates.createUpdates(deps);
  const fetchGameUpdate = api.fetchGameUpdate as (game: RssGame) => Promise<NormalizedUpdateShape>;
  await assert.rejects(() => fetchGameUpdate({ key: "g", name: "G", type: "rss", url: "https://ex/feed" }), /Feed RSS gol/);
  await assert.rejects(() => fetchGameUpdate({ key: "g2", name: "G2", type: "rss" }), /nu are 'url'/);
});

type FallbackGame = RssGame & { fallbacks?: Array<{ type: string; url?: string }> };

test("createUpdates.applyFallbackSource suprascrie sursa pastrand identitatea jocului", () => {
  const { deps } = makeDeps();
  const api = attachUpdates.createUpdates(deps);
  const applyFallbackSource = api.applyFallbackSource as (game: FallbackGame, fb: { type: string; url?: string }) => FallbackGame;
  const merged = applyFallbackSource({ key: "wow", name: "WoW", type: "steam", url: "https://primary" }, { type: "rss", url: "https://fb" });
  assert.equal(merged.key, "wow");
  assert.equal(merged.name, "WoW");
  assert.equal(merged.type, "rss");
  assert.equal(merged.url, "https://fb");
});

test("createUpdates.fetchGameUpdate cade pe fallback cand sursa principala esueaza", async () => {
  let call = 0;
  const { deps } = makeDeps({
    conditionalGet: async <T>(url: string, parse: (raw: unknown) => T | Promise<T>) => parse("<rss/>"),
    rssParser: { parseString: async () => { call++; return call === 1 ? { items: [] } : { items: [{ title: "Fallback Patch", link: "https://fb", guid: "fb-1" }] }; } }
  });
  const api = attachUpdates.createUpdates(deps);
  const fetchGameUpdate = api.fetchGameUpdate as (game: FallbackGame) => Promise<NormalizedUpdateShape>;
  const update = await fetchGameUpdate({ key: "g", name: "G", type: "rss", url: "https://primary", fallbacks: [{ type: "rss", url: "https://fallback" }] });
  assert.equal(update.id, "fb-1");
  assert.equal(call, 2, "a incercat principala apoi fallback-ul");
});

test("createUpdates.fetchGameUpdate nu apeleaza fallback cand principala reuseste", async () => {
  let call = 0;
  const { deps } = makeDeps({
    conditionalGet: async <T>(url: string, parse: (raw: unknown) => T | Promise<T>) => parse("<rss/>"),
    rssParser: { parseString: async () => { call++; return { items: [{ title: "Primary", link: "https://p", guid: "p-1" }] }; } }
  });
  const api = attachUpdates.createUpdates(deps);
  const fetchGameUpdate = api.fetchGameUpdate as (game: FallbackGame) => Promise<NormalizedUpdateShape>;
  const update = await fetchGameUpdate({ key: "g", name: "G", type: "rss", url: "https://p", fallbacks: [{ type: "rss", url: "https://fb" }] });
  assert.equal(update.id, "p-1");
  assert.equal(call, 1, "fallback-ul nu trebuie incercat daca principala reuseste");
});

test("createUpdates.fetchGameUpdate arunca eroarea sursei principale daca toate fallback-urile esueaza", async () => {
  const { deps } = makeDeps({
    conditionalGet: async <T>(url: string, parse: (raw: unknown) => T | Promise<T>) => parse("<rss/>"),
    rssParser: { parseString: async () => ({ items: [] }) }
  });
  const api = attachUpdates.createUpdates(deps);
  const fetchGameUpdate = api.fetchGameUpdate as (game: FallbackGame) => Promise<NormalizedUpdateShape>;
  await assert.rejects(
    () => fetchGameUpdate({ key: "g", name: "G", type: "rss", url: "https://p", fallbacks: [{ type: "rss", url: "https://fb" }] }),
    /Feed RSS gol/
  );
});

test("createUpdates.fetchMinecraftUpdate foloseste deps.conditionalGet si deps.normalizeUpdate", async () => {
  const { deps, conditionalUrls } = makeDeps({
    conditionalGet: async <T>(url: string, parse: (raw: unknown) => T | Promise<T>) => {
      conditionalUrls.push(url);
      return parse({ latest: { release: "1.21" } });
    }
  });
  const api = attachUpdates.createUpdates(deps);
  const update = await api.fetchMinecraftUpdate();
  assert.equal(update.id, "1.21");
  assert.match(String(update.thumbnail || ""), /^https:[/][/]upload[.]wikimedia[.]org[/].+[.](png|jpg)$/, "thumbnail PNG/JPG pe host stabil (regresie: SVG-ul wikia si PNG-ul seeklogo au ajuns 404; Discord oricum nu randeaza SVG in embed)");
  assert.match(update.title, /Minecraft 1\.21/);
  assert.ok(conditionalUrls.some(u => u.includes("version_manifest")), "a cerut manifestul de versiune prin deps.conditionalGet");
  assert.ok(
    conditionalUrls.some(u => u.startsWith("https://piston-meta.mojang.com/")),
    "manifestul vine de pe hostul oficial piston-meta.mojang.com (regresie: 'pistonmeta.mojang.com' fara cratima nu exista in DNS, sursa Minecraft era complet moarta)"
  );
});

test("createUpdates.fetchRobloxUpdate cere endpoint-ul oficial client-version si foloseste clientVersionUpload ca id", async () => {
  const { deps, conditionalUrls } = makeDeps({
    conditionalGet: async <T>(url: string, parse: (raw: unknown) => T | Promise<T>) => {
      conditionalUrls.push(url);
      return parse({ clientVersionUpload: "version-76173e47a79145c7" });
    }
  });
  const api = attachUpdates.createUpdates(deps);
  const fetchRobloxUpdate = api.fetchRobloxUpdate as () => Promise<NormalizedUpdateShape>;
  const update = await fetchRobloxUpdate();
  assert.equal(update.id, "version-76173e47a79145c7");
  assert.ok(
    conditionalUrls.some(u => u.includes("/v2/client-version/WindowsPlayer")),
    "foloseste path-ul oficial /v2/client-version/ (regresie: '/v2/clientversion/' fara cratima raspunde 404, sursa Roblox era complet moarta)"
  );
});

test("createUpdates.fetchMinecraftUpdate cade pe mirror-ul launchermeta cand piston-meta esueaza", async () => {
  const { deps, conditionalUrls } = makeDeps({
    conditionalGet: async <T>(url: string, parse: (raw: unknown) => T | Promise<T>) => {
      conditionalUrls.push(url);
      if (url.startsWith("https://piston-meta.mojang.com/")) throw new Error("primary down");
      return parse({ latest: { release: "1.22" } });
    }
  });
  const api = attachUpdates.createUpdates(deps);
  const update = await api.fetchMinecraftUpdate();
  assert.equal(update.id, "1.22");
  assert.ok(conditionalUrls.some(u => u.startsWith("https://piston-meta.mojang.com/")), "a incercat intai mirror-ul primar");
  assert.ok(conditionalUrls.some(u => u.startsWith("https://launchermeta.mojang.com/")), "a cazut pe mirror-ul oficial secundar launchermeta (rezilienta: un singur host mort a tinut sursa picata luni de zile)");
});

test("createUpdates.fetchRobloxUpdate cade pe mirror-ul clientsettingscdn cand clientsettings esueaza", async () => {
  const { deps, conditionalUrls } = makeDeps({
    conditionalGet: async <T>(url: string, parse: (raw: unknown) => T | Promise<T>) => {
      conditionalUrls.push(url);
      if (url.startsWith("https://clientsettings.roblox.com/")) throw new Error("primary down");
      return parse({ clientVersionUpload: "version-mirror" });
    }
  });
  const api = attachUpdates.createUpdates(deps);
  const fetchRobloxUpdate = api.fetchRobloxUpdate as () => Promise<NormalizedUpdateShape>;
  const update = await fetchRobloxUpdate();
  assert.equal(update.id, "version-mirror");
  assert.ok(conditionalUrls.some(u => u.startsWith("https://clientsettingscdn.roblox.com/")), "a cazut pe mirror-ul oficial secundar clientsettingscdn");
});

test("conditionalGetFromMirrors propaga ultima eroare cand toate mirror-urile esueaza", async () => {
  const { deps } = makeDeps({
    conditionalGet: async () => { throw new Error("toate au picat"); }
  });
  const api = attachUpdates.createUpdates(deps);
  await assert.rejects(() => api.fetchMinecraftUpdate(), /toate au picat/);
});
test("createUpdates.getLatestForAllGames injecteaza executeFetchWithCircuitBreaker prin deps (decuplat)", async () => {
  const seen: string[] = [];
  const { deps, runCalls } = makeDeps({
    executeFetchWithCircuitBreaker: async (game: GameShape): Promise<FetchResultShape> => {
      seen.push(game.key);
      return { game, latest: { id: game.key }, error: null };
    }
  });
  const api = attachUpdates.createUpdates(deps);
  const games: GameShape[] = [
    { key: "cs2", type: "steam" },
    { key: "fortnite", type: "epic_games" },
    { key: "gta", type: "listing_based" },
    { key: "nv", type: "nvidia" },
    { key: "mc", type: "minecraft" },
    { key: "dota", type: "steam" }
  ];
  const results = await api.getLatestForAllGames(games);
  assert.deepEqual(results.map(r => r.latest?.id), ["cs2", "fortnite", "gta", "nv", "mc", "dota"],
    "rezultatele pastreaza ordinea de intrare indiferent de grupare");
  assert.deepEqual(seen.sort(), ["cs2", "dota", "fortnite", "gta", "mc", "nv"],
    "stub-ul injectat prin deps a fost folosit pentru fiecare joc");
  const byConcurrency = runCalls.map(c => ({ count: c.count, concurrency: c.concurrency }))
    .sort((a, b) => a.concurrency - b.concurrency || a.count - b.count);
  assert.deepEqual(byConcurrency, [
    { count: 1, concurrency: 2 },
    { count: 1, concurrency: 2 },
    { count: 2, concurrency: 4 },
    { count: 1, concurrency: 8 },
    { count: 1, concurrency: 10 }
  ], "fiecare grup ruleaza cu concurrency-ul propriu");
});

test("createUpdates: doua instante cu deps diferite nu se suprascriu (regresie: deps era variabila globala de modul)", async () => {
  const a: string[] = [];
  const b: string[] = [];
  const { deps: depsA } = makeDeps({
    conditionalGet: async <T>(url: string, parse: (raw: unknown) => T | Promise<T>) => { a.push(url); return parse({ latest: { release: "A.1" } }); }
  });
  const { deps: depsB } = makeDeps({
    conditionalGet: async <T>(url: string, parse: (raw: unknown) => T | Promise<T>) => { b.push(url); return parse({ latest: { release: "B.1" } }); }
  });
  const apiA = attachUpdates.createUpdates(depsA);
  attachUpdates.createUpdates(depsB);
  const update = await apiA.fetchMinecraftUpdate();
  assert.equal(update.id, "A.1", "instanta A foloseste deps-ul ei, nu pe al instantei B create ulterior");
  assert.ok(a.length >= 1);
  assert.equal(b.length, 0, "deps-ul instantei B nu e atins de apelul pe A");
});

test("createUpdates: coalescing-ul inflight e per instanta, nu partajat intre instante (regresie: inflightAllGames era global de modul)", async () => {
  let resolveA!: (value: FetchResultShape[]) => void;
  const aPending = new Promise<FetchResultShape[]>(resolve => { resolveA = resolve; });
  const bCalls: string[] = [];
  const { deps: depsA } = makeDeps({
    executeFetchWithCircuitBreaker: () => aPending.then(results => results[0])
  });
  const { deps: depsB } = makeDeps({
    executeFetchWithCircuitBreaker: async (game: GameShape) => {
      bCalls.push(game.key);
      return { game, latest: { id: "din-B" }, error: null };
    }
  });
  const apiA = attachUpdates.createUpdates(depsA);
  const apiB = attachUpdates.createUpdates(depsB);
  const games = [{ key: "cs2", type: "steam" }];
  const aPromise = apiA.getLatestForAllGames(games);
  const bResults = await apiB.getLatestForAllGames(games);
  assert.equal(bCalls.length, 1, "instanta B isi ruleaza propriul fetch, nu refoloseste promisiunea inflight a instantei A");
  assert.equal(bResults[0]?.latest?.id, "din-B");
  resolveA([{ game: games[0], latest: { id: "din-A" }, error: null }]);
  await aPromise;
});
