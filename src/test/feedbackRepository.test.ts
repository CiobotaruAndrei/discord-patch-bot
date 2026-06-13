import test from "node:test";
import assert from "node:assert/strict";

const mod = require("../features/feedback/feedbackRepository") as typeof import("../features/feedback/feedbackRepository");
const { sanitizeReport, normalizeReportType, reportTypeLabel, REPORT_TYPES, createFeedbackRepository } = mod;

const passThroughRetry = <T>(fn: () => Promise<T>): Promise<T> => fn();
const noopLogger = () => undefined;

interface FakeModelOpts {
  onCreate?: (doc: unknown) => void;
  onFind?: (filter: unknown) => void;
  docs?: Array<Record<string, unknown>>;
}

function makeModel(opts: FakeModelOpts) {
  return {
    create: async (doc: unknown) => { if (opts.onCreate) opts.onCreate(doc); return doc; },
    find: (filter: unknown) => {
      if (opts.onFind) opts.onFind(filter);
      return { sort: () => ({ limit: () => ({ lean: async () => opts.docs || [] }) }) };
    }
  };
}

test("REPORT_TYPES contine cele 5 tipuri cu value + label", () => {
  assert.equal(REPORT_TYPES.length, 5);
  for (const type of REPORT_TYPES) {
    assert.equal(typeof type.value, "string");
    assert.equal(typeof type.label, "string");
  }
});

test("normalizeReportType: valoare cunoscuta ramane, necunoscuta/null devine 'altceva'", () => {
  assert.equal(normalizeReportType("sursa-stricata"), "sursa-stricata");
  assert.equal(normalizeReportType("inexistent"), "altceva");
  assert.equal(normalizeReportType(null), "altceva");
  assert.equal(normalizeReportType(undefined), "altceva");
});

test("reportTypeLabel intoarce eticheta pentru un tip cunoscut", () => {
  assert.equal(reportTypeLabel("duplicat"), "Notificare duplicata");
  assert.equal(reportTypeLabel("necunoscut"), "necunoscut");
});

test("sanitizeReport normalizeaza tipul, trunchiaza si seteaza implicit", () => {
  const now = new Date("2026-06-06T10:00:00.000Z");
  const doc = sanitizeReport({ guildId: "g1", userId: "u1", type: "xxx", gameKey: "k".repeat(200), detail: "d".repeat(2000) }, now);
  assert.equal(doc.guildId, "g1");
  assert.equal(doc.type, "altceva");
  assert.ok(doc.gameKey.length <= 100);
  assert.ok(doc.detail.length <= 1000);
  assert.equal(doc.createdAt, now);
});

test("recordReport salveaza documentul sanitizat si il intoarce", async () => {
  let created: unknown = null;
  const repo = createFeedbackRepository({
    FeedbackReportModel: makeModel({ onCreate: doc => { created = doc; } }),
    withMongoRetry: passThroughRetry,
    logger: noopLogger
  });
  const doc = await repo.recordReport({ guildId: "g1", userId: "u1", type: "joc-lipsa", detail: "Adaugati Hades 2" });
  assert.equal(doc.type, "joc-lipsa");
  assert.ok(created);
  assert.equal((created as { type: string }).type, "joc-lipsa");
});

test("getRecent filtreaza dupa guildId, clamp pe limita si mapeaza", async () => {
  let capturedFilter: Record<string, unknown> | null = null;
  const repo = createFeedbackRepository({
    FeedbackReportModel: makeModel({
      onFind: filter => { capturedFilter = filter as Record<string, unknown>; },
      docs: [{ userId: "u1", type: "duplicat", gameKey: "", detail: "x", createdAt: new Date("2026-06-01T00:00:00Z") }]
    }),
    withMongoRetry: passThroughRetry,
    logger: noopLogger
  });
  const records = await repo.getRecent("g1", 100);
  assert.deepEqual(capturedFilter, { guildId: "g1" });
  assert.equal(records.length, 1);
  assert.equal(records[0].type, "duplicat");
  assert.ok(records[0].createdAt instanceof Date);
});
