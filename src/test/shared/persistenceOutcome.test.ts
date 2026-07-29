import test from "node:test";
import assert from "node:assert/strict";

import {
  changedDocument,
  classifyWrite,
  createdDocument,
  matchedDocument,
  modifiedDocuments,
  updatedDocument
} from "../../shared/persistenceOutcome.js";

test("clasificarea distinge cele patru rezultate reale ale unei scrieri", () => {
  assert.equal(classifyWrite({ upsertedCount: 1 }), "created");
  assert.equal(classifyWrite({ matchedCount: 1, modifiedCount: 1 }), "updated");
  assert.equal(classifyWrite({ matchedCount: 1, modifiedCount: 0 }), "unchanged");
  assert.equal(classifyWrite({ matchedCount: 0, modifiedCount: 0 }), "missing");
});

test("insertul are prioritate fata de modificare, ca un upsert sa nu fie citit ca update", () => {
  assert.equal(classifyWrite({ upsertedCount: 1, matchedCount: 0, modifiedCount: 0 }), "created");
  assert.equal(createdDocument({ upsertedCount: 1 }), true);
  assert.equal(updatedDocument({ upsertedCount: 1 }), false);
  assert.equal(changedDocument({ upsertedCount: 1 }), true);
});

test("un rezultat absent sau fara contoare inseamna ca nu s-a atins niciun document", () => {
  for (const value of [null, undefined, {}]) {
    assert.equal(classifyWrite(value), "missing");
    assert.equal(matchedDocument(value), false);
    assert.equal(changedDocument(value), false);
    assert.equal(modifiedDocuments(value), 0);
  }
});

test("contoarele care nu sunt numere finite nu trec drept succes", () => {
  const notFinite = [
    { modifiedCount: Number.NaN },
    { modifiedCount: Number.POSITIVE_INFINITY },
    { matchedCount: Number.NaN },
    { upsertedCount: Number.NEGATIVE_INFINITY }
  ];
  for (const value of notFinite) {
    assert.equal(classifyWrite(value), "missing", `${JSON.stringify(value)} nu e un numar de documente`);
    assert.equal(changedDocument(value), false);
  }
});

test("documentul gasit dar nemodificat nu se confunda cu documentul lipsa", () => {
  assert.equal(matchedDocument({ matchedCount: 1, modifiedCount: 0 }), true);
  assert.equal(changedDocument({ matchedCount: 1, modifiedCount: 0 }), false);
  assert.equal(matchedDocument({ matchedCount: 0 }), false);
});

test("numarul de documente modificate ramane un numar, nu un indicator de succes", () => {
  assert.equal(modifiedDocuments({ modifiedCount: 7 }), 7);
  assert.equal(modifiedDocuments({ modifiedCount: 0 }), 0);
  assert.equal(modifiedDocuments({ matchedCount: 3 }), 0);
});
