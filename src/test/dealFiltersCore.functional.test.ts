import test from "node:test";
import assert from "node:assert/strict";
import {
  dealPassesFilters,
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

test("deal filter rejects deals with non-finite savings", () => {
  const guild: GuildSettings = {
    _id: "guild-1",
    minDiscountPercent: 30,
    includeFreeGames: true,
    includePaidDiscounts: true
  };

  assert.equal(
    dealPassesFilters({ ...baseDeal, savings: undefined }, guild),
    false,
    "deal with undefined savings must fail the min-discount gate"
  );
  assert.equal(
    dealPassesFilters({ ...baseDeal, savings: NaN }, guild),
    false,
    "deal with NaN savings must fail the min-discount gate"
  );

  assert.equal(
    dealPassesFilters({ ...baseDeal, salePrice: "0", savings: undefined }, guild),
    true,
    "free deals skip the savings gate even when savings is invalid"
  );
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
});

test("normalizePendingUpdateArray coerces invalid createdAt to a fresh Date", () => {
  const before = Date.now();
  const items = normalizePendingUpdateArray([
    { id: "u1", createdAt: "abc" },
    { id: "u2", createdAt: null },
    { id: "u3", createdAt: "Invalid Date" },
    { id: "u4" },
    { id: "u5", createdAt: NaN },
    { id: "u6", createdAt: new Date(0) },
    { id: "u7", createdAt: "2024-01-01T00:00:00Z" }
  ]);
  const after = Date.now();

  assert.equal(items.length, 7);
  for (const item of items.slice(0, 5)) {
    const ts = (item.createdAt as Date).getTime();
    assert.ok(!Number.isNaN(ts), `${item.id}: createdAt trebuie sa fie un Date valid`);
    assert.ok(ts >= before && ts <= after, `${item.id}: createdAt invalid trebuie inlocuit cu now`);
  }

  assert.equal((items[5].createdAt as Date).getTime(), 0, "1970-01-01 trebuie pastrat");
  assert.equal((items[6].createdAt as Date).toISOString(), "2024-01-01T00:00:00.000Z");
});

test("normalizePendingDiscountArray coerces invalid lastSeenAt to a fresh Date", () => {

  const before = Date.now();
  const items = normalizePendingDiscountArray([
    { hash: "h1", lastSeenAt: "abc" },
    { hash: "h2", lastSeenAt: null },
    { hash: "h3" }
  ]);
  const after = Date.now();

  assert.equal(items.length, 3);
  for (const item of items) {
    const ts = (item.lastSeenAt as Date).getTime();
    assert.ok(!Number.isNaN(ts), `${item.hash}: lastSeenAt trebuie sa fie Date valid`);
    assert.ok(ts >= before && ts <= after);
  }
});
