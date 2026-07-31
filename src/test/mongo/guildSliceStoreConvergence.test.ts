import test from "node:test";
import assert from "node:assert/strict";

import { createGuildDomainSliceStore, sliceOf } from "../../shared/guildDomainSliceStore.js";
import type { GuildSliceModel, SliceDoc } from "../../shared/guildDomainSliceStore.js";

const FIELDS = ["moderationTimeouts", "warnBanLimit"] as const;

type Recorded = { order: string[]; legacy: Record<string, unknown>; dedicated: Record<string, unknown> };

function model(name: string, state: Recorded, store: Record<string, unknown>, failing = false): GuildSliceModel {
  return {
    findOne: () => ({ lean: async () => (Object.keys(store).length > 0 ? store : null) as SliceDoc }),
    findOneAndUpdate: async (_filter, update) => {
      state.order.push(`${name}.findOneAndUpdate`);
      if (failing) throw new Error(`${name} a picat`);
      Object.assign(store, (update as { $set?: Record<string, unknown> }).$set ?? {});
      return store;
    },
    updateOne: async (_filter, update) => {
      state.order.push(`${name}.updateOne`);
      if (failing) throw new Error(`${name} a picat`);
      Object.assign(store, (update as { $set?: Record<string, unknown> }).$set ?? {});
      return { matchedCount: 1, modifiedCount: 1 };
    },
    updateMany: async () => {
      state.order.push(`${name}.updateMany`);
      if (failing) throw new Error(`${name} a picat`);
      return { matchedCount: 1, modifiedCount: 1 };
    }
  };
}

function harness(options: { legacyFails?: boolean; dedicatedFails?: boolean } = {}) {
  const state: Recorded = { order: [], legacy: {}, dedicated: {} };
  const copyFailures: Array<{ guildId: string; message: string }> = [];
  const backfills: string[] = [];
  const store = createGuildDomainSliceStore(
    FIELDS,
    model("legacy", state, state.legacy, options.legacyFails),
    model("dedicated", state, state.dedicated, options.dedicatedFails),
    {
      onBackfill: guildId => { backfills.push(guildId); },
      onCopyFailed: (guildId, error) => { copyFailures.push({ guildId, message: error instanceof Error ? error.message : String(error) }); }
    }
  );
  return { store, state, copyFailures, backfills };
}

test("un camp de felie ajunge doar in colectia dedicata", async () => {
  const { store, state } = harness();
  await store.updateOne({ _id: "g1" }, { $set: { warnBanLimit: 3 } });
  assert.deepEqual(
    state.order,
    ["dedicated.updateOne"],
    "colectia dedicata detine campul; o scriere in documentul vechi ar reinvia exact campurile pe care migrarea le scoate"
  );
  assert.equal(state.dedicated.warnBanLimit, 3);
  assert.equal(state.legacy.warnBanLimit, undefined);
});

test("o scriere mixta se imparte: felia in colectia dedicata, restul in documentul vechi", async () => {
  const { store, state } = harness();
  await store.updateOne({ _id: "g1" }, { $set: { warnBanLimit: 3, timezone: "Europe/Bucharest" } });
  assert.deepEqual(state.order, ["dedicated.updateOne", "legacy.updateOne"]);
  assert.equal(state.dedicated.warnBanLimit, 3);
  assert.equal(state.dedicated.timezone, undefined, "documentul dedicat primeste doar campurile domeniului lui");
  assert.equal(state.legacy.timezone, "Europe/Bucharest");
  assert.equal(state.legacy.warnBanLimit, undefined);
});

test("stergerea unui camp de felie ajunge in ambele colectii", async () => {
  const { store, state } = harness();
  state.legacy.warnBanLimit = 9;
  await store.updateOne({ _id: "g1" }, { $unset: { warnBanLimit: "" } });
  assert.deepEqual(
    state.order,
    ["dedicated.updateOne", "legacy.updateOne"],
    "citirea completeaza golurile din documentul vechi, deci o stergere doar in copie ar fi anulata la prima citire"
  );
});

test("daca scrierea in colectia dedicata pica, documentul vechi nu se atinge", async () => {
  const { store, state, copyFailures } = harness({ dedicatedFails: true });
  await assert.rejects(() => store.updateOne({ _id: "g1" }, { $set: { warnBanLimit: 3 } }), /dedicated a picat/);
  assert.deepEqual(state.order, ["dedicated.updateOne"]);
  assert.deepEqual(state.legacy, {}, "campul e detinut de colectia dedicata, deci un esec acolo opreste operatia");
  assert.deepEqual(copyFailures, [], "nu mai e o copie de raportat, ci scrierea principala, care se propaga");
});

test("un camp ramas doar in documentul vechi se completeaza la prima citire", async () => {
  const repaired = harness();
  repaired.state.legacy.warnBanLimit = 5;
  await repaired.store.findOne({ _id: "g1" });

  assert.equal(repaired.state.dedicated.warnBanLimit, 5, "citirea completeaza felia lipsa din documentul vechi");
  assert.deepEqual(repaired.backfills, ["g1"]);
});

test("findOneAndUpdate scrie felia in colectia dedicata si intoarce documentul ei", async () => {
  const { store, state } = harness();
  const result = await store.findOneAndUpdate({ _id: "g1" }, { $set: { warnBanLimit: 7 } });
  assert.deepEqual(state.order, ["dedicated.findOneAndUpdate"]);
  assert.equal((result as Record<string, unknown>).warnBanLimit, 7);
});

test("updateMany ramane scriere dubla: cheia lui nu e un singur guild", async () => {
  const { store, state } = harness();
  await store.updateMany({}, { $set: { warnBanLimit: 1 } });
  assert.deepEqual(state.order, ["legacy.updateMany", "dedicated.updateMany"]);
});

test("copierea in bloc se face pe model, nu pe o metoda detasata", async () => {
  const state: Recorded = { order: [], legacy: {}, dedicated: {} };
  const seenThis: boolean[] = [];
  const dedicated = {
    ...model("dedicated", state, state.dedicated),
    updateMany(this: unknown) {
      seenThis.push(this !== undefined);
      state.order.push("dedicated.updateMany");
      return Promise.resolve({ matchedCount: 1, modifiedCount: 1 });
    }
  };
  const failures: string[] = [];
  const store = createGuildDomainSliceStore(FIELDS, model("legacy", state, state.legacy), dedicated, {
    onCopyFailed: (_guildId, error) => { failures.push(error instanceof Error ? error.message : String(error)); }
  });
  await store.updateMany({}, { $set: { warnBanLimit: 1 } });
  assert.deepEqual(failures, [], "o metoda apelata detasat pierde `this` si arunca, iar esecul ar fi doar raportat, nu vizibil");
  assert.deepEqual(seenThis, [true], "copia se apeleaza ca metoda pe model");
});

test("o scriere care nu atinge felia nu produce nicio scriere in copie", async () => {
  const { store, state, copyFailures } = harness({ dedicatedFails: true });
  await store.updateOne({ _id: "g1" }, { $set: { timezone: "Europe/Bucharest" } });
  assert.deepEqual(state.order, ["legacy.updateOne"]);
  assert.deepEqual(copyFailures, [], "copia nici nu e atinsa, deci nu are cum sa raporteze un esec");
});

test("reporterul vechi, dat ca functie, ramane acceptat", async () => {
  const seen: string[] = [];
  const state: Recorded = { order: [], legacy: {}, dedicated: {} };
  const store = createGuildDomainSliceStore(
    FIELDS,
    model("legacy", state, state.legacy),
    model("dedicated", state, state.dedicated),
    guildId => { seen.push(guildId); }
  );
  state.legacy.warnBanLimit = 2;
  await store.findOne({ _id: "g1" });
  assert.deepEqual(seen, ["g1"], "apelantii care pasau doar onBackfill continua sa functioneze");
  assert.deepEqual(sliceOf(FIELDS, state.dedicated), { warnBanLimit: 2 });
});
