import test from "node:test";
import assert from "node:assert/strict";

import { summarizeProfile, type FileProfile } from "../../scripts/profile-tests.js";

function profile(file: string, totalMs: number, lingerMs: number): FileProfile {
  return { file, totalMs, workMs: totalMs - lingerMs, lingerMs };
}

test("raportul ordoneaza fisierele dupa timpul total si taie la varf", () => {
  const summary = summarizeProfile(
    [profile("a", 100, 0), profile("b", 900, 0), profile("c", 400, 0)],
    2
  );
  assert.deepEqual(summary.slowest.map(entry => entry.file), ["b", "c"]);
  assert.equal(summary.totalMs, 1400);
});

test("fisierele care tin procesul viu sunt listate separat, ordonate dupa cat stau agatate", () => {
  const summary = summarizeProfile([
    profile("rapid", 120, 10),
    profile("agatat-mult", 7600, 7100),
    profile("agatat-putin", 2200, 2000)
  ]);
  assert.deepEqual(summary.lingering.map(entry => entry.file), ["agatat-mult", "agatat-putin"]);
  assert.ok(
    !summary.lingering.some(entry => entry.file === "rapid"),
    "un fisier care iese imediat nu apare ca problema, oricat de multe teste ar avea"
  );
});

test("mediana descrie cazul obisnuit, nu media trasa de un singur fisier lent", () => {
  const summary = summarizeProfile([
    profile("a", 100, 0),
    profile("b", 110, 0),
    profile("c", 120, 0),
    profile("d", 130, 0),
    profile("e", 9000, 0)
  ]);
  assert.equal(summary.medianMs, 120);
});

test("un corpus gol nu arunca si raporteaza zero", () => {
  const summary = summarizeProfile([]);
  assert.deepEqual(summary.slowest, []);
  assert.deepEqual(summary.lingering, []);
  assert.equal(summary.medianMs, 0);
  assert.equal(summary.totalMs, 0);
});
