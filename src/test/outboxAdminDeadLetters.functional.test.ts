import test from "node:test";
import assert from "node:assert/strict";
import { installOutboxAdmin, makeDeps, makeInteraction } from "./outboxAdminTestKit";
import type { DeadLetterEntry } from "./outboxAdminTestKit";

test("/outbox clear-deadletters goleste lista cand exista intrari + invalideaza cache-ul", async () => {
  const { deps, replies, guildUpdateCalls, invalidatedGuilds } = makeDeps({ deadLetters: [{ kind: "update" }, { kind: "discount" }] });
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "clear-deadletters"));
  assert.match(replies[0], /2 intrare/);
  assert.equal(guildUpdateCalls.length, 1, "a scris un updateOne pe guild");
  const update = guildUpdateCalls[0].update as { $set: { notificationDeadLetter: unknown[] } };
  assert.deepEqual(update.$set.notificationDeadLetter, [], "lista de dead-letter e golita");
  assert.equal(invalidatedGuilds.length, 1, "cache-ul guild-ului e invalidat");
});

test("/outbox clear-deadletters cand lista e goala nu scrie nimic", async () => {
  const { deps, replies, guildUpdateCalls } = makeDeps({ deadLetters: [] });
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "clear-deadletters"));
  assert.match(replies[0], /Nicio livrare in dead-letter de sters/);
  assert.equal(guildUpdateCalls.length, 0, "nu se scrie cand nu e nimic de sters");
});

test("/outbox replay-deadletters reintroduce payload-urile in coada, sterge si curata auditul", async () => {
  const { deps, replies, enqueueCalls, replayDeleteCalls, guildUpdateCalls, invalidatedGuilds } = makeDeps({
    outboxEnabled: true,
    replayDocs: [
      { _id: "r1", kind: "update", channelId: "c1", payload: { embeds: [{ title: "A" }] }, dedupeKey: "dk1", recoveryVerify: true },
      { _id: "r2", kind: "discount", channelId: "c2", payload: { content: "B" }, dedupeKey: "dk2", recoveryVerify: false }
    ]
  });
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "replay-deadletters"));
  assert.match(replies[0], /2 livrare/);
  assert.equal(enqueueCalls.length, 2, "a re-enqueue-at fiecare payload");
  assert.equal(enqueueCalls[0].channelId, "c1");
  assert.equal(enqueueCalls[0].recoveryVerify, true);
  assert.equal(replayDeleteCalls.length, 1, "a sters payload-urile reluate");
  assert.deepEqual(replayDeleteCalls[0].ids, ["r1", "r2"]);
  const pull = guildUpdateCalls[0].update as { $pull: { notificationDeadLetter: { dedupeKey: { $in: string[] } } } };
  assert.deepEqual(pull.$pull.notificationDeadLetter.dedupeKey.$in, ["dk1", "dk2"], "curata auditul dupa dedupeKey");
  assert.equal(invalidatedGuilds.length, 1, "invalideaza cache-ul guild-ului");
});

test("/outbox replay-deadletters refuza cand outbox-ul e dezactivat", async () => {
  const { deps, replies, enqueueCalls } = makeDeps({ outboxEnabled: false, replayDocs: [{ _id: "r1", kind: "update", channelId: "c1", payload: {}, dedupeKey: "dk", recoveryVerify: false }] });
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "replay-deadletters"));
  assert.match(replies[0], /Replay indisponibil/);
  assert.equal(enqueueCalls.length, 0, "nu re-enqueue-aza cand outbox-ul e oprit");
});

test("/outbox replay-deadletters cand nu exista payload-uri stocate", async () => {
  const { deps, replies, enqueueCalls } = makeDeps({ outboxEnabled: true, replayDocs: [] });
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "replay-deadletters"));
  assert.match(replies[0], /Nicio livrare dead-letter cu payload stocat/);
  assert.equal(enqueueCalls.length, 0);
});

test("/outbox replay-deadletters: enqueue pica la al doilea -> primul e curatat, restul raman (fara duplicate)", async () => {
  const { deps, replies, enqueueCalls, replayDeleteCalls, guildUpdateCalls, invalidatedGuilds } = makeDeps({
    outboxEnabled: true,
    enqueueFailAt: 1,
    replayDocs: [
      { _id: "r1", kind: "update", channelId: "c1", payload: { embeds: [{ title: "A" }] }, dedupeKey: "dk1", recoveryVerify: false },
      { _id: "r2", kind: "discount", channelId: "c2", payload: { content: "B" }, dedupeKey: "dk2", recoveryVerify: false },
      { _id: "r3", kind: "update", channelId: "c3", payload: { content: "C" }, dedupeKey: "dk3", recoveryVerify: false }
    ]
  });
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "replay-deadletters"));
  assert.match(replies[0], /Replay partial/);
  assert.match(replies[0], /1 livrare/);
  assert.equal(enqueueCalls.length, 1, "doar primul a fost enqueue-at cu succes");
  assert.equal(replayDeleteCalls.length, 1, "cleanup ruleaza pentru cele reusite");
  assert.deepEqual(replayDeleteCalls[0].ids, ["r1"], "sterge doar payload-ul reusit (r1), nu r2/r3");
  const pull = guildUpdateCalls[0].update as { $pull: { notificationDeadLetter: { dedupeKey: { $in: string[] } } } };
  assert.deepEqual(pull.$pull.notificationDeadLetter.dedupeKey.$in, ["dk1"], "curata din audit doar dk1");
  assert.equal(invalidatedGuilds.length, 1);
});

test("/outbox clear-deadletters sterge si payload-urile de replay (fara replay fantoma)", async () => {
  const withEntries = makeDeps({ deadLetters: [{ kind: "update" }, { kind: "discount" }] });
  const h1 = installOutboxAdmin.createOutboxAdminHandler(withEntries.deps);
  await h1.handleOutboxInteraction(makeInteraction(null, "clear-deadletters"));
  assert.match(withEntries.replies[0], /inclusiv payload-urile de replay/);
  assert.deepEqual(withEntries.replayDeleteAllCalls, ["guild-1"], "curata si colectia de replay");

  const empty = makeDeps({ deadLetters: [] });
  const h2 = installOutboxAdmin.createOutboxAdminHandler(empty.deps);
  await h2.handleOutboxInteraction(makeInteraction(null, "clear-deadletters"));
  assert.equal(empty.guildUpdateCalls.length, 0, "nu scrie pe doc cand auditul e gol");
  assert.deepEqual(empty.replayDeleteAllCalls, ["guild-1"], "curata payload-urile de replay chiar si cand auditul e gol (orfane TTL/partial)");
});

test("/outbox clear-deadletters: daca stergerea payload-urilor de replay esueaza, raporteaza avertisment (nu succes fals)", async () => {
  const { deps, replies, guildUpdateCalls } = makeDeps({ deadLetters: [{ kind: "update" }], replayDeleteAllFails: true });
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "clear-deadletters"));
  assert.match(replies[0], /stergerea payload-urilor de replay a esuat/);
  assert.equal(guildUpdateCalls.length, 1, "auditul tot e golit");
});

test("/outbox replay-deadletters: daca curatarea dupa enqueue esueaza, mesajul spune corect ca o re-rulare NU re-trimite (R #5)", async () => {
  const { deps, replies, enqueueCalls } = makeDeps({
    outboxEnabled: true,
    replayDeleteFails: true,
    replayDocs: [{ _id: "r1", kind: "update", channelId: "c1", payload: { content: "A" }, dedupeKey: "dk1", recoveryVerify: false }]
  });
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "replay-deadletters"));
  assert.equal(enqueueCalls.length, 1, "enqueue-ul a avut loc");
  assert.match(replies[0], /curatarea din dead-letter a esuat/);
  assert.match(replies[0], /NU le re-trimite/, "mesajul e acurat: dedupe pe dedupeKey (index unique + Sent) face re-rularea idempotenta, nu avertizeaza fals despre duplicat");
});

test("/outbox replay-deadletters: la limita per rulare semnaleaza ca pot exista mai multe", async () => {
  const docs = Array.from({ length: 50 }, (_v, i) => ({ _id: `r${i}`, kind: "update" as const, channelId: "c1", payload: { i }, dedupeKey: `dk${i}`, recoveryVerify: false }));
  const { deps, replies, enqueueCalls } = makeDeps({ outboxEnabled: true, replayDocs: docs });
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "replay-deadletters"));
  assert.equal(enqueueCalls.length, 50);
  assert.match(replies[0], /limita de 50 per rulare/);
});
