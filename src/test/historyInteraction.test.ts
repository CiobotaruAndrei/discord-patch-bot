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

test("buildHistoryEmbed: link-urile cu paranteze/spatii sunt escapate, nu sparg markdown-ul", () => {
  const sentAt = new Date("2026-06-06T12:00:00.000Z");
  const embed = buildHistoryEmbed([
    { kind: "update", gameKey: "g", title: "Patch (Hotfix)", link: "https://ex.com/news_(2026)/patch x", sentAt }
  ], "update");
  assert.ok(embed.description.includes("(https://ex.com/news_%282026%29/patch%20x)"),
    "regresie: un URL cu ')' inchidea prematur (...) din [label](url) si rupea link-ul + restul liniei");
  assert.ok(!embed.description.includes("news_(2026)"), "parantezele brute din URL nu mai ajung in markdown");
});

test("buildHistoryEmbed: bugetul de 4000 caractere taie pe LINII intregi, nu la mijlocul unui link", () => {
  const sentAt = new Date("2026-06-06T12:00:00.000Z");
  const longTitle = "T".repeat(119);
  const longLink = `https://example.com/${"p".repeat(450)}`;
  const records = Array.from({ length: 25 }, (_, i) => ({
    kind: "update" as const, gameKey: `g${i}`, title: `${longTitle}${i}`, link: longLink, sentAt
  }));
  const embed = buildHistoryEmbed(records, "update");
  assert.ok(embed.description.length <= 4000, "descrierea respecta limita Discord");
  const renderedLines = embed.description.split("\n");
  for (const line of renderedLines) {
    assert.match(line, /^🎮 \[.*\]\(https:\/\/example\.com\/p+\) — <t:\d+:R>$/,
      "regresie: slice(0, 4000) putea reteza ultimul link la mijloc ([label](htt...), markdown rupt in embed");
  }
  assert.ok(renderedLines.length < records.length, "scenariul chiar depaseste bugetul (altfel testul nu dovedeste nimic)");
  assert.match(embed.title, new RegExp(`ultimele ${renderedLines.length}\\b`),
    "titlul raporteaza cate intrari sunt afisate efectiv, nu cate au fost cerute");
});
