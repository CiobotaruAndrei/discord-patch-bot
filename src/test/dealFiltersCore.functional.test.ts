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

test("deal filter rejects deals with non-finite savings (V11 NaN guard)", () => {
  // V11 regression guard: `Number(undefined) === NaN`, and `NaN < minDisc`
  // evaluates to false — so the old comparator LET deals through whose
  // upstream source forgot the `savings` field. Then buildDealEmbed
  // surfaced "Reducere: NaN%" or "undefined%" to the user. Now we
  // explicitly reject any non-finite savings number when checking the
  // minimum discount threshold.
  const guild: GuildSettings = {
    _id: "guild-1",
    minDiscountPercent: 30,
    includeFreeGames: true,
    includePaidDiscounts: true
  };

  assert.equal(
    dealPassesFilters({ ...baseDeal, savings: undefined as unknown as number }, guild),
    false,
    "deal with undefined savings must fail the min-discount gate"
  );
  assert.equal(
    dealPassesFilters({ ...baseDeal, savings: NaN }, guild),
    false,
    "deal with NaN savings must fail the min-discount gate"
  );
  // Free deals don't go through the savings gate, so they still pass.
  assert.equal(
    dealPassesFilters({ ...baseDeal, salePrice: "0", savings: undefined as unknown as number }, guild),
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

  const guild = { seen: new Map([["cs2", ["u1", "u2"]]]) } as Pick<GuildSettings, "seen">;
  assert.deepEqual(Array.from(getSeenSet(guild, "cs2")), ["u1", "u2"]);
});

test("normalizePendingUpdateArray coerces invalid createdAt to a fresh Date", () => {
  // V12 regression guard: `new Date(item.createdAt).getTime()` in
  // processGuildUpdates returna NaN pentru intrari cu createdAt malformat
  // (string "abc", `"Invalid Date"`, sau docs pre-V11). NaN <=
  // PENDING_UPDATE_MAX_AGE_MS este false, deci item-ul era filtrat din
  // pendingUpdates si re-scris in DB FARA el — notificarea era pierduta
  // definitiv. Acum normalizatorul stampleaza `new Date()` pe orice valoare
  // care nu produce un Date valid.
  const before = Date.now();
  const items = normalizePendingUpdateArray([
    { id: "u1", createdAt: "abc" },            // string nevalid
    { id: "u2", createdAt: null },             // null
    { id: "u3", createdAt: "Invalid Date" },   // sirul literal
    { id: "u4" },                              // lipseste cu totul
    { id: "u5", createdAt: NaN },              // NaN explicit
    { id: "u6", createdAt: new Date(0) },      // 1970 valid → pastreaza
    { id: "u7", createdAt: "2024-01-01T00:00:00Z" } // ISO valid → pastreaza
  ]);
  const after = Date.now();

  assert.equal(items.length, 7);
  for (const item of items.slice(0, 5)) {
    const ts = (item.createdAt as Date).getTime();
    assert.ok(!Number.isNaN(ts), `${item.id}: createdAt trebuie sa fie un Date valid`);
    assert.ok(ts >= before && ts <= after, `${item.id}: createdAt invalid trebuie inlocuit cu now`);
  }
  // Date-le valide raman neschimbate.
  assert.equal((items[5].createdAt as Date).getTime(), 0, "1970-01-01 trebuie pastrat");
  assert.equal((items[6].createdAt as Date).toISOString(), "2024-01-01T00:00:00.000Z");
});

test("normalizePendingDiscountArray coerces invalid lastSeenAt to a fresh Date", () => {
  // Simetric cu pendingUpdates — lastSeenAt este folosit pentru bookkeeping
  // si pentru grace-period (`PENDING_DISCOUNT_GRACE_CYCLES`). Un format
  // nevalid blocheaza prelungirea grace-ului in mod silent.
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
