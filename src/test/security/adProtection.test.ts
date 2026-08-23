import test from "node:test";
import { calls, loadModule } from "../gates/sourceStructureQueries.js";
import assert from "node:assert/strict";

import {
  AD_STRIKE_LIMIT,
  adFingerprint,
  describeStrike,
  detectAd,
  extractInvite,
  extractLink,
  normalizeAdText,
  strikeOutcome
} from "../../features/command-security/adRequestTypes.js";
import { createAdProtectionRepository } from "../../features/command-security/adProtectionRepository.js";
import { adStore } from "./adStore.js";

const T0 = new Date("2026-08-01T12:00:00.000Z");

function repository() {
  const requests = adStore();
  const attempts = adStore();
  return { requests, attempts, repo: createAdProtectionRepository(requests, attempts) };
}

test("o invitatie catre alt server e reclama, chiar fara text de promovare", () => {
  const detection = detectAd("hai si tu discord.gg/abcdef", 0);
  assert.equal(detection.isAd, true);
  assert.equal(detection.invite, "discord.gg/abcdef");
  assert.match(detection.reasons.join(" "), /invitatie/);
});

test("promovarea fara link e detectata, asa cum cere specificatia", () => {
  const detection = detectAd("Intra pe serverul meu, avem tot ce vrei", 0);
  assert.equal(detection.isAd, true, "reclamele fara link direct trebuie prinse");
  assert.equal(detection.link, null);
  assert.match(detection.reasons.join(" "), /promovare/);
});

test("o conversatie obisnuita cu link nu e reclama", () => {
  assert.equal(detectAd("uite articolul https://exemplu.ro/stiri", 0).isAd, false);
  assert.equal(detectAd("salut, ce faceti?", 0).isAd, false);
  assert.equal(detectAd("am pus o poza", 1).isAd, false, "un atasament singur nu e reclama");
});

test("un link insotit de text de promovare e reclama", () => {
  const detection = detectAd("aboneaza-te aici https://youtube.com/c/ceva", 0);
  assert.equal(detection.isAd, true);
  assert.equal(detection.link, "https://youtube.com/c/ceva");
});

test("normalizarea si amprenta prind aceeasi reclama scrisa usor diferit", () => {
  assert.equal(normalizeAdText("Intra   pe SERVERUL meu!!!"), "intra pe serverul meu");
  assert.equal(
    adFingerprint("Intra pe serverul meu!!!", null),
    adFingerprint("intra   pe  serverul  meu", null),
    "modificarile cosmetice nu au voie sa scape de aprobare"
  );
  assert.notEqual(
    adFingerprint("Intra pe serverul meu", null),
    adFingerprint("Intra pe serverul meu", { name: "x.png", size: 1024 }),
    "adaugarea unui atasament schimba reclama, deci invalideaza aprobarea"
  );
});

test("linkurile si invitatiile sunt extrase din text", () => {
  assert.equal(extractInvite("vezi discord.com/invite/xyz1"), "discord.com/invite/xyz1");
  assert.equal(extractInvite("fara nimic"), null);
  assert.equal(extractLink("intra pe www.exemplu.ro acum"), "www.exemplu.ro");
});

test("cele trei trepte de tentativa spun exact ce urmeaza", () => {
  assert.deepEqual(strikeOutcome(1), { kind: "first", strikes: 1 });
  assert.deepEqual(strikeOutcome(2), { kind: "warning", strikes: 2 });
  assert.deepEqual(strikeOutcome(3), { kind: "warn-issued", strikes: 3 });
  assert.match(describeStrike(strikeOutcome(2)), /Urmatoarea tentativa produce un warn/);
  assert.match(describeStrike(strikeOutcome(3)), /revine la 0\/3/);
});

test("contorul urca 1, 2, apoi emite warn si revine la zero, pastrand istoricul", async () => {
  const setup = repository();

  const first = await setup.repo.recordAttempt("g1", "u1", "c1", "invitatie", T0);
  const second = await setup.repo.recordAttempt("g1", "u1", "c1", "invitatie", T0);
  const third = await setup.repo.recordAttempt("g1", "u1", "c1", "invitatie", T0);

  assert.equal(first.kind, "first");
  assert.equal(second.kind, "warning");
  assert.equal(third.kind, "warn-issued");

  const stored = await setup.repo.readAttempts("g1", "u1");
  assert.equal(stored?.strikes, 0, "dupa warn contorul revine la 0/3");
  assert.equal(stored?.totalDeleted, 3, "totalul reclamelor sterse nu se reseteaza");
  assert.equal(stored?.totalWarns, 1);
  assert.equal(stored?.history.length, 3, "istoricul ramane salvat");
  assert.equal(stored?.history[2].warned, true);
});

test("al patrulea ciclu porneste iar de la 1/3, cu warn-urile cumulate", async () => {
  const setup = repository();
  for (let index = 0; index < 3; index += 1) await setup.repo.recordAttempt("g1", "u1", "c1", "spam", T0);

  const next = await setup.repo.recordAttempt("g1", "u1", "c1", "spam", T0);

  assert.equal(next.kind, "first");
  const stored = await setup.repo.readAttempts("g1", "u1");
  assert.equal(stored?.strikes, 1);
  assert.equal(stored?.totalWarns, 1);
  assert.equal(stored?.totalDeleted, 4);
});

test("contoarele a doi utilizatori si a doua servere nu se amesteca", async () => {
  const setup = repository();
  await setup.repo.recordAttempt("g1", "u1", "c1", "spam", T0);
  await setup.repo.recordAttempt("g1", "u2", "c1", "spam", T0);
  await setup.repo.recordAttempt("g2", "u1", "c1", "spam", T0);

  assert.equal((await setup.repo.readAttempts("g1", "u1"))?.strikes, 1);
  assert.equal((await setup.repo.readAttempts("g1", "u2"))?.strikes, 1);
  assert.equal((await setup.repo.readAttempts("g2", "u1"))?.strikes, 1);
});

test("o aprobare exacta se consuma o singura data", async () => {
  const setup = repository();
  const fingerprint = adFingerprint("Intra pe serverul meu", null);
  await setup.repo.createRequest({
    requestId: "ad-1", guildId: "g1", requesterId: "u1", adText: "Intra pe serverul meu",
    fingerprint, link: null, invite: null, attachmentUrl: null, target: "server"
  }, T0);
  await setup.repo.resolveRequest("g1", "ad-1", "approved", "owner-1", T0);

  const first = await setup.repo.consumeApproval("g1", "u1", fingerprint, T0);
  const second = await setup.repo.consumeApproval("g1", "u1", fingerprint, T0);

  assert.equal(first?.status, "used");
  assert.equal(second, null, "o aprobare folosita nu mai acopera o a doua publicare");
});

test("aprobarea nu acopera alta reclama si nici alt utilizator", async () => {
  const setup = repository();
  const fingerprint = adFingerprint("Intra pe serverul meu", null);
  await setup.repo.createRequest({
    requestId: "ad-1", guildId: "g1", requesterId: "u1", adText: "Intra pe serverul meu",
    fingerprint, link: null, invite: null, attachmentUrl: null, target: null
  }, T0);
  await setup.repo.resolveRequest("g1", "ad-1", "approved", "owner-1", T0);

  assert.equal(await setup.repo.consumeApproval("g1", "u1", adFingerprint("cu totul altceva", null), T0), null,
    "modificarea semnificativa a reclamei invalideaza aprobarea");
  assert.equal(await setup.repo.consumeApproval("g1", "alt-user", fingerprint, T0), null,
    "aprobarea e legata de utilizatorul exact");
});

test("o cerere respinsa nu poate fi consumata", async () => {
  const setup = repository();
  const fingerprint = adFingerprint("reclama", null);
  await setup.repo.createRequest({
    requestId: "ad-1", guildId: "g1", requesterId: "u1", adText: "reclama",
    fingerprint, link: null, invite: null, attachmentUrl: null, target: null
  }, T0);
  await setup.repo.resolveRequest("g1", "ad-1", "rejected", "owner-1", T0);

  assert.equal(await setup.repo.consumeApproval("g1", "u1", fingerprint, T0), null);
  assert.equal((await setup.repo.readRequest("g1", "ad-1"))?.status, "rejected");
});

test("o aprobare expirata nu mai trece", async () => {
  const setup = repository();
  const fingerprint = adFingerprint("reclama", null);
  await setup.repo.createRequest({
    requestId: "ad-1", guildId: "g1", requesterId: "u1", adText: "reclama",
    fingerprint, link: null, invite: null, attachmentUrl: null, target: null
  }, T0);
  await setup.repo.resolveRequest("g1", "ad-1", "approved", "owner-1", T0);

  const later = new Date(T0.getTime() + 2 * 60 * 60 * 1000);
  assert.equal(await setup.repo.consumeApproval("g1", "u1", fingerprint, later), null);
  assert.equal((await setup.repo.readRequest("g1", "ad-1"))?.status, "expired");
});

test("/stop ad-protection anuleaza cererile si aprobarile active, pastrand istoricul", async () => {
  const setup = repository();
  for (const [id, requester] of [["ad-1", "u1"], ["ad-2", "u2"]] as const) {
    await setup.repo.createRequest({
      requestId: id, guildId: "g1", requesterId: requester, adText: "reclama",
      fingerprint: adFingerprint(`reclama ${id}`, null), link: null, invite: null, attachmentUrl: null, target: null
    }, T0);
  }
  await setup.repo.resolveRequest("g1", "ad-2", "approved", "owner-1", T0);
  await setup.repo.recordAttempt("g1", "u1", "c1", "spam", T0);

  await setup.repo.cancelActiveRequests("g1");

  const listed = await setup.repo.listRequests("g1", 10, T0);
  assert.deepEqual(listed.map(entry => entry.status).sort(), ["cancelled", "cancelled"]);
  assert.equal((await setup.repo.readAttempts("g1", "u1"))?.totalDeleted, 1, "istoricul tentativelor ramane salvat");
});

test("limita de tentative din specificatie este trei", () => {
  assert.equal(AD_STRIKE_LIMIT, 3);
});

test("amprenta atasamentului foloseste hash-ul continutului, nu URL-ul CDN (F-39)", () => {
  const uploaded = { name: "promo.png", size: 2048, hash: "a".repeat(64) };
  const reposted = { name: "promo.png", size: 2048, hash: "a".repeat(64) };

  assert.equal(
    adFingerprint("Intra pe serverul meu", uploaded),
    adFingerprint("Intra pe serverul meu", reposted),
    "URL-ul CDN difera intre incarcarea din /ad-request si mesajul publicat; cu el in amprenta, o reclama aprobata cu atasament nu s-ar potrivi niciodata"
  );
  assert.notEqual(
    adFingerprint("Intra pe serverul meu", uploaded),
    adFingerprint("Intra pe serverul meu", { name: "promo.png", size: 2048, hash: "b".repeat(64) }),
    "acelasi nume si aceeasi dimensiune, alt continut: ramane o reclama diferita"
  );
  assert.notEqual(
    adFingerprint("Intra pe serverul meu", uploaded),
    adFingerprint("Intra pe serverul meu", { name: "promo.png", size: 9999 }),
    "acelasi nume cu alt continut nu trece drept aceeasi reclama"
  );
});

test("bootstrap-ul de comenzi furnizeaza cititorul de octeti, altfel orice aprobare cu atasament e inutilizabila (review PR #967)", () => {
  const registry = loadModule("features", "command-registry", "commandRegistry.ts");
  const used = new Set(calls(registry).map(call => call.callee));

  assert.ok(
    used.has("createAttachmentBytesReader"),
    "fara cititor, /ad-request salveaza o amprenta neverificata pe care consumul o refuza explicit"
  );
});
