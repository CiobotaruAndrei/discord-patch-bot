import test from "node:test";
import assert from "node:assert/strict";

import { createTransactionRunner, detectTransactionSupport } from "../../infra/mongo/transactionRunner.js";

function mongooseCu(hello: Record<string, unknown> | Error) {
  return {
    connection: {
      db: {
        admin: () => ({
          async command() {
            if (hello instanceof Error) throw hello;
            return hello;
          }
        })
      }
    }
  };
}

test("un replica set si un cluster shardat sunt recunoscute ca suportand tranzactii", async () => {
  assert.equal(await detectTransactionSupport(mongooseCu({ setName: "rs0" })), "replica-set");
  assert.equal(await detectTransactionSupport(mongooseCu({ msg: "isdbgrid" })), "sharded");
});

test("un Mongo standalone e recunoscut ca atare, nu presupus capabil", async () => {
  assert.equal(
    await detectTransactionSupport(mongooseCu({ ok: 1 })),
    "standalone",
    "docker-compose-ul repo-ului si serviciul din CI ruleaza standalone; withTransaction ar arunca acolo"
  );
});

test("o eroare la interogarea topologiei nu e confundata cu suport", async () => {
  assert.equal(
    await detectTransactionSupport(mongooseCu(new Error("fara permisiuni de admin"))),
    "unknown",
    "necunoscut inseamna cale secventiala; a presupune suport ar rupe operatiile in productie"
  );
});

test("pe standalone munca ruleaza secvential, fara sesiune", async () => {
  let sesiuni = 0;
  const mongoose = { startSession: async () => { sesiuni += 1; return { endSession: () => undefined }; } };
  const runner = createTransactionRunner(mongoose, "standalone", () => undefined);

  const primite: Array<unknown> = [];
  const rezultat = await runner.atomic("reset", async session => { primite.push(session); return 42; });

  assert.equal(rezultat, 42);
  assert.equal(sesiuni, 0, "pe standalone nu se deschide sesiune; ar fi respinsa de server");
  assert.deepEqual(primite, [null], "operatiile primesc null si scriu ca pana acum, cu jurnalul drept recuperare");
});

test("pe replica set munca ruleaza in tranzactie si sesiunea se inchide mereu", async () => {
  let inchisa = false;
  const session = {
    endSession: () => { inchisa = true; },
    async withTransaction(fn: () => Promise<void>) { await fn(); }
  };
  const runner = createTransactionRunner({ startSession: async () => session }, "replica-set", () => undefined);

  const primite: Array<unknown> = [];
  const rezultat = await runner.atomic("reset", async s => { primite.push(s); return "gata"; });

  assert.equal(rezultat, "gata");
  assert.equal(primite[0], session, "munca primeste sesiunea, ca scrierile sa intre in aceeasi tranzactie");
  assert.equal(inchisa, true);
});

test("o tranzactie esuata inchide sesiunea si propaga eroarea", async () => {
  let inchisa = false;
  const session = {
    endSession: () => { inchisa = true; },
    async withTransaction(fn: () => Promise<void>) { await fn(); }
  };
  const avertismente: string[] = [];
  const runner = createTransactionRunner(
    { startSession: async () => session },
    "replica-set",
    (_level, _ctx, message) => avertismente.push(message)
  );

  await assert.rejects(
    runner.atomic("reset", async () => { throw new Error("scriere respinsa"); }),
    /scriere respinsa/,
    "eroarea nu are voie sa fie inghitita: apelantul trebuie sa stie ca operatia nu s-a facut"
  );
  assert.equal(inchisa, true, "sesiunea se inchide si pe calea de eroare, altfel se scurg sesiuni pe server");
  assert.equal(avertismente.length, 1, "esecul e semnalat, cu mentiunea ca jurnalul ramane calea de recuperare");
});
