import test from "node:test";
import assert from "node:assert/strict";
import { buildDeadLetterEntry, deadLetterPush, deadLetterTitleFromPayload, NOTIFICATION_DEAD_LETTER_LIMIT } from "../features/notifications/deadLetter";

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

test("deadLetterPush: construieste $push cu $slice plafonat, sau null daca nu sunt intrari", () => {
  assert.equal(deadLetterPush([]), null);
  const push = deadLetterPush([buildDeadLetterEntry({ kind: "update", itemId: "x", reason: "r", attempts: 0 })]) as { notificationDeadLetter: { $each: unknown[]; $slice: number } };
  assert.ok(push.notificationDeadLetter, "cheia de push e notificationDeadLetter");
  assert.equal(push.notificationDeadLetter.$each.length, 1);
  assert.equal(push.notificationDeadLetter.$slice, -NOTIFICATION_DEAD_LETTER_LIMIT, "pastreaza doar ultimele N intrari");
});
