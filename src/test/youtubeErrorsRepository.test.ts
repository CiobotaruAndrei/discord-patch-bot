import test from "node:test";
import assert from "node:assert/strict";

import {
  YOUTUBE_ERROR_LIMIT,
  clearYoutubeErrors,
  countYoutubeErrors,
  listYoutubeErrors,
  recordYoutubeError,
  type GuildYoutubeErrorRecord
} from "../features/youtube/youtubeErrorsRepository";

function makeErrorModel(initial: GuildYoutubeErrorRecord[] = []) {
  let nextId = 1;
  const docs: GuildYoutubeErrorRecord[] = initial.map(doc => ({ _id: nextId++, ...doc }));
  const model = {
    create: async (doc: GuildYoutubeErrorRecord) => {
      docs.push({ ...doc, _id: nextId++ });
      return doc;
    },
    deleteMany: async (filter: Record<string, unknown>) => {
      const ids = (filter._id as { $in?: unknown[] } | undefined)?.$in;
      const before = docs.length;
      if (Array.isArray(ids)) {
        for (const id of ids) {
          const index = docs.findIndex(doc => doc._id === id);
          if (index >= 0) docs.splice(index, 1);
        }
      } else {
        for (let index = docs.length - 1; index >= 0; index--) {
          if (docs[index].guildId === filter.guildId) docs.splice(index, 1);
        }
      }
      return { deletedCount: before - docs.length };
    },
    countDocuments: async (filter: Record<string, unknown>) => docs.filter(doc => doc.guildId === filter.guildId).length,
    find: (filter: Record<string, unknown>) => {
      let sorted = docs.filter(doc => doc.guildId === filter.guildId);
      let skipped = 0;
      let limited = Number.POSITIVE_INFINITY;
      const chain = {
        sort: (spec: Record<string, 1 | -1>) => {
          const direction = spec.at === 1 ? 1 : -1;
          sorted = [...sorted].sort((a, b) => direction * (new Date(a.at ?? 0).getTime() - new Date(b.at ?? 0).getTime()));
          return chain;
        },
        skip: (count: number) => { skipped = count; return chain; },
        limit: (count: number) => { limited = count; return chain; },
        lean: async () => sorted.slice(skipped, skipped + limited)
      };
      return chain;
    }
  };
  return { model, docs };
}

test("recordYoutubeError scrie un document per eroare si pastreaza cel mult 20 per guild (evictie dupa _id, nu dupa timestamp egal)", async () => {
  const seeded = Array.from({ length: YOUTUBE_ERROR_LIMIT }, (_, index) => ({
    guildId: "guild-1",
    channelId: `UC${index}`,
    channelName: `Canal ${index}`,
    message: "feed indisponibil",
    at: new Date(Date.UTC(2026, 0, 1, 0, index))
  }));
  const { model, docs } = makeErrorModel([
    ...seeded,
    { guildId: "guild-2", channelId: "UCx", channelName: "Alt guild", message: "x", at: new Date(Date.UTC(2020, 0, 1)) }
  ]);

  await recordYoutubeError(model, "guild-1", { channelId: "UCnou", channelName: "Canal Nou", message: "feed picat" });

  const guild1 = docs.filter(doc => doc.guildId === "guild-1");
  assert.equal(guild1.length, YOUTUBE_ERROR_LIMIT, "capul de 20 per guild e pastrat");
  assert.equal(guild1.some(doc => doc.channelId === "UC0"), false, "cea mai veche eroare e evacuata la depasirea capului");
  assert.equal(guild1.some(doc => doc.channelId === "UCnou"), true);
  assert.equal(docs.some(doc => doc.guildId === "guild-2"), true, "evictia e per guild, alt guild nu e atins");
});

test("listYoutubeErrors citeste sortat descrescator cu limita; alt guild nu apare", async () => {
  const { model } = makeErrorModel([
    { guildId: "guild-1", channelId: "UC1", channelName: "Vechi", message: "prima", at: new Date("2026-01-01T00:00:00.000Z") },
    { guildId: "guild-1", channelId: "UC2", channelName: "Nou", message: "a doua", at: new Date("2026-02-01T00:00:00.000Z") },
    { guildId: "guild-2", channelId: "UC3", channelName: "Altul", message: "alta", at: new Date("2026-03-01T00:00:00.000Z") }
  ]);
  const entries = await listYoutubeErrors(model, "guild-1", 10);
  assert.deepEqual(entries.map(entry => entry.channelName), ["Nou", "Vechi"]);
  assert.deepEqual((await listYoutubeErrors(model, "guild-1", 1)).map(entry => entry.message), ["a doua"]);
});

test("countYoutubeErrors si clearYoutubeErrors lucreaza per guild", async () => {
  const { model, docs } = makeErrorModel([
    { guildId: "guild-1", channelId: "UC1", channelName: "A", message: "x", at: new Date() },
    { guildId: "guild-1", channelId: "UC2", channelName: "B", message: "y", at: new Date() },
    { guildId: "guild-2", channelId: "UC3", channelName: "C", message: "z", at: new Date() }
  ]);
  assert.equal(await countYoutubeErrors(model, "guild-1"), 2);
  await clearYoutubeErrors(model, "guild-1");
  assert.equal(await countYoutubeErrors(model, "guild-1"), 0);
  assert.equal(docs.length, 1, "/youtube clear-errors goleste doar jurnalul guild-ului curent");
});
