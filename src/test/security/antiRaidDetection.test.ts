import test from "node:test";
import assert from "node:assert/strict";

import {
  createRaidDetector,
  normalizeMessageText,
  signalsFromMessage,
  structureSignal
} from "../../features/command-security/antiRaidDetection.js";
import { DEFAULT_ANTI_RAID_THRESHOLDS } from "../../features/command-security/antiRaidThresholds.js";

const T0 = 1_000_000;

function detector(overrides: Partial<typeof DEFAULT_ANTI_RAID_THRESHOLDS> = {}) {
  return createRaidDetector({ thresholds: { ...DEFAULT_ANTI_RAID_THRESHOLDS, ...overrides } });
}

function message(overrides: Partial<Parameters<typeof signalsFromMessage>[0]> = {}) {
  return signalsFromMessage({
    actorId: "u1", bot: false, channelId: "c1", content: "salut", mentionCount: 0, attachmentCount: 0, at: T0,
    ...overrides
  });
}

test("normalizarea ignora linkurile, mentiunile si punctuatia, ca variatiile mici sa nu scape", () => {
  assert.equal(normalizeMessageText("Salut!!! <@123> https://x.io"), "salut");
  assert.equal(normalizeMessageText("SALUT   salut"), "salut salut");
  assert.equal(
    normalizeMessageText("Castiga bani ACUM!!!"),
    normalizeMessageText("castiga   bani acum"),
    "aproape identice trebuie sa cada in acelasi cos"
  );
  assert.equal(normalizeMessageText("   "), "");
});

test("trei mesaje identice in fereastra confirma raidul, doua nu", () => {
  const engine = detector();

  assert.equal(engine.observeAll(message({ content: "reclama" }), T0).triggered, false);
  assert.equal(engine.observeAll(message({ content: "reclama", at: T0 + 2_000 }), T0 + 2_000).triggered, false);
  const verdict = engine.observeAll(message({ content: "reclama", at: T0 + 5_000 }), T0 + 5_000);

  assert.equal(verdict.triggered, true);
  assert.deepEqual(verdict.kinds, ["identical"]);
  assert.deepEqual(verdict.actorIds, ["u1"]);
  assert.deepEqual(verdict.channelIds, ["c1"]);
});

test("aceleasi trei mesaje intinse peste fereastra nu confirma nimic", () => {
  const engine = detector();
  engine.observeAll(message({ content: "reclama" }), T0);
  engine.observeAll(message({ content: "reclama", at: T0 + 5_000 }), T0 + 5_000);

  const verdict = engine.observeAll(message({ content: "reclama", at: T0 + 20_000 }), T0 + 20_000);

  assert.equal(verdict.triggered, false, "fereastra de 8s a expirat pentru primele doua mesaje");
});

test("mesaje diferite de la acelasi autor nu se aduna ca mesaje identice", () => {
  const engine = detector();
  engine.observeAll(message({ content: "unu" }), T0);
  engine.observeAll(message({ content: "doi", at: T0 + 1_000 }), T0 + 1_000);
  const verdict = engine.observeAll(message({ content: "trei", at: T0 + 2_000 }), T0 + 2_000);

  assert.equal(verdict.triggered, false, "conversatia normala nu e spam");
});

test("mesaje identice de la autori diferiti nu se aduna in acelasi cos", () => {
  const engine = detector();
  engine.observeAll(message({ actorId: "u1", content: "salutare tuturor" }), T0);
  engine.observeAll(message({ actorId: "u2", content: "salutare tuturor", at: T0 + 1_000 }), T0 + 1_000);
  const verdict = engine.observeAll(message({ actorId: "u3", content: "salutare tuturor", at: T0 + 2_000 }), T0 + 2_000);

  assert.equal(verdict.triggered, false, "trei persoane care spun acelasi lucru nu sunt automat un raid");
});

test("pragul de taguri se masoara pe numarul de mentiuni, nu pe numarul de mesaje", () => {
  const engine = detector();

  const single = engine.observeAll(message({ content: "hei", mentionCount: 4 }), T0);
  assert.equal(single.triggered, true, "un singur mesaj cu 4 mentiuni depaseste deja pragul");
  assert.deepEqual(single.kinds, ["mention"]);

  const slow = detector();
  slow.observeAll(message({ content: "hei", mentionCount: 2 }), T0);
  const second = slow.observeAll(message({ content: "hai", mentionCount: 1, at: T0 + 1_000 }), T0 + 1_000);
  assert.equal(second.triggered, false, "3 mentiuni raman sub pragul de minimum 4");
  const third = slow.observeAll(message({ content: "hop", mentionCount: 1, at: T0 + 2_000 }), T0 + 2_000);
  assert.equal(third.triggered, true, "a patra mentiune atinge pragul");
});

test("invitatiile sunt recunoscute pe mai multe domenii cunoscute", () => {
  const engine = detector();
  engine.observeAll(message({ content: "vino pe discord.gg/abcd" }), T0);
  engine.observeAll(message({ content: "sau pe dsc.gg/altul", at: T0 + 1_000 }), T0 + 1_000);
  const verdict = engine.observeAll(message({ content: "ori discord.com/invite/xyz", at: T0 + 2_000 }), T0 + 2_000);

  assert.equal(verdict.triggered, true);
  assert.ok(verdict.kinds.includes("invite"));
});

test("atasamentele conteaza la pragul de linkuri, chiar fara text", () => {
  const engine = detector();
  for (let index = 0; index < 3; index += 1) {
    engine.observeAll(message({ content: "", attachmentCount: 1, at: T0 + index * 1_000 }), T0 + index * 1_000);
  }
  const verdict = engine.observeAll(message({ content: "", attachmentCount: 1, at: T0 + 3_000 }), T0 + 3_000);

  assert.equal(verdict.triggered, true);
  assert.deepEqual(verdict.kinds, ["link"]);
});

test("trei modificari de structura fara autorizatie confirma raidul", () => {
  const engine = detector();
  engine.observe(structureSignal("mod-1", false, "c1", T0));
  engine.observe(structureSignal("mod-1", false, "c2", T0 + 5_000));
  const verdict = engine.observe(structureSignal("mod-1", false, "c3", T0 + 10_000));

  assert.equal(verdict.triggered, true);
  assert.deepEqual(verdict.kinds, ["structure"]);
  assert.match(verdict.reason, /canale sau roluri/);
});

test("doi participanti la acelasi tip de spam sunt marcati ca actiune coordonata", () => {
  const engine = detector({ identicalMessages: 2 });
  engine.observeAll(message({ actorId: "u1", content: "cumpara acum" }), T0);
  engine.observeAll(message({ actorId: "u2", content: "cumpara acum", at: T0 + 1_000 }), T0 + 1_000);
  engine.observeAll(message({ actorId: "u1", content: "cumpara acum", at: T0 + 2_000 }), T0 + 2_000);
  const verdict = engine.observeAll(message({ actorId: "u2", content: "cumpara acum", at: T0 + 3_000 }), T0 + 3_000);

  assert.equal(verdict.triggered, true);
  assert.equal(verdict.coordinated, true);
  assert.deepEqual(verdict.actorIds, ["u1", "u2"], "ambii participanti intra in incident, nu doar cel care a depasit pragul");
  assert.match(verdict.reason, /coordonat, 2 participanti/);
});

test("un singur spammer nu e marcat coordonat si nu trage alti autori in incident", () => {
  const engine = detector();
  engine.observeAll(message({ actorId: "curat", content: "buna ziua" }), T0);
  engine.observeAll(message({ actorId: "u1", content: "spam spam" }), T0);
  engine.observeAll(message({ actorId: "u1", content: "spam spam", at: T0 + 1_000 }), T0 + 1_000);
  const verdict = engine.observeAll(message({ actorId: "u1", content: "spam spam", at: T0 + 2_000 }), T0 + 2_000);

  assert.equal(verdict.triggered, true);
  assert.equal(verdict.coordinated, false);
  assert.deepEqual(verdict.actorIds, ["u1"], "un membru care doar vorbea in acelasi timp nu devine participant");
});

test("mai multe tipuri de spam simultan sunt raportate impreuna", () => {
  const engine = detector({ identicalMessages: 2, linkMessages: 2 });
  engine.observeAll(message({ content: "intra pe https://x.io" }), T0);
  const verdict = engine.observeAll(message({ content: "intra pe https://x.io", at: T0 + 1_000 }), T0 + 1_000);

  assert.equal(verdict.triggered, true);
  assert.deepEqual(verdict.kinds, ["identical", "link"]);
  assert.match(verdict.reason, /mesaje identice/);
  assert.match(verdict.reason, /linkuri/);
});

test("semnalele vechi sunt uitate, deci memoria nu creste la nesfarsit", () => {
  const engine = detector();
  for (let index = 0; index < 200; index += 1) {
    engine.observeAll(message({ content: `text ${index}`, at: T0 + index * 1_000 }), T0 + index * 1_000);
  }

  assert.ok(engine.size() < 200, "semnalele din afara celei mai lungi ferestre sunt curatate");
  assert.equal(engine.evaluate(T0 + 10_000_000).triggered, false, "dupa liniste, evaluarea nu mai declanseaza nimic");
});

test("pragurile stramte ale ownerului sunt respectate de motor", () => {
  const engine = detector({ identicalMessages: 2, identicalWindowMs: 60_000 });
  engine.observeAll(message({ content: "acelasi" }), T0);
  const verdict = engine.observeAll(message({ content: "acelasi", at: T0 + 30_000 }), T0 + 30_000);

  assert.equal(verdict.triggered, true, "cu prag de 2 in 60s, doua mesaje la 30s distanta declanseaza");
});

test("reset sterge starea, ca dupa rezolvarea unui incident sa nu se declanseze pe semnale vechi", () => {
  const engine = detector();
  engine.observeAll(message({ content: "spam" }), T0);
  engine.observeAll(message({ content: "spam", at: T0 + 1_000 }), T0 + 1_000);
  engine.reset();

  const verdict = engine.observeAll(message({ content: "spam", at: T0 + 2_000 }), T0 + 2_000);

  assert.equal(verdict.triggered, false);
  assert.equal(engine.size(), 1);
});
