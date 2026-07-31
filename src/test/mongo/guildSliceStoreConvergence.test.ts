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

test("sursa canonica se scrie prima, copia dupa", async () => {
  const { store, state } = harness();
  await store.updateOne({ _id: "g1" }, { $set: { warnBanLimit: 3 } });
  assert.deepEqual(
    state.order,
    ["legacy.updateOne", "dedicated.updateOne"],
    "ordinea conteaza: daca prima scriere e cea in copie si a doua pica, sursa citita ramane veche iar copia are " +
      "deja valoarea noua - exact divergenta pe care migrarea nu si-o permite"
  );
});

test("daca sursa canonica pica, copia nu se atinge deloc", async () => {
  const { store, state, copyFailures } = harness({ legacyFails: true });
  await assert.rejects(() => store.updateOne({ _id: "g1" }, { $set: { warnBanLimit: 3 } }), /legacy a picat/);
  assert.deepEqual(state.order, ["legacy.updateOne"], "nu se scrie in copie o valoare pe care sursa nu a acceptat-o");
  assert.deepEqual(state.dedicated, {});
  assert.deepEqual(copyFailures, []);
});

test("daca doar copia pica, scrierea canonica ramane valida si esecul e raportat, nu inghitit", async () => {
  const { store, state, copyFailures } = harness({ dedicatedFails: true });
  const result = await store.updateOne({ _id: "g1" }, { $set: { warnBanLimit: 5 } });

  assert.deepEqual(result, { matchedCount: 1, modifiedCount: 1 }, "operatia a avut efect: sursa canonica a acceptat-o");
  assert.equal(state.legacy.warnBanLimit, 5);
  assert.deepEqual(state.dedicated, {}, "copia a ramas in urma");
  assert.deepEqual(copyFailures, [{ guildId: "g1", message: "dedicated a picat" }]);
});

test("copia ramasa in urma se repara singura la urmatoarea citire", async () => {
  const { store, state, backfills } = harness({ dedicatedFails: true });
  await store.updateOne({ _id: "g1" }, { $set: { warnBanLimit: 5 } });
  assert.deepEqual(state.dedicated, {});

  const repaired = harness();
  Object.assign(repaired.state.legacy, state.legacy);
  await repaired.store.findOne({ _id: "g1" });

  assert.equal(repaired.state.dedicated.warnBanLimit, 5, "citirea completeaza felia lipsa din sursa canonica");
  assert.deepEqual(repaired.backfills, ["g1"]);
  assert.deepEqual(backfills, [], "backfill-ul se raporteaza doar cand chiar se intampla");
});

test("findOneAndUpdate pastreaza aceeasi ordine si acelasi rezultat ca sursa canonica", async () => {
  const { store, state } = harness();
  const result = await store.findOneAndUpdate({ _id: "g1" }, { $set: { warnBanLimit: 7 } });
  assert.deepEqual(state.order, ["legacy.findOneAndUpdate", "dedicated.findOneAndUpdate"]);
  assert.equal((result as Record<string, unknown>).warnBanLimit, 7, "apelantul primeste documentul sursei canonice");
});

test("updateMany respecta aceeasi ordine", async () => {
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
