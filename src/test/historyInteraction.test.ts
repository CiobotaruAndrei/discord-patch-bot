import test from "node:test";
import assert from "node:assert/strict";

const mod = require("../features/command-handlers/historyInteractionHandler") as typeof import("../features/command-handlers/historyInteractionHandler") & {
  buildHistoryEmbed: (records: Array<{ kind: "update" | "discount"; gameKey: string; title: string; link: string; sentAt: Date }>, kind: "update" | "discount" | "all") => { title: string; description: string; color: number; footer: { text: string } };
  mapHistoryKind: (tip: string | null) => "update" | "discount" | "all";
};
const { buildHistoryEmbed, mapHistoryKind } = mod;

test("mapHistoryKind mapeaza tip-ul la kind", () => {
  assert.equal(mapHistoryKind("updates"), "update");
  assert.equal(mapHistoryKind("reduceri"), "discount");
  assert.equal(mapHistoryKind(null), "all");
  assert.equal(mapHistoryKind("altceva"), "all");
});

test("buildHistoryEmbed: gol => placeholder, fara linii", () => {
  const embed = buildHistoryEmbed([], "all");
  assert.match(embed.title, /Istoric notificari/);
  assert.match(embed.description, /Nu exista notificari/);
  assert.equal(embed.color, 0x95a5a6);
});

test("buildHistoryEmbed: scope label per kind", () => {
  assert.match(buildHistoryEmbed([], "update").title, /update-uri/);
  assert.match(buildHistoryEmbed([], "discount").title, /reduceri/);
});

test("buildHistoryEmbed: randeaza linii cu emoji, link mascat si timestamp relativ", () => {
  const sentAt = new Date("2026-06-06T12:00:00.000Z");
  const expectedTs = Math.floor(sentAt.getTime() / 1000);
  const embed = buildHistoryEmbed([
    { kind: "update", gameKey: "minecraft", title: "Snapshot 26w01a", link: "https://mc/news", sentAt },
    { kind: "discount", gameKey: "", title: "Hades -50%", link: "", sentAt }
  ], "all");
  assert.match(embed.description, /🎮 \[Snapshot 26w01a\]\(https:\/\/mc\/news\)/);
  assert.match(embed.description, new RegExp(`<t:${expectedTs}:R>`));
  assert.match(embed.description, /💸 Hades -50%/);
  assert.match(embed.title, /ultimele 2/);
});

test("buildHistoryEmbed: fallback la gameKey cand title lipseste si curata parantezele patrate", () => {
  const embed = buildHistoryEmbed([
    { kind: "update", gameKey: "fortnite", title: "", link: "https://x", sentAt: new Date() },
    { kind: "update", gameKey: "g", title: "Are [brackets] here", link: "", sentAt: new Date() }
  ], "update");
  assert.match(embed.description, /\[fortnite\]\(https:\/\/x\)/);
  assert.match(embed.description, /brackets/);
  assert.doesNotMatch(embed.description, /\[brackets\]/);
});
