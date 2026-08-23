import test from "node:test";
import assert from "node:assert/strict";

import { adaptRaidGuild } from "../../app/runtime/antiRaidGuildAdapter.js";
import { moduleContext } from "../moduleContextStub.js";

import type { AdaptableRaidGuild } from "../../app/runtime/antiRaidGuildAdapter.js";

interface FakeMessage {
  id: string;
  author: { id: string };
  webhookId?: string;
  createdTimestamp: number;
}

const NOW = Date.parse("2026-08-23T12:00:00.000Z");
const OLDER_THAN_BULK_LIMIT = NOW - 15 * 24 * 60 * 60 * 1000;

function collection(messages: readonly FakeMessage[]) {
  return {
    size: messages.length,
    values: () => messages.values(),
    filter: (predicate: (message: unknown) => boolean) => {
      const kept = messages.filter(message => predicate(message));
      return { size: kept.length, kept };
    }
  };
}

function guildWith(pages: ReadonlyArray<readonly FakeMessage[]>, deleted: string[][]) {
  let fetches = 0;
  const channel = {
    id: "c1",
    messages: {
      fetch: async (options: Record<string, unknown>) => {
        const page = pages[fetches] ?? [];
        fetches += 1;
        assert.ok(typeof options.limit === "number", "paginarea trebuie sa ceara o limita explicita");
        return collection(page);
      }
    },
    bulkDelete: async (doomed: { kept?: FakeMessage[] }) => {
      const kept = doomed.kept ?? [];
      deleted.push(kept.map(message => message.id));
      return { size: kept.length };
    }
  };

  return {
    guild: moduleContext<AdaptableRaidGuild>({
      id: "g1",
      channels: { cache: { get: () => channel } }
    }),
    fetchCount: () => fetches
  };
}

function message(id: string, authorId: string, extra: Partial<FakeMessage> = {}): FakeMessage {
  return { id, author: { id: authorId }, createdTimestamp: NOW - 1000, ...extra };
}

test("curatarea trece prin mai multe pagini, nu doar primele 100 de mesaje (F-37)", async () => {
  const deleted: string[][] = [];
  const pages = [
    Array.from({ length: 100 }, (_unused, index) => message(`a${index}`, "raider-1")),
    [message("b1", "raider-1"), message("b2", "altcineva")]
  ];
  const setup = guildWith(pages, deleted);

  const outcome = await adaptRaidGuild(setup.guild, async () => null).purgeMessages(["c1"], ["raider-1"], []);

  assert.ok(setup.fetchCount() >= 2, "o singura pagina lasa mesajele mai vechi din acelasi raid pe server");
  assert.equal(outcome.deleted, 101);
  assert.deepEqual(deleted[1], ["b1"], "din pagina a doua se sterge doar mesajul participantului");
});

test("mesajele trimise prin webhook-urile raidului sunt sterse si ele (F-37)", async () => {
  const deleted: string[][] = [];
  const pages = [[
    message("m1", "raider-1"),
    message("m2", "webhook-bot", { webhookId: "wh-1" }),
    message("m3", "webhook-bot", { webhookId: "wh-strain" })
  ]];
  const setup = guildWith(pages, deleted);

  const outcome = await adaptRaidGuild(setup.guild, async () => null).purgeMessages(["c1"], ["raider-1"], ["wh-1"]);

  assert.deepEqual(deleted[0], ["m1", "m2"], "un webhook al raidului nu are autorul participant, deci filtrarea pe autor il rata");
  assert.equal(outcome.deleted, 2);
});

test("mesajele mai vechi de 14 zile sunt raportate, nu ignorate tacut (F-37)", async () => {
  const deleted: string[][] = [];
  const pages = [[
    message("nou", "raider-1"),
    message("vechi", "raider-1", { createdTimestamp: OLDER_THAN_BULK_LIMIT })
  ]];
  const setup = guildWith(pages, deleted);

  const outcome = await adaptRaidGuild(setup.guild, async () => null).purgeMessages(["c1"], ["raider-1"], []);

  assert.deepEqual(deleted[0], ["nou"]);
  assert.equal(outcome.unreachable, 1, "Discord nu poate sterge in masa peste 14 zile; ownerul trebuie sa afle");
});

test("fara participanti si fara webhook-uri nu se sterge nimic (F-37)", async () => {
  const deleted: string[][] = [];
  const setup = guildWith([[message("m1", "cineva")]], deleted);

  const outcome = await adaptRaidGuild(setup.guild, async () => null).purgeMessages(["c1"], [], []);

  assert.deepEqual(outcome, { deleted: 0, unreachable: 0 });
  assert.equal(setup.fetchCount(), 0, "fara tinte nu se citeste niciun mesaj");
});
