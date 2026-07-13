import test from "node:test";
import assert from "node:assert/strict";
import {
  summarizeCanary,
  filterCanaryGames,
  filterFragileCanaryGames,
  buildFragileWarnings,
  summarizeDealsByStore,
  RELIABLE_CANARY_TYPES
} from "../../scripts/canarySources.js";
import type { CanaryGameResult } from "../../scripts/canarySources.js";

const r = (key: string, type: string, ok: boolean): CanaryGameResult => ({ key, type, ok });

test("filterCanaryGames: include toate API-urile JSON fiabile (steam implicit, minecraft, roblox), nu doar steam", () => {
  const games = [
    { key: "cs2" },
    { key: "dota", type: "steam" },
    { key: "minecraft", type: "minecraft" },
    { key: "roblox", type: "roblox" },
    { key: "fortnite", type: "epic_games" },
    { key: "lol", type: "listing_based" },
    { key: "wow", type: "rss" },
    { key: "nv", type: "nvidia" }
  ];
  const filtered = filterCanaryGames(games).map(game => game.key);
  assert.deepEqual(filtered, ["cs2", "dota", "minecraft", "roblox"],
    "regresie: canarul verifica doar jocurile steam -> sursele minecraft (host DNS mort) si roblox (path 404) au ramas rupte luni de zile fara alerta");
  assert.ok(RELIABLE_CANARY_TYPES.has("minecraft") && RELIABLE_CANARY_TYPES.has("roblox"));
});

test("summarizeDealsByStore: numara ofertele per store si semnaleaza lipsa totala a Epic", () => {
  const mixed = summarizeDealsByStore([{ store: "Steam" }, { store: "Epic Games" }, { store: "Steam" }]);
  assert.deepEqual(mixed.byStore, { Steam: 2, "Epic Games": 1 });
  assert.equal(mixed.epicMissing, false);
  const steamOnly = summarizeDealsByStore([{ store: "Steam" }, { store: "Steam" }]);
  assert.equal(steamOnly.epicMissing, true,
    "regresie: dealsOk=count>0 nu vedea ca Epic a disparut (graphql.epicgames.com retras) cat timp Steam dadea oferte");
  assert.equal(summarizeDealsByStore([]).epicMissing, true);
});

test("summarizeCanary: o sursa cu cel putin un joc OK NU e considerata rupta (esec partial = tranzitoriu)", () => {
  const out = summarizeCanary([r("a", "steam", true), r("b", "steam", false)], true, 12);
  const steam = out.byType.find(t => t.type === "steam")!;
  assert.equal(steam.ok, 1);
  assert.equal(steam.failed, 1);
  assert.equal(steam.brokenSource, false);
  assert.equal(out.pass, true);
  assert.deepEqual(out.failures, []);
});

test("summarizeCanary: o sursa cu 0 jocuri OK e marcata rupta si pica", () => {
  const out = summarizeCanary([r("x", "listing_based", false), r("y", "listing_based", false)], true, 5);
  const listing = out.byType.find(t => t.type === "listing_based")!;
  assert.equal(listing.brokenSource, true);
  assert.equal(out.pass, false);
  assert.match(out.failures[0], /listing_based/);
});

test("summarizeCanary: tip cu un singur joc esuat e considerat rupt (canary alerteaza, non-blocking)", () => {
  const out = summarizeCanary([r("fortnite", "epic_games", false)], true, 8);
  assert.equal(out.byType.find(t => t.type === "epic_games")!.brokenSource, true);
  assert.equal(out.pass, false);
});

test("summarizeCanary: deals esuat -> failure dedicata, chiar daca sursele de update sunt OK", () => {
  const out = summarizeCanary([r("a", "steam", true)], false, 0);
  assert.equal(out.dealsOk, false);
  assert.equal(out.pass, false);
  assert.ok(out.failures.some(f => /reduceri|fetchDeals/.test(f)));
});

test("summarizeCanary: toate sursele OK + deals OK -> pass, fara failures", () => {
  const out = summarizeCanary([r("a", "steam", true), r("b", "steam", true), r("fortnite", "epic_games", true)], true, 20);
  assert.equal(out.pass, true);
  assert.deepEqual(out.failures, []);
  assert.equal(out.dealsCount, 20);
});

test("summarizeCanary: agrega corect mai multe jocuri per tip", () => {
  const out = summarizeCanary([r("a", "steam", true), r("b", "steam", true), r("c", "steam", false)], true, 3);
  const steam = out.byType.find(t => t.type === "steam")!;
  assert.equal(steam.total, 3);
  assert.equal(steam.ok, 2);
  assert.equal(steam.failed, 1);
  assert.equal(steam.brokenSource, false);
});

test("summarizeCanary fail-closed: crash complet la fetchDeals pica canary-ul, nu il lasa verde", () => {
  const out = summarizeCanary([r("a", "steam", true)], false, 0, { dealsCrashed: "ECONNRESET" });
  assert.equal(out.pass, false,
    "regresie: catch-ul din fetchDeals seta dealsOk=true -> endpoint-ul de reduceri putea muri complet cu workflow verde");
  assert.ok(out.failures.some(f => /fetchDeals a crapat complet/.test(f) && /ECONNRESET/.test(f)));
  assert.ok(out.failures.some(f => /ALLOW_CANARY_NETWORK_SKIP/.test(f)),
    "mesajul de esec documenteaza opt-out-ul explicit pentru rulari controlate");
});

test("summarizeCanary fail-closed: crash-ul fetchDeals nu dubleaza failure-ul generic de deals", () => {
  const out = summarizeCanary([r("a", "steam", true)], false, 0, { dealsCrashed: "boom" });
  const dealsFailures = out.failures.filter(f => /fetchDeals|reduceri/.test(f));
  assert.equal(dealsFailures.length, 1);
});

test("summarizeCanary fail-closed: crash complet la getLatestForAllGames pica canary-ul", () => {
  const out = summarizeCanary([], true, 10, { gamesCrashed: "timeout total" });
  assert.equal(out.pass, false,
    "regresie: catch-ul lasa gameResults=[] -> byType gol -> zero failures -> pass desi nimic nu a fost verificat");
  assert.ok(out.failures.some(f => /getLatestForAllGames a crapat complet/.test(f) && /timeout total/.test(f)));
});

test("summarizeCanary: fara crash-uri, semantica veche ramane neschimbata", () => {
  const out = summarizeCanary([r("a", "steam", true)], true, 5);
  assert.equal(out.pass, true);
  assert.deepEqual(out.failures, []);
});

test("filterFragileCanaryGames: selecteaza exact sursele scraped/proxy, complementare celor fiabile", () => {
  const games = [
    { key: "cs2" },
    { key: "dota", type: "steam" },
    { key: "minecraft", type: "minecraft" },
    { key: "roblox", type: "roblox" },
    { key: "fortnite", type: "epic_games" },
    { key: "lol", type: "listing_based" },
    { key: "wow", type: "rss" },
    { key: "nv", type: "nvidia" }
  ];
  assert.deepEqual(filterFragileCanaryGames(games).map(g => g.key), ["fortnite", "lol", "wow", "nv"]);
  const all = new Set([...filterCanaryGames(games).map(g => g.key), ...filterFragileCanaryGames(games).map(g => g.key)]);
  assert.equal(all.size, games.length, "fiecare joc e acoperit fie de canary-ul blocant, fie de cel warning-only");
});

test("buildFragileWarnings: tip fragil cu 0 jocuri OK -> warning, tip cu esec partial -> nimic", () => {
  const warnings = buildFragileWarnings([
    r("lol", "listing_based", false),
    r("lol2", "listing_based", false),
    r("fortnite", "epic_games", true),
    r("nv", "nvidia", false),
    r("amd", "amd", true),
    r("amd2", "amd", false)
  ]);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.some(w => /listing_based/.test(w)));
  assert.ok(warnings.some(w => /"nvidia"/.test(w)));
  assert.ok(warnings.every(w => /warning-only/.test(w)), "mesajul spune explicit ca nu e blocant");
});
