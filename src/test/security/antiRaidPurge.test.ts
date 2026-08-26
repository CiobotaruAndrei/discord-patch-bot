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
const RAID_STARTED_AT = NOW - 60 * 60 * 1000;

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

  const outcome = await adaptRaidGuild(setup.guild, async () => null).purgeMessages(["c1"], ["raider-1"], [], RAID_STARTED_AT);

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

  const outcome = await adaptRaidGuild(setup.guild, async () => null).purgeMessages(["c1"], ["raider-1"], ["wh-1"], RAID_STARTED_AT);

  assert.deepEqual(deleted[0], ["m1", "m2"], "un webhook al raidului nu are autorul participant, deci filtrarea pe autor il rata");
  assert.equal(outcome.deleted, 2);
});

test("mesajele mai vechi de 14 zile sunt raportate, nu ignorate tacut (F-37)", async () => {
  const deleted: string[][] = [];
  const longRunningRaidStart = OLDER_THAN_BULK_LIMIT - 60_000;
  const pages = [[
    message("nou", "raider-1"),
    message("vechi", "raider-1", { createdTimestamp: OLDER_THAN_BULK_LIMIT })
  ]];
  const setup = guildWith(pages, deleted);

  const outcome = await adaptRaidGuild(setup.guild, async () => null)
    .purgeMessages(["c1"], ["raider-1"], [], longRunningRaidStart);

  assert.deepEqual(deleted[0], ["nou"]);
  assert.equal(outcome.unreachable, 1, "Discord nu poate sterge in masa peste 14 zile; ownerul trebuie sa afle");
});

test("fara participanti si fara webhook-uri nu se sterge nimic (F-37)", async () => {
  const deleted: string[][] = [];
  const setup = guildWith([[message("m1", "cineva")]], deleted);

  const outcome = await adaptRaidGuild(setup.guild, async () => null).purgeMessages(["c1"], [], [], RAID_STARTED_AT);

  assert.deepEqual(outcome, { deleted: 0, unreachable: 0 });
  assert.equal(setup.fetchCount(), 0, "fara tinte nu se citeste niciun mesaj");
});

test("mesajele de dinaintea inceperii raidului NU sunt sterse (review PR #966)", async () => {
  const deleted: string[][] = [];
  const pages = [[
    message("in-raid", "raider-1"),
    message("inainte-de-raid", "raider-1", { createdTimestamp: RAID_STARTED_AT - 60_000 })
  ]];
  const setup = guildWith(pages, deleted);

  const outcome = await adaptRaidGuild(setup.guild, async () => null)
    .purgeMessages(["c1"], ["raider-1"], [], RAID_STARTED_AT);

  assert.deepEqual(deleted[0], ["in-raid"], "istoricul legitim de dinaintea incidentului nu are voie sa fie sters");
  assert.equal(outcome.deleted, 1);
});

test("un webhook legitim, doar modificat in raid, nu isi pierde mesajele vechi (review PR #966)", async () => {
  const deleted: string[][] = [];
  const pages = [[
    message("mesaj-nou-de-webhook", "webhook-bot", { webhookId: "wh-legit" }),
    message("mesaj-vechi-de-webhook", "webhook-bot", { webhookId: "wh-legit", createdTimestamp: RAID_STARTED_AT - 120_000 })
  ]];
  const setup = guildWith(pages, deleted);

  const outcome = await adaptRaidGuild(setup.guild, async () => null)
    .purgeMessages(["c1"], [], ["wh-legit"], RAID_STARTED_AT);

  assert.deepEqual(deleted[0], ["mesaj-nou-de-webhook"]);
  assert.equal(outcome.deleted, 1, "fara limita de timp, curatarea ar fi sters si istoricul legitim al webhook-ului");
});

function fullPage(prefix: string, at: number): FakeMessage[] {
  return Array.from({ length: 100 }, (_unused, index) => message(`${prefix}${index}`, "raider-1", { createdTimestamp: at }));
}

test("paginarea continua dincolo de vechiul plafon de 5 pagini (F-37)", async () => {
  const deleted: string[][] = [];
  const pages = Array.from({ length: 8 }, (_unused, index) => fullPage(`p${index}-`, NOW - 1000));
  const setup = guildWith(pages, deleted);

  const outcome = await adaptRaidGuild(setup.guild, async () => null).purgeMessages(["c1"], ["raider-1"], [], RAID_STARTED_AT);

  assert.equal(setup.fetchCount(), 9,
    "opt pagini pline plus una goala care confirma capatul; cu plafonul vechi de 5 pagini, 300 de mesaje ramaneau neinspectate");
  assert.equal(outcome.deleted, 800);
  assert.deepEqual(outcome.unscanned, [], "istoricul a fost parcurs pana la capat, deci nimic de raportat");
});

test("paginarea se opreste cand istoricul iese din fereastra incidentului (F-37)", async () => {
  const deleted: string[][] = [];
  const pages = [
    fullPage("recent-", NOW - 1000),
    fullPage("vechi-", RAID_STARTED_AT - 60_000),
    fullPage("si-mai-vechi-", RAID_STARTED_AT - 120_000)
  ];
  const setup = guildWith(pages, deleted);

  await adaptRaidGuild(setup.guild, async () => null).purgeMessages(["c1"], ["raider-1"], [], RAID_STARTED_AT);

  assert.equal(setup.fetchCount(), 2, "dupa ce pagina depaseste inceputul incidentului nu mai are rost sa citim istoric mai vechi");
});

test("mesajele de dinaintea incidentului nu se sterg, chiar daca autorul e participant (F-37)", async () => {
  const deleted: string[][] = [];
  const pages = [[
    message("in-raid", "raider-1", { createdTimestamp: NOW - 1000 }),
    message("inainte", "raider-1", { createdTimestamp: RAID_STARTED_AT - 60_000 })
  ]];
  const setup = guildWith(pages, deleted);

  const outcome = await adaptRaidGuild(setup.guild, async () => null).purgeMessages(["c1"], ["raider-1"], [], RAID_STARTED_AT);

  assert.deepEqual(deleted[0], ["in-raid"]);
  assert.equal(outcome.deleted, 1);
});

test("cand plafonul de siguranta intervine, canalul e raportat ca neparcurs complet (F-37)", async () => {
  const deleted: string[][] = [];
  const pages = Array.from({ length: 60 }, (_unused, index) => fullPage(`p${index}-`, NOW - 1000));
  const setup = guildWith(pages, deleted);

  const outcome = await adaptRaidGuild(setup.guild, async () => null).purgeMessages(["c1"], ["raider-1"], [], RAID_STARTED_AT);

  assert.deepEqual(outcome.unscanned, [{ channelId: "c1", pagesScanned: 50 }],
    "raportul trebuie sa spuna ca istoricul nu a fost parcurs complet, nu sa taca");
});

test("un canal parcurs pana la capat nu apare ca neparcurs (F-37)", async () => {
  const deleted: string[][] = [];
  const setup = guildWith([[message("a1", "raider-1")]], deleted);

  const outcome = await adaptRaidGuild(setup.guild, async () => null).purgeMessages(["c1"], ["raider-1"], [], RAID_STARTED_AT);

  assert.deepEqual(outcome.unscanned, []);
});

test("un istoric epuizat inainte de plafon nu e raportat ca neparcurs (F-37)", async () => {
  const deleted: string[][] = [];
  const pages = [fullPage("p0-", NOW - 1000), []];
  const setup = guildWith(pages, deleted);

  const outcome = await adaptRaidGuild(setup.guild, async () => null).purgeMessages(["c1"], ["raider-1"], [], RAID_STARTED_AT);

  assert.deepEqual(outcome.unscanned, [], "pagina goala inseamna ca am ajuns la capatul canalului, nu ca ne-am oprit devreme");
});
