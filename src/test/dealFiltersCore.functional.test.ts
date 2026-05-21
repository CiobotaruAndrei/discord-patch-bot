import test from "node:test";
import assert from "node:assert/strict";
import {
  dealPassesFilters,
  getSeenSet,
  mapToObject,
  normalizePendingDiscountArray,
  normalizePendingUpdateArray,
  rotateAfter,
  toEntries
} from "../domain/deals/filtersCore";
import type { DealInfo, GuildSettings } from "../types";

const baseDeal: DealInfo = {
  id: "deal-1",
  title: "Example Game",
  store: "Steam",
  salePrice: "9.99",
  normalPrice: "19.99",
  savings: 50
};

test("deal filter core applies store, price, discount and free/paid rules directly", () => {
  const guild: GuildSettings = {
    _id: "guild-1",
    minDiscountPercent: 30,
    includeFreeGames: true,
    includePaidDiscounts: true,
    maxAbsolutePrice: 15,
    enabledStores: ["Steam"]
  };

  assert.equal(dealPassesFilters(baseDeal, guild), true);
  assert.equal(dealPassesFilters({ ...baseDeal, savings: 10 }, guild), false);
  assert.equal(dealPassesFilters({ ...baseDeal, salePrice: "20" }, guild), false);
  assert.equal(dealPassesFilters({ ...baseDeal, store: "Epic Games" }, guild), false);
  assert.equal(dealPassesFilters({ ...baseDeal, salePrice: "0", savings: 0 }, { ...guild, includeFreeGames: false }), false);
});

test("pending normalizers drop invalid entries and keep stable fields", () => {
  const updates = normalizePendingUpdateArray([
    { id: "u1", title: "Patch", attempts: 2 },
    { title: "missing id" }
  ]);

  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, "u1");
  assert.equal(updates[0].attempts, 2);

  const discounts = normalizePendingDiscountArray([
    { hash: "h1", attempts: 3 },
    { snapshot: {} }
  ]);

  assert.equal(discounts.length, 1);
  assert.equal(discounts[0].hash, "h1");
  assert.equal(discounts[0].attempts, 3);
});

test("entry helpers support Map, plain objects and rotation", () => {
  assert.deepEqual(toEntries(new Map([["a", 1]])), [["a", 1]]);
  assert.deepEqual(mapToObject(new Map([["x", 7]])), { x: 7 });
  assert.deepEqual(rotateAfter(["a", "b", "c"], "b"), ["c", "a", "b"]);

  const guild = { seen: new Map([["cs2", ["u1", "u2"]]]) } as Pick<GuildSettings, "seen">;
  assert.deepEqual(Array.from(getSeenSet(guild, "cs2")), ["u1", "u2"]);
});
