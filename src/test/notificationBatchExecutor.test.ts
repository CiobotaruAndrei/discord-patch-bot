import test from "node:test";
import assert from "node:assert/strict";

import { sendEmbedBatch } from "../features/notifications/notificationBatchExecutor.js";
import type { OutboundHistoryEntry } from "../features/notifications/outboundChannel.js";

type Entry = { id: string; embed: { title: string } };

function makeEntries(count: number): Entry[] {
  return Array.from({ length: count }, (_, index) => ({ id: `e${index}`, embed: { title: `Titlu ${index}` } }));
}

function makeHarness(sendImpl?: (call: number) => Promise<unknown>) {
  const sends: Array<{ payload: Record<string, unknown>; historyEntries: OutboundHistoryEntry[] }> = [];
  const rollbacks: string[] = [];
  const sleeps: number[] = [];
  const permanentReasons: string[] = [];
  const transientCalls: Array<{ failedIds: string[]; err: unknown }> = [];
  const channel = {
    id: "channel-1",
    send: async (payload: Record<string, unknown>, meta?: { historyEntries?: OutboundHistoryEntry[] }) => {
      const call = sends.length;
      sends.push({ payload, historyEntries: meta?.historyEntries ?? [] });
      if (sendImpl) return sendImpl(call);
      return { id: "msg" };
    }
  };
  const run = (batch: Entry[], overrides: { roleId?: string | null; rollbackRejects?: boolean } = {}) => sendEmbedBatch<Entry>({
    channel,
    batch,
    embedOf: entry => entry.embed,
    historyEntryFor: entry => ({ kind: "update", itemId: entry.id }),
    messageTemplate: null,
    roleId: overrides.roleId ?? "role-9",
    maxEmbedsPerMessage: 10,
    sendDelayMs: 5,
    sleepIfPositive: async ms => { sleeps.push(ms); },
    isPermanentDiscordError: err => (err as { code?: number }).code === 50013,
    transientErrorMessage: err => String((err as Error).message || err),
    rollbackEntry: entry => {
      rollbacks.push(entry.id);
      return overrides.rollbackRejects ? Promise.reject(new Error("rollback boom")) : Promise.resolve({});
    },
    onPermanentError: async reason => { permanentReasons.push(reason); },
    onTransientFailure: (failed, err) => { transientCalls.push({ failedIds: failed.map(entry => entry.id), err }); }
  });
  return { run, sends, rollbacks, sleeps, permanentReasons, transientCalls };
}

test("sendEmbedBatch imparte pe chunk-uri de max N si pune content/mentiune doar pe primul mesaj", async () => {
  const harness = makeHarness();
  await harness.run(makeEntries(25));

  assert.equal(harness.sends.length, 3, "25 embed-uri la max 10 per mesaj = 3 trimiteri");
  assert.deepEqual(harness.sends.map(send => (send.payload.embeds as unknown[]).length), [10, 10, 5]);
  assert.equal(harness.sends[0].payload.content, "<@&role-9>", "ping-ul de rol apare pe primul mesaj");
  assert.deepEqual(harness.sends[0].payload.allowedMentions, { roles: ["role-9"] });
  assert.equal(harness.sends[1].payload.content, undefined, "mesajele urmatoare nu repeta ping-ul");
  assert.equal(harness.sends[0].historyEntries.length, 10, "istoricul se scrie per chunk");
  assert.equal(harness.sends[0].historyEntries[0].itemId, "e0");
  assert.deepEqual(harness.sleeps, [5, 5, 5], "pauza intre mesaje dupa fiecare trimitere reusita");
  assert.deepEqual(harness.rollbacks, []);
  assert.deepEqual(harness.transientCalls, []);
});

test("sendEmbedBatch la esec tranzitoriu face rollback pe TOATE chunk-urile ramase, cheama onTransientFailure o data si se opreste", async () => {
  const harness = makeHarness(call => call === 1 ? Promise.reject(new Error("ECONNRESET")) : Promise.resolve({}));
  await harness.run(makeEntries(25));

  assert.equal(harness.sends.length, 2, "dupa esecul mesajului 2 nu se mai trimite mesajul 3");
  assert.equal(harness.rollbacks.length, 15, "chunk-ul esuat + cel netrimis primesc rollback");
  assert.equal(harness.rollbacks[0], "e10", "rollback-ul incepe de la primul item al chunk-ului esuat");
  assert.equal(harness.transientCalls.length, 1);
  assert.deepEqual(harness.transientCalls[0].failedIds.slice(0, 2), ["e10", "e11"]);
  assert.equal(harness.transientCalls[0].failedIds.length, 15);
  assert.deepEqual(harness.permanentReasons, []);
});

test("sendEmbedBatch la eroare permanenta face rollback, cheama onPermanentError cu codul Discord si NU cheama onTransientFailure", async () => {
  const harness = makeHarness(() => Promise.reject(Object.assign(new Error("Missing Permissions"), { code: 50013 })));
  await harness.run(makeEntries(5));

  assert.equal(harness.sends.length, 1);
  assert.equal(harness.rollbacks.length, 5);
  assert.deepEqual(harness.permanentReasons, ["Discord cod 50013: Missing Permissions"]);
  assert.deepEqual(harness.transientCalls, []);
});

test("sendEmbedBatch inghite erorile de rollback (best-effort) si tot raporteaza esecul tranzitoriu", async () => {
  const harness = makeHarness(() => Promise.reject(new Error("ECONNRESET")));
  await harness.run(makeEntries(3), { rollbackRejects: true });

  assert.equal(harness.rollbacks.length, 3, "rollback-ul e incercat pentru fiecare item chiar daca arunca");
  assert.equal(harness.transientCalls.length, 1);
});
