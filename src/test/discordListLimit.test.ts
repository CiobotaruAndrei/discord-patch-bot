import test from "node:test";
import assert from "node:assert/strict";

import { clampJoinedList } from "../features/command-presentation/discordListLimit.js";

test("clampJoinedList: sub limita -> lista completa, neschimbata", () => {
  const items = ["alfa", "beta", "gama"];
  assert.equal(clampJoinedList(items, 2000), "alfa\nbeta\ngama");
});

test("clampJoinedList: exact la limita -> lista completa", () => {
  const items = ["12345", "6789"];
  const joined = items.join("\n");
  assert.equal(clampJoinedList(items, joined.length), joined);
});

test("clampJoinedList: peste limita -> trunchiat cu nota de overflow si SUB maxChars", () => {
  const items = Array.from({ length: 50 }, (_, i) => `linia numarul ${i} cu ceva text suplimentar ca sa umple`);
  const out = clampJoinedList(items, 300);
  assert.ok(out.length <= 300, `rezultatul (${out.length}) trebuie sa fie sub limita 300`);
  assert.match(out, /si inca \d+/, "include nota cu cate au fost ascunse");
  assert.ok(out.startsWith("linia numarul 0"), "pastreaza primele intrari");
});

test("clampJoinedList: o singura intrare uriasa -> trunchiere dura la maxChars", () => {
  const giant = "x".repeat(5000);
  const out = clampJoinedList([giant], 100);
  assert.equal(out.length, 100);
});

test("clampJoinedList: separator personalizat (lista de jocuri intr-un camp embed)", () => {
  const items = Array.from({ length: 200 }, (_, i) => `Joc ${i} (key-${i})`);
  const out = clampJoinedList(items, 1024, { separator: ", " });
  assert.ok(out.length <= 1024, `field-ul de embed trebuie sa ramana sub 1024 (a fost ${out.length})`);
  assert.match(out, /si inca \d+/);
  assert.ok(out.includes("Joc 0 (key-0)"));
});

test("clampJoinedList: lista goala -> string gol", () => {
  assert.equal(clampJoinedList([], 100), "");
});
