import test from "node:test";
import assert from "node:assert/strict";

import { extractImports } from "../../scripts/check-layer-imports.js";

test("un import mentionat intr-un comentariu nu mai e numarat", () => {
  const sursa = [
    '// import forbidden from "../../app/secret.js";',
    '/* import alt from "../../app/altul.js"; */',
    'import real from "../../infra/ceva.js";'
  ].join("\n");
  const gasite = extractImports("features/x/modul.ts", sursa).map(entry => entry.to);
  assert.deepEqual(
    gasite,
    ["infra/ceva.ts"],
    "cautarea pe text vedea si comentariile, deci un exemplu comentat putea pica gate-ul de straturi"
  );
});

test("un specificator dintr-un sir obisnuit nu mai e numarat drept import", () => {
  const sursa = 'const mesaj = `import x from "../app/fals.js"`;\nimport real from "./vecin.js";';
  const gasite = extractImports("features/x/modul.ts", sursa).map(entry => entry.to);
  assert.deepEqual(gasite, ["features/x/vecin.ts"], "un sir care contine cuvantul import nu e un import");
});

test("re-exportul dintr-un alt modul e vazut ca dependinta", () => {
  const gasite = extractImports("features/x/modul.ts", 'export { ceva } from "../../infra/sursa.js";');
  assert.deepEqual(gasite, [{ from: "features/x/modul.ts", to: "infra/sursa.ts", typeOnly: false }],
    "un re-export leaga la fel de tare ca un import; ratat, un strat putea depinde de altul pe furis");
});

test("importul de tip din pozitie de tip e recunoscut ca fiind doar de tip", () => {
  const gasite = extractImports("features/x/modul.ts", 'let v: import("../../app/contract.js").Ceva;');
  assert.deepEqual(gasite, [{ from: "features/x/modul.ts", to: "app/contract.ts", typeOnly: true }],
    "`import(...)` in pozitie de tip nu creeaza dependinta la rulare, deci nu are voie sa fie tratat ca una");
});

test("importul dinamic ramane o dependinta la rulare", () => {
  const gasite = extractImports("features/x/modul.ts", 'const m = await import("../../infra/lazy.js");');
  assert.deepEqual(gasite, [{ from: "features/x/modul.ts", to: "infra/lazy.ts", typeOnly: false }]);
});

test("acelasi modul importat de doua ori apare o singura data", () => {
  const sursa = 'import a from "./vecin.js";\nimport b from "./vecin.js";';
  assert.equal(extractImports("features/x/modul.ts", sursa).length, 1);
});
