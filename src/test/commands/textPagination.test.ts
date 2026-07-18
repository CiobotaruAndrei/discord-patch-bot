import test from "node:test";
import assert from "node:assert/strict";
import { paginateTextLines, sendPaginatedText } from "../../features/command-presentation/discordListLimit.js";

test("paginateTextLines pastreaza fiecare intrare si pune prefixul doar pe prima pagina", () => {
  const lines = Array.from({ length: 25 }, (_, index) => `intrare-${index}-${"x".repeat(100)}`);
  const pages = paginateTextLines(lines, { maxChars: 300, firstPagePrefix: "Header\n" });
  assert.ok(pages.length > 1);
  assert.match(pages[0], /^Header\n/);
  assert.ok(pages.slice(1).every(page => !page.startsWith("Header")));
  assert.deepEqual(pages.join("\n").match(/intrare-\d+-x+/g), lines);
});

test("paginateTextLines nu pierde continutul unei intrari peste limita", () => {
  const line = "x".repeat(25);
  const pages = paginateTextLines([line], { maxChars: 10 });
  assert.equal(pages.join(""), line);
});

test("sendPaginatedText trimite toate paginile, aplica ephemeral admin si continua dupa followUp esuat", async () => {
  const edits: unknown[] = [];
  const followUps: unknown[] = [];
  const interaction = {
    followUp: async (payload: unknown) => {
      followUps.push(payload);
      if (followUps.length === 1) throw new Error("Discord timeout");
    }
  };
  const result = await sendPaginatedText({
    interaction,
    pages: ["p1", "p2", "p3"],
    safeEdit: async (_interaction, payload) => { edits.push(payload); return "first"; },
    ephemeral: true,
    ephemeralFlag: 64
  });
  assert.equal(result, "first");
  assert.deepEqual(edits, ["p1"]);
  assert.deepEqual(followUps, [{ content: "p2", flags: 64 }, { content: "p3", flags: 64 }]);
});
