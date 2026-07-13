import test from "node:test";
import assert from "node:assert/strict";
import { buildDeadLetterEntry, deadLetterTitleFromPayload, NOTIFICATION_DEAD_LETTER_LIMIT } from "../features/notifications/deadLetter.js";
import { recordDeadLetters, type GuildDeadLetterRecord } from "../features/notifications/deadLetterRepository.js";

test("buildDeadLetterEntry: pastreaza campurile de audit (kind, itemId, title, channelId, dedupeKey, reason, attempts)", () => {
  const entry = buildDeadLetterEntry({
    kind: "discount",
    itemId: "job-123",
    title: "Elden Ring - 30% reducere",
    channelId: "chan-9",
    dedupeKey: "abcdef0123456789",
    reason: "max-attempts",
    attempts: 5
  });
  assert.equal(entry.kind, "discount");
  assert.equal(entry.itemId, "job-123");
  assert.equal(entry.title, "Elden Ring - 30% reducere");
  assert.equal(entry.channelId, "chan-9", "channelId e pastrat pentru audit/debug");
  assert.equal(entry.dedupeKey, "abcdef0123456789", "dedupeKey e pastrat pentru reconciliere");
  assert.equal(entry.reason, "max-attempts");
  assert.equal(entry.attempts, 5);
  assert.ok(entry.failedAt instanceof Date);
});

test("buildDeadLetterEntry: campurile lipsa devin string gol, titlul e plafonat la 200", () => {
  const entry = buildDeadLetterEntry({ kind: "update", itemId: undefined, reason: "permanent", attempts: 1 });
  assert.equal(entry.itemId, "");
  assert.equal(entry.title, "");
  assert.equal(entry.channelId, "");
  assert.equal(entry.dedupeKey, "");

  const long = buildDeadLetterEntry({ kind: "update", itemId: "x", title: "T".repeat(500), reason: "r", attempts: 0 });
  assert.equal(long.title.length, 200, "titlul lung e plafonat la 200 de caractere");
});

test("deadLetterTitleFromPayload: ia titlul primului embed, apoi content, apoi gol; plafonat la 200", () => {
  assert.equal(deadLetterTitleFromPayload({ embeds: [{ title: "Cyberpunk 2077 - update" }] }), "Cyberpunk 2077 - update");
  assert.equal(deadLetterTitleFromPayload({ content: "<@&123> oferta noua" }), "<@&123> oferta noua");
  assert.equal(deadLetterTitleFromPayload({ embeds: [{}] }), "", "embed fara titlu si fara content -> gol");
  assert.equal(deadLetterTitleFromPayload({}), "");
  assert.equal(deadLetterTitleFromPayload(undefined), "");
  assert.equal(deadLetterTitleFromPayload({ embeds: [{ title: "Z".repeat(400) }] }).length, 200, "titlu lung plafonat la 200");
});

test("recordDeadLetters scrie documente in colectia guildDeadLetters si pastreaza cel mult 50 per guild (evictie pe _id)", async () => {
  let nextId = 1;
  const docs: GuildDeadLetterRecord[] = Array.from({ length: NOTIFICATION_DEAD_LETTER_LIMIT }, (_, index) => ({
    _id: nextId++,
    guildId: "guild-1",
    kind: "update" as const,
    itemId: `vechi-${index}`,
    reason: "max-attempts",
    attempts: 1,
    failedAt: new Date(Date.UTC(2026, 0, 1, 0, index))
  }));
  const model = {
    insertMany: async (batch: GuildDeadLetterRecord[]) => { for (const doc of batch) docs.push({ ...doc, _id: nextId++ }); return batch; },
    deleteMany: async (filter: Record<string, unknown>) => {
      const ids = (filter._id as { $in: unknown[] }).$in;
      const before = docs.length;
      for (const id of ids) {
        const index = docs.findIndex(doc => doc._id === id);
        if (index >= 0) docs.splice(index, 1);
      }
      return { deletedCount: before - docs.length };
    },
    find: (filter: Record<string, unknown>) => {
      let sorted = docs.filter(doc => doc.guildId === filter.guildId);
      let skipped = 0;
      let limited = Number.POSITIVE_INFINITY;
      const chain = {
        sort: () => {
          sorted = [...sorted].sort((a, b) => new Date(b.failedAt ?? 0).getTime() - new Date(a.failedAt ?? 0).getTime());
          return chain;
        },
        skip: (count: number) => { skipped = count; return chain; },
        limit: (count: number) => { limited = count; return chain; },
        lean: async () => sorted.slice(skipped, skipped + limited)
      };
      return chain;
    }
  };

  await recordDeadLetters(model, "guild-1", []);
  assert.equal(docs.length, NOTIFICATION_DEAD_LETTER_LIMIT, "fara intrari nu se scrie si nu se evacueaza nimic");

  await recordDeadLetters(model, "guild-1", [buildDeadLetterEntry({ kind: "update", itemId: "nou", reason: "r", attempts: 0 })]);
  assert.equal(docs.length, NOTIFICATION_DEAD_LETTER_LIMIT, "capul de 50 per guild e pastrat");
  assert.equal(docs.some(doc => doc.itemId === "vechi-0"), false, "cea mai veche intrare e evacuata la depasirea capului");
  assert.equal(docs.some(doc => doc.itemId === "nou"), true);
});
