import test from "node:test";
import assert from "node:assert/strict";

import { claimIntoBatch } from "../../features/notifications/notificationCycle.js";

type Candidat = { id: string };

function optiuni(over: Partial<Parameters<typeof claimIntoBatch<Candidat, string>>[0]> = {}) {
  return {
    candidates: [{ id: "a" }, { id: "b" }, { id: "c" }] as Candidat[],
    limit: 10,
    context: "TEST",
    logger: () => undefined,
    claim: async () => ({ matchedCount: 1 }),
    prepare: (candidate: Candidat) => candidate.id,
    rollback: async () => undefined,
    describe: (candidate: Candidat) => candidate.id,
    isPermanentError: () => false,
    onPermanentError: async () => undefined,
    errorMessage: (err: unknown) => String(err),
    ...over
  };
}

test("un candidat deja revendicat de altcineva e sarit, nu trimis a doua oara", async () => {
  const rezultat = await claimIntoBatch<Candidat, string>(optiuni({
    claim: async (candidate: Candidat) => ({ matchedCount: candidate.id === "b" ? 0 : 1 })
  }));
  assert.deepEqual(rezultat.batch, ["a", "c"], "matchedCount 0 inseamna ca alt proces l-a luat deja");
});

test("plafonul opreste adunarea, ca un ciclu sa nu trimita nelimitat", async () => {
  const rezultat = await claimIntoBatch<Candidat, string>(optiuni({ limit: 2 }));
  assert.deepEqual(rezultat.batch, ["a", "b"]);
});

test("o eroare tranzitorie sare candidatul si continua cu restul", async () => {
  const jurnal: string[] = [];
  const rezultat = await claimIntoBatch<Candidat, string>(optiuni({
    claim: async (candidate: Candidat) => {
      if (candidate.id === "b") throw new Error("retea");
      return { matchedCount: 1 };
    },
    logger: (_l: string, _c: string, message: string) => jurnal.push(message)
  }));
  assert.deepEqual(rezultat.batch, ["a", "c"], "un esec pe un candidat nu are voie sa opreasca ciclul");
  assert.equal(rezultat.stopped, false);
  assert.equal(jurnal.length, 1);
});

test("o eroare permanenta opreste ciclul si anunta apelantul", async () => {
  let oprit = false;
  const rezultat = await claimIntoBatch<Candidat, string>(optiuni({
    claim: async (candidate: Candidat) => {
      if (candidate.id === "b") throw new Error("cod 50001");
      return { matchedCount: 1 };
    },
    isPermanentError: () => true,
    onPermanentError: async () => { oprit = true; }
  }));
  assert.equal(rezultat.stopped, true, "apelantul trebuie sa stie ca s-a oprit, ca sa nu trimita batch-ul partial ca si cum ar fi complet");
  assert.deepEqual(rezultat.batch, ["a"], "ce s-a revendicat inainte de oprire ramane vizibil");
  assert.equal(oprit, true);
});

test("revendicarea reusita urmata de eroare se da inapoi, ca sa nu ramana marcat trimis", async () => {
  const anulate: string[] = [];
  await claimIntoBatch<Candidat, string>(optiuni({
    candidates: [{ id: "x" }],
    claim: async () => ({ matchedCount: 1 }),
    prepare: () => { throw new Error("randare esuata"); },
    rollback: async (candidate: Candidat) => { anulate.push(candidate.id); }
  }));
  assert.deepEqual(anulate, ["x"], "fara rollback, candidatul ar ramane marcat ca vazut fara sa fi fost trimis vreodata");
});

test("sursa prin pull consuma candidatii pana cand se termina, nu doar dintr-un array", async () => {
  const coada: Candidat[] = [{ id: "p1" }, { id: "p2" }, { id: "p3" }];
  const rezultat = await claimIntoBatch<Candidat, string>(optiuni({
    candidates: undefined,
    pull: () => coada.shift() ?? null
  }));
  assert.deepEqual(rezultat.batch, ["p1", "p2", "p3"]);
  assert.deepEqual(rezultat.remaining, [], "o sursa prin pull nu raporteaza rest");
});

test("politica stop opreste ciclul la prima eroare tranzitorie si raporteaza restul", async () => {
  const tratate: string[] = [];
  const rezultat = await claimIntoBatch<Candidat, string>(optiuni({
    candidates: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
    prepare: (candidate: Candidat) => {
      if (candidate.id === "b") throw new Error("pregatire esuata");
      return candidate.id;
    },
    onTransientError: (candidate: Candidat) => { tratate.push(candidate.id); },
    transientPolicy: "stop"
  }));
  assert.deepEqual(rezultat.batch, ["a"]);
  assert.deepEqual(tratate, ["b"], "candidatul cazut e predat politicii de retry, nu pierdut");
  assert.deepEqual(rezultat.remaining.map(item => item.id), ["c", "d"], "restul se intoarce in coada, nu se arunca");
  assert.equal(rezultat.stopped, false, "oprirea pe eroare tranzitorie nu e acelasi lucru cu oprirea pe eroare permanenta");
});

test("politica implicita continua peste eroarea tranzitorie si nu lasa rest", async () => {
  const rezultat = await claimIntoBatch<Candidat, string>(optiuni({
    candidates: [{ id: "a" }, { id: "b" }, { id: "c" }],
    prepare: (candidate: Candidat) => {
      if (candidate.id === "b") throw new Error("pregatire esuata");
      return candidate.id;
    }
  }));
  assert.deepEqual(rezultat.batch, ["a", "c"]);
  assert.deepEqual(rezultat.remaining, []);
});

test("o eroare permanenta opreste ciclul si nu lasa candidati in rest", async () => {
  const rezultat = await claimIntoBatch<Candidat, string>(optiuni({
    candidates: [{ id: "a" }, { id: "b" }, { id: "c" }],
    prepare: (candidate: Candidat) => {
      if (candidate.id === "b") throw new Error("permanent");
      return candidate.id;
    },
    isPermanentError: () => true
  }));
  assert.equal(rezultat.stopped, true);
  assert.deepEqual(rezultat.batch, ["a"]);
  assert.deepEqual(rezultat.remaining, [], "dupa o eroare permanenta canalul e oprit, deci restul nu se mai reprogrameaza");
});

test("pregatirea asincrona e asteptata inainte de a intra in batch", async () => {
  const rezultat = await claimIntoBatch<Candidat, string>(optiuni({
    candidates: [{ id: "a" }],
    prepare: async (candidate: Candidat) => `${candidate.id}-imbogatit`
  }));
  assert.deepEqual(rezultat.batch, ["a-imbogatit"]);
});
