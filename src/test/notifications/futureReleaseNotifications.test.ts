import test from "node:test";
import assert from "node:assert/strict";

import {
  computeFutureReleaseUpdate,
  initialFutureReleaseState,
  parseReleaseTimestamp,
  type FutureReleaseGameState
} from "../../features/notifications/futureReleaseNotifications.js";

const NOW = Date.parse("2026-07-17T00:00:00.000Z");
const DAY = 86_400_000;

function iso(days: number): string {
  return new Date(NOW + days * DAY).toISOString();
}

test("baseline: activarea NU trimite un val cu informatiile deja existente si marcheaza pragurile deja trecute (audit, #11)", () => {
  const { notifications, nextState } = computeFutureReleaseUpdate(
    { gameName: "Silksong", releaseDate: iso(20), preorderPrice: "40 EUR" },
    initialFutureReleaseState(),
    NOW
  );
  assert.deepEqual(notifications, [], "baseline nu emite notificari");
  assert.equal(nextState.baselineDone, true);
  assert.deepEqual(nextState.notifiedThresholdDays, [30], "pragul de 30 e deja trecut (20 zile) => marcat, nu se va re-emite");
  assert.equal(nextState.preorderSeen, true);
  assert.equal(nextState.observedPreorderPrice, "40 EUR");
});

test("fiecare prag calendaristic e notificat cel mult o data (30/7/1) (audit, #11)", () => {
  let state: FutureReleaseGameState = { baselineDone: true, notifiedThresholdDays: [], preorderSeen: false, observedPreorderPrice: null };

  const at8 = computeFutureReleaseUpdate({ gameName: "G", releaseDate: iso(8) }, state, NOW);
  assert.deepEqual(at8.notifications.map(n => n.kind === "threshold" ? n.days : n.kind), [30], "la 8 zile s-a trecut doar de pragul 30");
  state = at8.nextState;

  const at6 = computeFutureReleaseUpdate({ gameName: "G", releaseDate: iso(6) }, state, NOW);
  assert.deepEqual(at6.notifications.map(n => n.kind === "threshold" ? n.days : n.kind), [7], "la 6 zile se emite pragul 7 (30 deja notificat)");
  state = at6.nextState;

  const at0 = computeFutureReleaseUpdate({ gameName: "G", releaseDate: iso(0) }, state, NOW);
  assert.deepEqual(at0.notifications.map(n => n.kind === "threshold" ? n.days : n.kind), [1], "in ziua lansarii se emite pragul 1");
  state = at0.nextState;

  const again = computeFutureReleaseUpdate({ gameName: "G", releaseDate: iso(0) }, state, NOW);
  assert.deepEqual(again.notifications, [], "nicio re-emitere pentru praguri deja notificate");
});

test("preorder devine disponibil => eveniment; schimbarea 40 -> 35 afiseaza ambele valori (audit, #11)", () => {
  let state = { baselineDone: true, notifiedThresholdDays: [30, 7, 1], preorderSeen: false, observedPreorderPrice: null } as FutureReleaseGameState;

  const appeared = computeFutureReleaseUpdate({ gameName: "G", releaseDate: iso(100), preorderPrice: "40 EUR" }, state, NOW);
  assert.deepEqual(appeared.notifications, [{ kind: "preorder-available", gameName: "G", price: "40 EUR" }]);
  state = appeared.nextState;

  const changed = computeFutureReleaseUpdate({ gameName: "G", releaseDate: iso(100), preorderPrice: "35 EUR" }, state, NOW);
  assert.deepEqual(changed.notifications, [{ kind: "price-changed", gameName: "G", from: "40 EUR", to: "35 EUR" }]);
  state = changed.nextState;

  const same = computeFutureReleaseUpdate({ gameName: "G", releaseDate: iso(100), preorderPrice: "35 EUR" }, state, NOW);
  assert.deepEqual(same.notifications, [], "pretul neschimbat nu emite nimic");
});

test("disparitia preorder-ului produce eveniment separat (audit, #11)", () => {
  const state = { baselineDone: true, notifiedThresholdDays: [30, 7, 1], preorderSeen: true, observedPreorderPrice: "35 EUR" } as FutureReleaseGameState;
  const removed = computeFutureReleaseUpdate({ gameName: "G", releaseDate: iso(100), preorderPrice: null }, state, NOW);
  assert.deepEqual(removed.notifications, [{ kind: "preorder-removed", gameName: "G" }]);
  assert.equal(removed.nextState.preorderSeen, false);
  assert.equal(removed.nextState.observedPreorderPrice, null);
});

test("data doar-an sau invalida => fara praguri calendaristice, dar preorder-ul functioneaza (audit, #11)", () => {
  assert.equal(parseReleaseTimestamp("2026"), null, "an-only nu produce timestamp");
  assert.equal(parseReleaseTimestamp("indisponibil"), null);
  assert.ok(parseReleaseTimestamp(iso(5)) !== null);

  const state = { baselineDone: true, notifiedThresholdDays: [], preorderSeen: false, observedPreorderPrice: null } as FutureReleaseGameState;
  const result = computeFutureReleaseUpdate({ gameName: "G", releaseDate: "2026", preorderPrice: "50 EUR" }, state, NOW);
  assert.deepEqual(result.notifications, [{ kind: "preorder-available", gameName: "G", price: "50 EUR" }], "fara praguri, dar preorder detectat");
  assert.deepEqual(result.nextState.notifiedThresholdDays, [], "niciun prag calendaristic pentru data doar-an");
});

test("o data de lansare trecuta nu emite praguri retroactive (audit, #26)", () => {
  const state: FutureReleaseGameState = { baselineDone: true, notifiedThresholdDays: [], preorderSeen: false, observedPreorderPrice: null };
  const result = computeFutureReleaseUpdate({ gameName: "G", releaseDate: iso(-1) }, state, NOW);
  assert.deepEqual(result.notifications, []);
  assert.deepEqual(result.nextState.notifiedThresholdDays, []);
});

test("tick ratat 31 -> 6 zile: trimite DOAR pragul util (7), nu si 'in 30 de zile'; ambele marcate (audit, #8)", () => {
  const state = { baselineDone: true, notifiedThresholdDays: [], preorderSeen: false, observedPreorderPrice: null } as FutureReleaseGameState;
  const result = computeFutureReleaseUpdate({ gameName: "G", releaseDate: iso(6) }, state, NOW);
  assert.deepEqual(result.notifications.map(n => n.kind === "threshold" ? n.days : n.kind), [7], "un singur mesaj, pragul cel mai apropiat inca util");
  assert.deepEqual(result.nextState.notifiedThresholdDays, [30, 7], "pragul sarit (30) si cel trimis (7) sunt ambele marcate atomic");
});

test("tick ratat 8 -> ziua lansarii: trimite DOAR pragul 1, nu 7 si 1 contradictoriu (audit, #8)", () => {
  const state = { baselineDone: true, notifiedThresholdDays: [30], preorderSeen: false, observedPreorderPrice: null } as FutureReleaseGameState;
  const result = computeFutureReleaseUpdate({ gameName: "G", releaseDate: iso(0) }, state, NOW);
  assert.deepEqual(result.notifications.map(n => n.kind === "threshold" ? n.days : n.kind), [1]);
  assert.deepEqual(result.nextState.notifiedThresholdDays, [30, 7, 1], "pragul sarit (7) si cel trimis (1) sunt marcate, restartul nu le re-emite");
});

test("dupa lansare (remaining < 0) nu se trimite niciun prag calendaristic (audit, #8)", () => {
  const state = { baselineDone: true, notifiedThresholdDays: [30], preorderSeen: false, observedPreorderPrice: null } as FutureReleaseGameState;
  const result = computeFutureReleaseUpdate({ gameName: "G", releaseDate: iso(-2) }, state, NOW);
  assert.deepEqual(result.notifications.filter(n => n.kind === "threshold"), []);
});
