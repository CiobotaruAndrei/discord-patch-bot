import test from "node:test";
import assert from "node:assert/strict";

import { paginateTextLines, sendPaginatedEdit, sendPaginatedEditFlags, sendTextPages } from "../../features/command-presentation/textPagination.js";

test("paginateTextLines: o intrare individuala mai lunga decat bugetul e SPARTA in segmente, nu trunchiata (audit #3, 154)", () => {
  const giant = "x".repeat(2500);
  const pages = paginateTextLines([giant], 1000);
  assert.ok(pages.length >= 3, "intrarea supradimensionata e impartita in mai multe segmente");
  assert.equal(pages.join(""), giant, "niciun caracter nu e pierdut - segmentele reconstituie exact intrarea");
  assert.ok(pages.every(page => page.length <= 1000), "fiecare segment respecta bugetul");
});

test("sendPaginatedEditFlags: paginare cu ephemeral prin flags, fara trunchiere (audit #3, 154)", async () => {
  const edits: Array<{ content: string }> = [];
  const followUps: Array<{ content: string; flags?: number }> = [];
  const lines = Array.from({ length: 40 }, (_unused, index) => `regula-${index}-` + "y".repeat(80));

  await sendPaginatedEditFlags(
    { followUp: async payload => { followUps.push(payload); return payload; } },
    async payload => { edits.push(payload); return payload; },
    64,
    lines
  );

  assert.equal(edits.length, 1, "prima pagina prin safeEdit");
  assert.ok(followUps.length >= 1, "restul paginilor prin followUp - lista nu e taiata");
  assert.ok(followUps.every(payload => payload.flags === 64), "followUp-urile raman ephemeral prin flags");
  const combined = edits[0].content + "\n" + followUps.map(payload => payload.content).join("\n");
  for (let index = 0; index < 40; index++) {
    assert.ok(combined.includes(`regula-${index}-`), `regula ${index} trebuie sa fie vizibila pe o pagina`);
  }
});

test("paginarea respecta limita Discord si livreaza toate paginile ephemeral", async () => {
  const pages = paginateTextLines(["12345", "67890", "abcde"], 11);
  const payloads: unknown[] = [];

  assert.deepEqual(pages, ["12345\n67890", "abcde"]);

  const firstPage = "a".repeat(1000);
  const secondPage = "b".repeat(1000);
  await sendTextPages({
    reply: async payload => {
      payloads.push(payload);
      return payload;
    },
    followUp: async payload => {
      payloads.push(payload);
      return payload;
    }
  }, [firstPage, secondPage], "gol", true);

  assert.equal(payloads.length, 2);
  assert.match(JSON.stringify(payloads[0]), /a{100}/);
  assert.match(JSON.stringify(payloads[1]), /b{100}/);
});

test("sendPaginatedEdit: o lista lunga NU e trunchiata - fiecare intrare apare printr-o pagina (audit #2)", async () => {
  const edits: Array<{ content: string; allowedMentions?: unknown }> = [];
  const followUps: Array<{ content: string; ephemeral?: boolean; allowedMentions?: unknown }> = [];
  const lines = Array.from({ length: 40 }, (_unused, index) => `intrarea-numarul-${index}-` + "x".repeat(80));

  await sendPaginatedEdit(
    { followUp: async payload => { followUps.push(payload as typeof followUps[number]); return payload; } },
    async payload => { edits.push(payload); return payload; },
    lines,
    { ephemeral: true }
  );

  assert.equal(edits.length, 1, "prima pagina merge prin safeEdit");
  assert.ok(followUps.length >= 1, "restul paginilor merg prin followUp - lista nu e taiata la o singura pagina");
  const combined = edits[0].content + "\n" + followUps.map(page => page.content).join("\n");
  for (let index = 0; index < 40; index++) {
    assert.ok(combined.includes(`intrarea-numarul-${index}-`), `intrarea ${index} trebuie sa fie vizibila pe o pagina`);
  }
  assert.ok(followUps.every(page => page.ephemeral === true), "paginile administrative raman ephemeral");
});

test("sendPaginatedEdit: lista goala afiseaza mesajul gol, allowedMentions e propagat pe toate paginile (audit #2)", async () => {
  const edits: Array<{ content: string; allowedMentions?: unknown }> = [];
  const followUps: unknown[] = [];
  const marker = { parse: [] };

  await sendPaginatedEdit(
    { followUp: async payload => { followUps.push(payload); return payload; } },
    async payload => { edits.push(payload); return payload; },
    [],
    { ephemeral: false, emptyMessage: "nimic de afisat", allowedMentions: marker }
  );

  assert.equal(edits.length, 1);
  assert.equal(followUps.length, 0, "o lista goala e o singura pagina, fara followUp");
  assert.equal(edits[0].content, "nimic de afisat");
  assert.equal(edits[0].allowedMentions, marker, "allowedMentions (public) e trimis pe prima pagina");
});
