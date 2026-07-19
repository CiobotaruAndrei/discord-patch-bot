import test from "node:test";
import assert from "node:assert/strict";

import type { InteractionPayload } from "../../features/command-handlers/youtube/youtubeCommandTypes.js";
import { sendYouTubePages, youTubeListLines, youTubeRouteLines } from "../../features/command-handlers/youtube/youtubePresentation.js";

function contentOf(payload: InteractionPayload): string {
  return typeof payload === "string" ? payload : payload.content ?? "";
}

test("sendYouTubePages: o lista YouTube lunga se imparte in pagini, followUp foloseste flag-ul ephemeral (audit #2)", async () => {
  const edits: InteractionPayload[] = [];
  const followUps: InteractionPayload[] = [];
  const lines = Array.from({ length: 30 }, (_unused, index) => `ruta-numarul-${index}-` + "z".repeat(80));

  await sendYouTubePages(
    { followUp: async payload => { followUps.push(payload); return payload; } },
    async payload => { edits.push(payload); return payload; },
    64,
    lines,
    "gol"
  );

  assert.equal(edits.length, 1, "prima pagina merge prin safeEdit");
  assert.ok(followUps.length >= 1, "restul paginilor merg prin followUp - lista nu e taiata");
  assert.ok(followUps.every(payload => typeof payload !== "string" && payload.flags === 64), "followUp-urile raman ephemeral prin flag");
  const combined = contentOf(edits[0]) + "\n" + followUps.map(contentOf).join("\n");
  for (let index = 0; index < 30; index++) {
    assert.ok(combined.includes(`ruta-numarul-${index}-`), `ruta ${index} trebuie sa fie vizibila pe o pagina`);
  }
});

test("sendYouTubePages: o lista goala afiseaza mesajul gol intr-o singura pagina (audit #2)", async () => {
  const edits: InteractionPayload[] = [];
  const followUps: InteractionPayload[] = [];

  await sendYouTubePages(
    { followUp: async payload => { followUps.push(payload); return payload; } },
    async payload => { edits.push(payload); return payload; },
    64,
    [],
    "nu exista nimic"
  );

  assert.equal(edits.length, 1);
  assert.equal(followUps.length, 0);
  assert.equal(contentOf(edits[0]), "nu exista nimic");
});

test("youTubeListLines / youTubeRouteLines: fara canale/rute returneaza lista goala (mesajul gol e adaugat de sender)", () => {
  assert.deepEqual(youTubeListLines(null), []);
  assert.deepEqual(youTubeRouteLines(null), []);
});
