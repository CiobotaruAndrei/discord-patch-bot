import test from "node:test";
import assert from "node:assert/strict";

import { planDlcCandidates, collectBaselineDlcEntries, buildDlcEmbed } from "../../features/notifications/dlcNotificationPlanner.js";
import type { GameDlc } from "../../features/command-handlers/dlcSourceService.js";

function dlc(dlcKey: string, name: string, price = "$1"): GameDlc {
  return { dlcKey, name, price };
}

test("planDlcCandidates: pastreaza ordinea jocurilor si a DLC-urilor, ataseaza gameName+appId (audit, #12)", () => {
  const games = [
    { key: "cs2", name: "Counter-Strike 2", appId: "730" },
    { key: "dota", name: "Dota 2", appId: 570 }
  ];
  const map = new Map<string, GameDlc[]>([
    ["cs2", [dlc("111", "Prime")]],
    ["dota", [dlc("222", "Battle Pass")]]
  ]);
  const out = planDlcCandidates(games, map, 10);
  assert.deepEqual(out, [
    { gameKey: "cs2", gameName: "Counter-Strike 2", appId: "730", dlc: { dlcKey: "111", name: "Prime", price: "$1" } },
    { gameKey: "dota", gameName: "Dota 2", appId: "570", dlc: { dlcKey: "222", name: "Battle Pass", price: "$1" } }
  ]);
});

test("planDlcCandidates: deduplica dupa dlcKey in cadrul jocului si ignora intrari fara cheie/nume (audit, #12)", () => {
  const games = [{ key: "cs2", name: "CS2", appId: "730" }];
  const map = new Map<string, GameDlc[]>([
    ["cs2", [dlc("1", "A"), dlc("1", "A duplicat"), dlc("", "fara cheie"), dlc("2", "")]]
  ]);
  const out = planDlcCandidates(games, map, 10);
  assert.deepEqual(out.map(c => c.dlc.dlcKey), ["1"]);
});

test("planDlcCandidates: respecta limita globala de candidati (audit, #12)", () => {
  const games = [{ key: "g", name: "G", appId: "1" }];
  const map = new Map<string, GameDlc[]>([
    ["g", [dlc("1", "A"), dlc("2", "B"), dlc("3", "C")]]
  ]);
  assert.equal(planDlcCandidates(games, map, 2).length, 2);
});

test("planDlcCandidates: jocuri fara DLC sau fara cheie sunt sarite (audit, #12)", () => {
  const games = [
    { key: "", name: "fara cheie", appId: "1" },
    { key: "g2", name: "G2", appId: "2" }
  ];
  const map = new Map<string, GameDlc[]>([["g2", []]]);
  assert.deepEqual(planDlcCandidates(games, map, 10), []);
});

test("collectBaselineDlcEntries: aduna toate perechile gameKey/dlcKey valide (audit, #12)", () => {
  const games = [
    { key: "a", name: "A", appId: "1" },
    { key: "b", name: "B", appId: "2" }
  ];
  const map = new Map<string, GameDlc[]>([
    ["a", [dlc("1", "x"), dlc("", "gol")]],
    ["b", [dlc("9", "y")]]
  ]);
  assert.deepEqual(collectBaselineDlcEntries(games, map), [
    { gameKey: "a", dlcKey: "1" },
    { gameKey: "b", dlcKey: "9" }
  ]);
});

test("buildDlcEmbed: include titlul jocului, pretul si url-ul de magazin (audit, #12)", () => {
  const embed = buildDlcEmbed({ gameKey: "cs2", gameName: "CS2", appId: "730", dlc: dlc("1", "Prime", "$9.99") }, 0x123456) as {
    title: string; url?: string; description: string; color: number;
  };
  assert.equal(embed.title, "DLC nou: CS2");
  assert.equal(embed.url, "https://store.steampowered.com/app/730");
  assert.match(embed.description, /Prime/);
  assert.match(embed.description, /\$9\.99/);
  assert.equal(embed.color, 0x123456);
});

test("buildDlcEmbed: fara appId nu pune url (audit, #12)", () => {
  const embed = buildDlcEmbed({ gameKey: "g", gameName: "G", appId: "", dlc: dlc("1", "Free", "") }) as { url?: string; description: string };
  assert.equal(embed.url, undefined);
  assert.equal(embed.description, "**Free**");
});
