import test from "node:test";
import assert from "node:assert/strict";

import {
  batchStatusLine,
  deliverAuditBatches,
  type AuditBatchDeliveryDeps,
  type AuditBatchPage,
  type AuditBatchStop,
  type ScheduledAuditBatch
} from "../../features/admin-records/auditLogBatchDelivery.js";
import { parseAuditDateRange } from "../../features/admin-records/auditLogDateRange.js";

type Harness = {
  sent: string[];
  followUps: string[];
  stops: Array<{ reason: AuditBatchStop; batchNumber: number }>;
  runNext: () => Promise<void>;
  pendingCount: () => number;
};

function harness(pages: AuditBatchPage[], overrides: Partial<AuditBatchDeliveryDeps> = {}): { deps: AuditBatchDeliveryDeps; state: Harness } {
  const sent: string[] = [];
  const followUps: string[] = [];
  const stops: Array<{ reason: AuditBatchStop; batchNumber: number }> = [];
  let scheduled: (() => Promise<void>) | null = null;
  let index = 0;

  const deps: AuditBatchDeliveryDeps = {
    header: "Interval 2026-07-01",
    batchSize: 25,
    maxBatches: 7,
    intervalMs: 1000,
    fetchPage: async () => {
      const page = pages[Math.min(index, pages.length - 1)];
      index += 1;
      return page;
    },
    sendInitial: async content => { sent.push(content); },
    sendFollowUp: async content => { followUps.push(content); },
    schedule: (task): ScheduledAuditBatch => {
      scheduled = task;
      return { cancel: () => { scheduled = null; } };
    },
    onStopped: (reason, batchNumber) => { stops.push({ reason, batchNumber }); },
    ...overrides
  };

  return {
    deps,
    state: {
      sent,
      followUps,
      stops,
      runNext: async () => {
        const task = scheduled;
        scheduled = null;
        if (task) await task();
      },
      pendingCount: () => (scheduled ? 1 : 0)
    }
  };
}

const full: AuditBatchPage = { rendered: "randat", visibleCount: 25, hasMore: true };
const last: AuditBatchPage = { rendered: "randat", visibleCount: 4, hasMore: false };

test("primul lot pleaca pe raspunsul initial, restul pe follow-up", async () => {
  const { deps, state } = harness([full, last]);
  await deliverAuditBatches(deps, 0);
  assert.equal(state.sent.length, 1, "doar primul lot editeaza raspunsul initial");
  await state.runNext();
  assert.equal(state.followUps.length, 1);
  assert.equal(state.pendingCount(), 0, "ultimul lot nu mai programeaza nimic");
});

test("livrarea se opreste la bugetul de loturi si spune de ce", async () => {
  const { deps, state } = harness([full], { maxBatches: 3 });
  await deliverAuditBatches(deps, 0);
  await state.runNext();
  await state.runNext();
  assert.equal(state.pendingCount(), 0, "dupa al treilea lot nu se mai programeaza nimic, desi mai sunt date");
  const final = state.followUps[state.followUps.length - 1];
  assert.match(final, /Livrare oprita dupa 75 intrari/);
  assert.match(final, /Alege un interval mai mic/);
});

test("fara follow-up disponibil, livrarea se opreste raportat, nu tacut", async () => {
  const { deps, state } = harness([full, last], { sendFollowUp: null });
  await deliverAuditBatches(deps, 0);
  await state.runNext();
  assert.deepEqual(state.stops, [{ reason: "no-follow-up", batchNumber: 2 }]);
  assert.equal(state.pendingCount(), 0);
});

test("un token expirat opreste seria fara sa arunce catre apelant", async () => {
  const { deps, state } = harness([full, full], {
    sendFollowUp: async () => { throw new Error("Unknown Webhook"); }
  });
  await deliverAuditBatches(deps, 0);
  await state.runNext();
  assert.deepEqual(state.stops, [{ reason: "expired", batchNumber: 2 }]);
  assert.equal(state.pendingCount(), 0, "nu se mai incearca loturi pe un token mort");
});

test("o eroare de citire in lotul programat e raportata, nu ridicata intr-un timer", async () => {
  let calls = 0;
  const { deps, state } = harness([full], {
    fetchPage: async () => {
      calls += 1;
      if (calls > 1) throw new Error("Mongo picat");
      return full;
    }
  });
  await deliverAuditBatches(deps, 0);
  await state.runNext();
  assert.deepEqual(state.stops, [{ reason: "failed", batchNumber: 2 }]);
});

test("anularea inainte de urmatorul lot opreste seria", async () => {
  const { deps, state } = harness([full, last]);
  const delivery = await deliverAuditBatches(deps, 0);
  assert.equal(delivery.cancel(), true);
  await state.runNext();
  assert.equal(state.followUps.length, 0, "lotul programat nu mai pleaca dupa anulare");
  assert.equal(delivery.cancel(), false, "a doua anulare nu mai are ce opri");
});

test("offset-ul initial se pastreaza si avanseaza cu marimea lotului", async () => {
  const offsets: number[] = [];
  const { deps, state } = harness([full, last], {
    fetchPage: async offset => {
      offsets.push(offset);
      return offsets.length === 1 ? full : last;
    }
  });
  await deliverAuditBatches(deps, 50);
  await state.runNext();
  assert.deepEqual(offsets, [50, 75]);
});

test("linia de stare distinge lotul intermediar de cel final si de bugetul atins", () => {
  assert.match(batchStatusLine(2, 25, true, false, 25), /Lot 2: 25 intrari/);
  assert.match(batchStatusLine(2, 4, false, false, 25), /Livrare finalizata: lot 2, 4 intrari/);
  assert.match(batchStatusLine(7, 25, true, true, 25), /oprita dupa 175 intrari/);
});

test("intervalele acceptate sunt exact zi, saptamana si luna, validate ca date reale", () => {
  assert.deepEqual(parseAuditDateRange("zi", "2026-07-15")?.label, "2026-07-15");
  assert.deepEqual(parseAuditDateRange("saptamana", "2026-07-15")?.label, "2026-07-15 + 7 zile");
  assert.deepEqual(parseAuditDateRange("luna", "2026-07")?.label, "2026-07");

  assert.equal(parseAuditDateRange("zi", "2026-02-30"), null, "o zi inexistenta nu devine 2 martie");
  assert.equal(parseAuditDateRange("luna", "2026-13"), null);
  assert.equal(parseAuditDateRange("an", "2026-07-15"), null, "perioadele nesuportate nu cad pe un interval implicit");
  assert.equal(parseAuditDateRange("zi", "15-07-2026"), null);
  assert.equal(parseAuditDateRange(null, null), null);
});

test("intervalul de o zi acopera exact 24 de ore, iar cel de luna trece la luna urmatoare", () => {
  const day = parseAuditDateRange("zi", "2026-07-15");
  assert.ok(day, "intervalul de o zi se parseaza");
  assert.equal(day.end.getTime() - day.start.getTime(), 86_400_000);

  const month = parseAuditDateRange("luna", "2026-12");
  assert.equal(month?.start.toISOString(), "2026-12-01T00:00:00.000Z");
  assert.equal(month?.end.toISOString(), "2027-01-01T00:00:00.000Z", "decembrie se inchide in ianuarie anul urmator");
});
