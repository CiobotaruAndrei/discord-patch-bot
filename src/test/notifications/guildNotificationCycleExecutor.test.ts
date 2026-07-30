import test from "node:test";
import assert from "node:assert/strict";

import { runGuildNotificationCycle, type NotificationCycleEnvironment } from "../../features/notifications/notificationCycle.js";
import type { OutboundChannel, OutboundHistoryEntry } from "../../features/notifications/outboundChannel.js";

type LogLine = { level: string; context: string; message: string };

function environment(log: LogLine[]): NotificationCycleEnvironment {
  return {
    logger: (level, context, message) => log.push({ level, context, message }),
    isPermanentDiscordError: err => (err as { code?: unknown }).code === 50001,
    transientErrorMessage: err => (err instanceof Error ? err.message : String(err)),
    sleepIfPositive: async () => undefined,
    maxEmbedsPerMessage: 10,
    sendDelayMs: 0
  };
}

function recordingChannel(sent: OutboundHistoryEntry[][], failWith?: unknown): OutboundChannel {
  return {
    id: "chan-1",
    send: async (_payload, meta) => {
      if (failWith) throw failWith;
      sent.push(meta?.historyEntries ?? []);
      return undefined;
    }
  };
}

const matched = { matchedCount: 1 };

test("o singura descriere a itemului alimenteaza rollback-ul, istoricul si logul", async () => {
  const log: LogLine[] = [];
  const sent: OutboundHistoryEntry[][] = [];
  const released: string[] = [];

  await runGuildNotificationCycle<{ game: string; id: string }>(environment(log), {
    kind: "update",
    guildId: "g1",
    channel: recordingChannel(sent),
    limit: 5,
    candidates: [{ game: "dota", id: "u1" }],
    identify: candidate => ({
      itemId: `${candidate.game}:${candidate.id}`,
      describe: `update-ul ${candidate.game}/${candidate.id}`,
      history: { gameKey: candidate.game, title: "titlu", link: "link", itemId: candidate.id }
    }),
    claim: async () => matched,
    buildEmbed: () => ({ title: "embed" }),
    releaseClaim: async candidate => { released.push(candidate.id); }
  });

  assert.deepEqual(sent, [[{ kind: "update", gameKey: "dota", title: "titlu", link: "link", itemId: "u1" }]]);
  assert.deepEqual(released, [], "livrarea reusita nu da inapoi revendicarea");
});

test("identitatea folosita la raportarea rollback-ului esuat vine din aceeasi sursa ca istoricul", async () => {
  const log: LogLine[] = [];
  const reported: Array<{ kind: string; itemId: string; guildId: string }> = [];
  const sent: OutboundHistoryEntry[][] = [];

  await runGuildNotificationCycle<{ game: string; id: string }>(
    { ...environment(log), reportRollbackFailure: context => { reported.push(context); } },
    {
      kind: "update",
      guildId: "g1",
      channel: recordingChannel(sent, new Error("Discord indisponibil")),
      limit: 5,
      candidates: [{ game: "dota", id: "u1" }],
      identify: candidate => ({
        itemId: `${candidate.game}:${candidate.id}`,
        describe: `update-ul ${candidate.game}/${candidate.id}`,
        history: { gameKey: candidate.game, itemId: candidate.id }
      }),
      claim: async () => matched,
      buildEmbed: () => ({ title: "embed" }),
      releaseClaim: async () => { throw new Error("Mongo picat"); }
    }
  );

  assert.deepEqual(reported, [{ guildId: "g1", kind: "update", itemId: "dota:u1" }]);
});

test("canalul dezactivat in timpul revendicarii nu mai primeste trimitere", async () => {
  const log: LogLine[] = [];
  const sent: OutboundHistoryEntry[][] = [];
  const disabled: string[] = [];
  let claims = 0;

  const outcome = await runGuildNotificationCycle<string>(environment(log), {
    kind: "discount",
    guildId: "g1",
    channel: recordingChannel(sent),
    limit: 5,
    candidates: ["a", "b"],
    identify: hash => ({ itemId: hash, describe: `reducerea ${hash}`, history: { itemId: hash } }),
    claim: async () => { claims += 1; return matched; },
    buildEmbed: candidate => {
      if (candidate === "b") throw Object.assign(new Error("lipsesc permisiunile"), { code: 50001 });
      return { title: candidate };
    },
    releaseClaim: async () => undefined,
    disableChannel: async reason => { disabled.push(reason); }
  });

  assert.equal(claims, 2);
  assert.equal(disabled.length, 1, "canalul e dezactivat o singura data");
  assert.deepEqual(sent, [], "nu se mai imping mesaje intr-un canal tocmai dezactivat");
  assert.equal(outcome.channelDisabled, true);
  assert.equal(outcome.claimed, 0);
});

test("persistarea ruleaza si cand trimiterea esueaza permanent", async () => {
  const log: LogLine[] = [];
  const sent: OutboundHistoryEntry[][] = [];
  const persisted: Array<{ claimed: number; unclaimed: string[]; channelDisabled: boolean }> = [];

  await runGuildNotificationCycle<string>(environment(log), {
    kind: "discount",
    guildId: "g1",
    channel: recordingChannel(sent, Object.assign(new Error("canal sters"), { code: 50001 })),
    limit: 1,
    candidates: ["a", "b", "c"],
    identify: hash => ({ itemId: hash, describe: hash, history: { itemId: hash } }),
    claim: async () => matched,
    buildEmbed: candidate => ({ title: candidate }),
    releaseClaim: async () => undefined,
    disableChannel: async () => undefined,
    persist: async outcome => { persisted.push({ ...outcome, unclaimed: [...outcome.unclaimed] }); }
  });

  assert.equal(persisted.length, 1, "starea ciclului se scrie chiar daca livrarea a cazut");
  assert.deepEqual(persisted[0].unclaimed, ["b", "c"], "candidatii nerevendicati ajung la persistare");
  assert.equal(persisted[0].channelDisabled, true);
});

test("contextul de log si tipul intrarii de istoric sunt derivate din kind, nu repetate de apelant", async () => {
  const log: LogLine[] = [];
  const sent: OutboundHistoryEntry[][] = [];

  await runGuildNotificationCycle<string>(environment(log), {
    kind: "dlc",
    guildId: "g1",
    channel: recordingChannel(sent),
    limit: 5,
    candidates: ["x", "y"],
    identify: id => ({ itemId: id, describe: `DLC ${id}`, history: { itemId: id } }),
    claim: async candidate => (candidate === "x" ? matched : Promise.reject(new Error("Mongo lent"))),
    buildEmbed: candidate => ({ title: candidate }),
    releaseClaim: async () => undefined
  });

  assert.deepEqual(sent[0]?.map(entry => entry.kind), ["dlc"]);
  const warning = log.find(line => line.level === "WARN");
  assert.equal(warning?.context, "CRON_DLC", "contextul de cron vine din registrul de tipuri");
});

test("un candidat nerevendicat nu ajunge nici in lot, nici in istoric", async () => {
  const log: LogLine[] = [];
  const sent: OutboundHistoryEntry[][] = [];
  const released: string[] = [];

  const outcome = await runGuildNotificationCycle<string>(environment(log), {
    kind: "update",
    guildId: "g1",
    channel: recordingChannel(sent),
    limit: 5,
    candidates: ["a", "b"],
    identify: id => ({ itemId: id, describe: id, history: { itemId: id } }),
    claim: async candidate => (candidate === "a" ? { matchedCount: 0 } : matched),
    buildEmbed: candidate => ({ title: candidate }),
    releaseClaim: async candidate => { released.push(candidate); }
  });

  assert.deepEqual(sent[0]?.map(entry => entry.itemId), ["b"]);
  assert.deepEqual(released, [], "ce nu s-a revendicat nu se da inapoi");
  assert.equal(outcome.claimed, 1);
});

test("esecul tranzitoriu de trimitere preda apelantului candidatii, nu intrarile interne", async () => {
  const log: LogLine[] = [];
  const sent: OutboundHistoryEntry[][] = [];
  const failed: string[] = [];

  await runGuildNotificationCycle<string>(environment(log), {
    kind: "discount",
    guildId: "g1",
    channel: recordingChannel(sent, new Error("timeout")),
    limit: 5,
    candidates: ["a", "b"],
    identify: id => ({ itemId: id, describe: id, history: { itemId: id } }),
    claim: async () => matched,
    buildEmbed: candidate => ({ title: candidate }),
    releaseClaim: async () => undefined,
    onSendFailure: (candidates) => { failed.push(...candidates); }
  });

  assert.deepEqual(failed, ["a", "b"], "apelantul primeste exact candidatii lui, ca sa-i poata re-programa");
});
