import test from "node:test";
import assert from "node:assert/strict";
import { installOutboxAdmin, makeDeps, makeInteraction } from "../outboxAdminTestKit.js";
import type { DeadLetterEntry } from "../outboxAdminTestKit.js";

test("/outbox status afiseaza coada, dead-letter si starea recovery-verify", async () => {
  const { deps, replies } = makeDeps({ guildQueued: 3, totalQueued: 12, perGuildVerify: true, deadLetters: [{ kind: "update" }], outboxEnabled: true, recoveryVerifyGlobal: false, recoveryStrict: true });
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "status"));
  assert.match(replies[0], /Joburi in coada \(acest server\): \*\*3\*\*/);
  assert.match(replies[0], /Joburi in coada \(global\): \*\*12\*\*/);
  assert.match(replies[0], /Dead-letter \(acest server\): \*\*1\*\*/);
  assert.match(replies[0], /Recovery-verify acest server: \*\*ON\*\*/);
  assert.match(replies[0], /strict: \*\*ON\*\*/);
});

test("/outbox deadletters listeaza intrarile sau spune ca e gol", async () => {
  const empty = makeDeps({ deadLetters: [] });
  const h1 = installOutboxAdmin.createOutboxAdminHandler(empty.deps);
  await h1.handleOutboxInteraction(makeInteraction(null, "deadletters"));
  assert.match(empty.replies[0], /Nicio livrare in dead-letter/);

  const filled = makeDeps({ deadLetters: [{ kind: "discount", title: "Joc X", reason: "permanent", attempts: 1, failedAt: new Date(0) }] });
  const h2 = installOutboxAdmin.createOutboxAdminHandler(filled.deps);
  await h2.handleOutboxInteraction(makeInteraction(null, "deadletters"));
  assert.match(filled.replies[0], /Joc X/);
  assert.match(filled.replies[0], /permanent/);
});

test("/outbox retry reprogrameaza doar joburile acestui server", async () => {
  const { deps, replies, updateManyCalls } = makeDeps({ updateManyResult: { modifiedCount: 4 } });
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "retry"));
  assert.equal(updateManyCalls.length, 1);
  assert.deepEqual(updateManyCalls[0].filter, { guildId: "guild-1" });
  const update = updateManyCalls[0].update as { $set: { availableAt: Date }; $unset: Record<string, string> };
  assert.ok(update.$set.availableAt instanceof Date, "seteaza availableAt acum");
  assert.ok("lockedUntil" in update.$unset && "lockedBy" in update.$unset, "elibereaza lease-ul");
  assert.match(replies[0], /4 joburi/);
});

test("/outbox retry fara joburi raspunde corespunzator", async () => {
  const { deps, replies } = makeDeps({ updateManyResult: { modifiedCount: 0 } });
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "retry"));
  assert.match(replies[0], /Nu exista joburi in coada/);
});

test("/outbox drain-now: lock liber -> dreneaza, elibereaza lock-ul si raporteaza", async () => {
  const { deps, replies, lockCalls, releaseCalls, getDrainCalls } = makeDeps({ drainResult: { sent: 4, retried: 1, deadLettered: 0, queued: 2 }, outboxGlobalAdminIds: ["op-1"] });
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "drain-now", "op-1"));
  assert.equal(lockCalls.length, 1);
  assert.equal(lockCalls[0].name, "outbox_drain", "foloseste lock-ul dedicat outbox_drain");
  assert.equal(getDrainCalls(), 1, "a drenat o data");
  assert.equal(releaseCalls.length, 1, "a eliberat lock-ul");
  assert.match(replies[0], /trimise \*\*4\*\*/);
  assert.match(replies[0], /ramase in coada \*\*2\*\*/);
});

test("/outbox drain-now: lock detinut -> raporteaza ocupat, nu dreneaza", async () => {
  const { deps, replies, getDrainCalls, releaseCalls } = makeDeps({ lockToken: null, outboxGlobalAdminIds: ["op-1"] });
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "drain-now", "op-1"));
  assert.equal(getDrainCalls(), 0, "nu dreneaza cand lock-ul e detinut");
  assert.equal(releaseCalls.length, 0, "nu elibereaza un lock pe care nu l-a obtinut");
  assert.match(replies[0], /detinut de o alta drenare/);
});

test("/outbox drain-now: outbox dezactivat -> mesaj, fara lock", async () => {
  const { deps, replies, lockCalls, getDrainCalls } = makeDeps({ outboxEnabled: false, outboxGlobalAdminIds: ["op-1"] });
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "drain-now", "op-1"));
  assert.equal(lockCalls.length, 0, "nu incearca lock daca outbox-ul e oprit");
  assert.equal(getDrainCalls(), 0);
  assert.match(replies[0], /nu este activat/);
});

test("/outbox drain-now: outbox pe pauza -> refuza fara lock si fara drenare", async () => {
  const { deps, replies, lockCalls, getDrainCalls } = makeDeps({ paused: true, outboxGlobalAdminIds: ["op-1"] });
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "drain-now", "op-1"));
  assert.equal(lockCalls.length, 0, "nu ia lock-ul cat outbox-ul este pe pauza");
  assert.equal(getDrainCalls(), 0, "nu dreneaza manual peste pauza globala");
  assert.match(replies[0], /pe pauza/);
  assert.match(replies[0], /\/outbox resume/);
});

test("/outbox drain-now refuza un admin care NU e operator bot (operatie globala, R13 #1)", async () => {
  const { deps, replies, lockCalls, getDrainCalls } = makeDeps({ outboxGlobalAdminIds: ["op-1"] });
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "drain-now", "alt-admin"));
  assert.equal(lockCalls.length, 0, "un admin din afara allowlist-ului nu poate porni drenarea globala");
  assert.equal(getDrainCalls(), 0, "nu dreneaza pentru un ne-operator");
  assert.match(replies[0], /operatie globala/i);
  assert.match(replies[0], /NOTIFICATION_OUTBOX_GLOBAL_ADMIN_IDS/);
});

test("/outbox status afiseaza starea de drenare (activa/pe pauza)", async () => {
  const active = makeDeps({ paused: false });
  const h1 = installOutboxAdmin.createOutboxAdminHandler(active.deps);
  await h1.handleOutboxInteraction(makeInteraction(null, "status"));
  assert.match(active.replies[0], /Drenare: \*\*ACTIVA\*\*/);

  const paused = makeDeps({ paused: true });
  const h2 = installOutboxAdmin.createOutboxAdminHandler(paused.deps);
  await h2.handleOutboxInteraction(makeInteraction(null, "status"));
  assert.match(paused.replies[0], /Drenare: \*\*PE PAUZA\*\*/);
});

test("/outbox status afiseaza NECUNOSCUTA cand citirea starii de pauza esueaza, nu ACTIVA (fail-safe, R13 #4)", async () => {
  const { deps, replies } = makeDeps({ pausedReadFails: true });
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "status"));
  assert.match(replies[0], /Drenare: \*\*NECUNOSCUTA/, "o citire esuata nu trebuie raportata ca ACTIVA");
  assert.doesNotMatch(replies[0], /Drenare: \*\*ACTIVA\*\*/, "nu pretinde ca drenarea e activa pe stare necunoscuta");
});

test("/outbox pause si /outbox resume comuta flagul de drenare cand apelantul e operator bot (in allowlist)", async () => {
  const { deps, replies, pauseCalls } = makeDeps({ outboxGlobalAdminIds: ["op-1"] });
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "pause", "op-1"));
  await handler.handleOutboxInteraction(makeInteraction(null, "resume", "op-1"));
  assert.deepEqual(pauseCalls, [true, false], "pause -> true, resume -> false");
  assert.match(replies[0], /pusa pe pauza/);
  assert.match(replies[1], /reluata/);
});

test("/outbox pause refuza un admin de guild care NU e in allowlist-ul de operatori (operatie globala, R12 #1)", async () => {
  const { deps, replies, pauseCalls } = makeDeps({ outboxGlobalAdminIds: ["op-1"] });
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "pause", "alt-admin"));
  assert.equal(pauseCalls.length, 0, "un admin din afara allowlist-ului nu poate pune outbox-ul global pe pauza");
  assert.match(replies[0], /operatie globala/i);
  assert.match(replies[0], /NOTIFICATION_OUTBOX_GLOBAL_ADMIN_IDS/);
});

test("/outbox resume e indisponibil cand allowlist-ul de operatori e gol (safe-by-default, R12 #1)", async () => {
  const { deps, replies, pauseCalls } = makeDeps({ outboxGlobalAdminIds: [] });
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "resume", "op-1"));
  assert.equal(pauseCalls.length, 0, "fara allowlist configurat, nimeni nu poate comuta pauza globala");
  assert.match(replies[0], /indisponibila/i);
  assert.match(replies[0], /NOTIFICATION_OUTBOX_GLOBAL_ADMIN_IDS/);
});

