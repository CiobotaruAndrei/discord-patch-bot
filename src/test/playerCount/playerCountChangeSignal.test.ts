import test from "node:test";
import assert from "node:assert/strict";

import { evaluatePlayerCountChange } from "../../features/player-count/playerCountChangeSignal.js";

test("evaluatePlayerCountChange: prima masuratoare (fara valoare anterioara) nu e semnificativa - e baseline (audit, #2)", () => {
  assert.deepEqual(evaluatePlayerCountChange(null, 1000), { absoluteChange: 0, percentChange: 0, direction: "flat", significant: false });
  assert.deepEqual(evaluatePlayerCountChange(undefined, 1000), { absoluteChange: 0, percentChange: 0, direction: "flat", significant: false });
});

test("evaluatePlayerCountChange: crestere/scadere mare in ambele directii e semnificativa (audit, #2)", () => {
  const up = evaluatePlayerCountChange(1000, 1500);
  assert.equal(up.direction, "up");
  assert.equal(up.absoluteChange, 500);
  assert.equal(up.percentChange, 50);
  assert.equal(up.significant, true);

  const down = evaluatePlayerCountChange(1000, 600);
  assert.equal(down.direction, "down");
  assert.equal(down.percentChange, -40);
  assert.equal(down.significant, true, "scaderile mari se notifica, nu doar record-urile noi");
});

test("evaluatePlayerCountChange: schimbari mici (sub prag procent sau absolut) NU sunt semnificative (audit, #2)", () => {
  assert.equal(evaluatePlayerCountChange(1000, 1100).significant, false, "10% sub pragul de 25%");
  assert.equal(evaluatePlayerCountChange(100, 140).significant, false, "40% dar doar +40 sub pragul absolut de 50");
  assert.equal(evaluatePlayerCountChange(1000, 1000).direction, "flat");
});

test("evaluatePlayerCountChange: praguri configurabile si baza zero (audit, #2)", () => {
  assert.equal(evaluatePlayerCountChange(1000, 1100, { minPercent: 5, minAbsolute: 50 }).significant, true);
  assert.equal(evaluatePlayerCountChange(0, 300).percentChange, 100, "baza zero cu jucatori => +100%");
});

test("evaluatePlayerCountChange decide dupa procentul brut, nu dupa valoarea rotunjita", () => {
  assert.deepEqual(evaluatePlayerCountChange(10000, 12495), {
    absoluteChange: 2495,
    percentChange: 25,
    direction: "up",
    significant: false
  });
  assert.equal(evaluatePlayerCountChange(10000, 12500).significant, true);
  assert.equal(evaluatePlayerCountChange(10000, 7505).significant, false);
  assert.equal(evaluatePlayerCountChange(10000, 7500).significant, true);
  assert.equal(evaluatePlayerCountChange(10000, 12499, { minPercent: 24.995, minAbsolute: 2000 }).significant, false);
});
