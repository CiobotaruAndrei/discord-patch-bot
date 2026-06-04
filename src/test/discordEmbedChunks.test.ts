import test from "node:test";
import assert from "node:assert/strict";
import { embedCharCost, packEmbedsByBudget, DISCORD_MAX_EMBEDS_PER_MESSAGE, DISCORD_MAX_MESSAGE_EMBED_CHARS, DEFAULT_EMBED_CHAR_BUDGET } from "../shared/discordEmbedChunks";

test("embedCharCost: insumeaza title + description + footer + author + fields (din toJSON)", () => {
  const builder = {
    toJSON: () => ({
      title: "abc",
      description: "de",
      footer: { text: "ff" },
      author: { name: "g" },
      fields: [{ name: "hh", value: "iii" }, { name: "j", value: "" }]
    })
  };
  assert.equal(embedCharCost(builder), 3 + 2 + 2 + 1 + (2 + 3) + (1 + 0));
});

test("embedCharCost: foloseste .data daca nu exista toJSON, si obiectul brut altfel; 0 pentru non-obiect", () => {
  assert.equal(embedCharCost({ data: { title: "1234", description: "56" } }), 6);
  assert.equal(embedCharCost({ title: "xy", description: "z" }), 3);
  assert.equal(embedCharCost(undefined), 0);
  assert.equal(embedCharCost("ceva"), 0);
  assert.equal(embedCharCost({ toJSON: () => { throw new Error("boom"); }, data: { title: "ab" } }), 2, "toJSON care arunca -> cade pe .data");
});

test("packEmbedsByBudget: imparte dupa numarul maxim de embed-uri", () => {
  const items = Array.from({ length: 23 }, (_, i) => i);
  const chunks = packEmbedsByBudget(items, () => 1, { maxCount: 10, maxChars: 100000 });
  assert.deepEqual(chunks.map(c => c.length), [10, 10, 3]);
});

test("packEmbedsByBudget: imparte dupa bugetul de caractere (limita Discord 6000/mesaj)", () => {
  const items = [3500, 3500, 3500, 3500];
  const chunks = packEmbedsByBudget(items, n => n, { maxCount: 10, maxChars: 6000 });
  assert.deepEqual(chunks.map(c => c.reduce((a, b) => a + b, 0)), [3500, 3500, 3500, 3500],
    "doua embed-uri de 3500 (=7000) NU incap impreuna sub 6000 -> fiecare in mesajul lui");
});

test("packEmbedsByBudget: doua embed-uri mici incap impreuna, al treilea (peste buget) trece in mesaj nou", () => {
  const items = [2000, 2000, 2000];
  const chunks = packEmbedsByBudget(items, n => n, { maxCount: 10, maxChars: 5000 });
  assert.deepEqual(chunks.map(c => c.length), [2, 1], "2000+2000=4000 incap; +2000=6000>5000 -> mesaj nou");
});

test("packEmbedsByBudget: un singur embed mai mare decat bugetul primeste propriul mesaj (nu se pierde)", () => {
  const chunks = packEmbedsByBudget([9000, 100], n => n, { maxCount: 10, maxChars: 5800 });
  assert.deepEqual(chunks.map(c => c.length), [1, 1], "embed-ul urias e izolat in mesajul lui");
});

test("packEmbedsByBudget: lista goala -> fara chunk-uri; constante Discord coerente", () => {
  assert.deepEqual(packEmbedsByBudget([], () => 1), []);
  assert.equal(DISCORD_MAX_EMBEDS_PER_MESSAGE, 10);
  assert.equal(DISCORD_MAX_MESSAGE_EMBED_CHARS, 6000);
  assert.ok(DEFAULT_EMBED_CHAR_BUDGET < DISCORD_MAX_MESSAGE_EMBED_CHARS, "bugetul implicit lasa marja sub 6000");
});
