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
    entryOf: (candidate: Candidat) => candidate.id,
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
    entryOf: () => { throw new Error("randare esuata"); },
    rollback: async (candidate: Candidat) => { anulate.push(candidate.id); }
  }));
  assert.deepEqual(anulate, ["x"], "fara rollback, candidatul ar ramane marcat ca vazut fara sa fi fost trimis vreodata");
});
