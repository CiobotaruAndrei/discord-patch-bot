import test from "node:test";
import assert from "node:assert/strict";

import { buildSetUpdatePlan, type SetPlanInteraction } from "../features/command-handlers/setUpdatePlan";

const CURRENCIES = { EUR: {}, USD: {}, RON: {} };

function makeInteraction(opts: {
  string?: Record<string, string | null>;
  integer?: Record<string, number | null>;
}): SetPlanInteraction {
  return {
    options: {
      getString: (name: string) => opts.string?.[name] ?? null,
      getInteger: (name: string) => opts.integer?.[name] ?? null
    }
  };
}

test("mode: valid seteaza notificationMode; invalid -> earlyReply", () => {
  const ok = buildSetUpdatePlan("mode", makeInteraction({ string: { value: "compact" } }), CURRENCIES);
  assert.equal(ok.earlyReply, undefined);
  assert.equal(ok.updateDoc.notificationMode, "compact");
  assert.equal(ok.isFilterChange, false);

  const bad = buildSetUpdatePlan("mode", makeInteraction({ string: { value: "weird" } }), CURRENCIES);
  assert.match(String(bad.earlyReply), /mode/);
  assert.deepEqual(bad.updateDoc, {});
});

test("mindiscount: interval 0-100, marcat ca filter change", () => {
  const ok = buildSetUpdatePlan("mindiscount", makeInteraction({ integer: { value: 30 } }), CURRENCIES);
  assert.equal(ok.updateDoc.minDiscountPercent, 30);
  assert.equal(ok.isFilterChange, true);

  for (const bad of [-1, 101, Number.NaN]) {
    const plan = buildSetUpdatePlan("mindiscount", makeInteraction({ integer: { value: bad } }), CURRENCIES);
    assert.match(String(plan.earlyReply), /mindiscount/);
  }
  const missing = buildSetUpdatePlan("mindiscount", makeInteraction({}), CURRENCIES);
  assert.match(String(missing.earlyReply), /mindiscount/);
});

test("maxprice: 0 dezactiveaza, valoare seteaza, out-of-range respins", () => {
  const zero = buildSetUpdatePlan("maxprice", makeInteraction({ integer: { value: 0 } }), CURRENCIES);
  assert.equal(zero.updateDoc.maxAbsolutePrice, 0);
  assert.match(zero.confirmMsg, /dezactivat/);
  assert.equal(zero.isFilterChange, true);

  const set = buildSetUpdatePlan("maxprice", makeInteraction({ integer: { value: 50 } }), CURRENCIES);
  assert.equal(set.updateDoc.maxAbsolutePrice, 50);

  const bad = buildSetUpdatePlan("maxprice", makeInteraction({ integer: { value: 10001 } }), CURRENCIES);
  assert.match(String(bad.earlyReply), /maxprice/);
});

test("free / paid: on/off -> boolean, filter change; alt input respins", () => {
  const freeOn = buildSetUpdatePlan("free", makeInteraction({ string: { value: "on" } }), CURRENCIES);
  assert.equal(freeOn.updateDoc.includeFreeGames, true);
  assert.equal(freeOn.isFilterChange, true);

  const paidOff = buildSetUpdatePlan("paid", makeInteraction({ string: { value: "off" } }), CURRENCIES);
  assert.equal(paidOff.updateDoc.includePaidDiscounts, false);
  assert.equal(paidOff.isFilterChange, true);

  const bad = buildSetUpdatePlan("free", makeInteraction({ string: { value: "maybe" } }), CURRENCIES);
  assert.match(String(bad.earlyReply), /free/);
});

test("outbox-recovery-verify: on/off nu este filter change", () => {
  const on = buildSetUpdatePlan("outbox-recovery-verify", makeInteraction({ string: { value: "on" } }), CURRENCIES);
  assert.equal(on.updateDoc.outboxRecoveryVerify, true);
  assert.equal(on.isFilterChange, false);

  const off = buildSetUpdatePlan("outbox-recovery-verify", makeInteraction({ string: { value: "off" } }), CURRENCIES);
  assert.equal(off.updateDoc.outboxRecoveryVerify, false);

  const bad = buildSetUpdatePlan("outbox-recovery-verify", makeInteraction({ string: { value: "x" } }), CURRENCIES);
  assert.match(String(bad.earlyReply), /outbox-recovery-verify/);
});

test("currency: doar valute suportate, marcat ca filter change", () => {
  const ok = buildSetUpdatePlan("currency", makeInteraction({ string: { value: "USD" } }), CURRENCIES);
  assert.equal(ok.updateDoc.currency, "USD");
  assert.equal(ok.isFilterChange, true);

  const bad = buildSetUpdatePlan("currency", makeInteraction({ string: { value: "JPY" } }), CURRENCIES);
  assert.match(String(bad.earlyReply), /EUR/);
});

test("stores: reset/gol -> lista goala; tokens mapati; token necunoscut respins", () => {
  const reset = buildSetUpdatePlan("stores", makeInteraction({ string: { value: "reset" } }), CURRENCIES);
  assert.deepEqual(reset.updateDoc.enabledStores, []);
  assert.equal(reset.isFilterChange, true);

  const empty = buildSetUpdatePlan("stores", makeInteraction({ string: { value: "" } }), CURRENCIES);
  assert.deepEqual(empty.updateDoc.enabledStores, []);

  const mapped = buildSetUpdatePlan("stores", makeInteraction({ string: { value: "steam, epic games" } }), CURRENCIES);
  assert.deepEqual(mapped.updateDoc.enabledStores, ["Steam", "Epic Games"]);

  const dedup = buildSetUpdatePlan("stores", makeInteraction({ string: { value: "epic,epicgames" } }), CURRENCIES);
  assert.deepEqual(dedup.updateDoc.enabledStores, ["Epic Games"]);

  const bad = buildSetUpdatePlan("stores", makeInteraction({ string: { value: "gog" } }), CURRENCIES);
  assert.match(String(bad.earlyReply), /gog/);
});

test("update-template / discount-template: seteaza campul corect si mesaj de reset la gol", () => {
  const upd = buildSetUpdatePlan("update-template", makeInteraction({ string: { value: "Salut {game}" } }), CURRENCIES);
  assert.equal(upd.updateDoc.updateMessageTemplate, "Salut {game}");
  assert.match(upd.confirmMsg, /update-uri/);

  const disc = buildSetUpdatePlan("discount-template", makeInteraction({ string: { value: null } }), CURRENCIES);
  assert.equal(disc.updateDoc.discountMessageTemplate, null);
  assert.match(disc.confirmMsg, /resetat la implicit/);
});

test("subcomanda necunoscuta -> plan gol, fara confirmMsg", () => {
  const plan = buildSetUpdatePlan("does-not-exist", makeInteraction({}), CURRENCIES);
  assert.deepEqual(plan.updateDoc, {});
  assert.equal(plan.confirmMsg, "");
  assert.equal(plan.earlyReply, undefined);
});
