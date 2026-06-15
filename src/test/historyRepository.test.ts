import test from "node:test";
import assert from "node:assert/strict";

const mod = require("../features/notifications/historyRepository") as typeof import("../features/notifications/historyRepository");
const { sanitizeHistoryDocs, clampHistoryLimit, createHistoryRepository } = mod;

const passThroughRetry = <T>(fn: () => Promise<T>): Promise<T> => fn();
const noopLogger = () => undefined;

interface FakeModelOpts {
  onInsert?: () => void;
  insertThrows?: boolean;
  onFind?: (filter: unknown) => void;
  onLimit?: (count: number) => void;
  docs?: Array<Record<string, unknown>>;
}

function makeModel(opts: FakeModelOpts) {
  return {
    insertMany: async () => {
      if (opts.insertThrows) throw new Error("mongo down");
      if (opts.onInsert) opts.onInsert();
    },
    find: (filter: unknown) => {
      if (opts.onFind) opts.onFind(filter);
      const lean = async () => opts.docs || [];
      const limit = (count: number) => {
        if (opts.onLimit) opts.onLimit(count);
        return { lean };
      };
      return { sort: () => ({ limit }) };
    }
  };
}

test("sanitizeHistoryDocs filtreaza intrarile invalide si seteaza valori implicite", () => {
  const now = new Date("2026-06-06T10:00:00.000Z");
  const docs = sanitizeHistoryDocs("g1", [
    { kind: "update", gameKey: "minecraft", title: "1.21", link: "https://x/y" },
    { kind: "discount", title: "Deal" },
    { kind: "bogus", title: "x" },
    null
  ], now);
  assert.equal(docs.length, 2);
  assert.equal(docs[0].guildId, "g1");
  assert.equal(docs[0].kind, "update");
  assert.equal(docs[0].gameKey, "minecraft");
  assert.equal(docs[0].sentAt, now);
  assert.equal(docs[1].kind, "discount");
  assert.equal(docs[1].gameKey, "");
  assert.equal(docs[1].link, "");
});

test("sanitizeHistoryDocs trunchiaza campurile lungi", () => {
  const docs = sanitizeHistoryDocs("g", [{ kind: "update", title: "t".repeat(1000), link: "l".repeat(1000), gameKey: "k".repeat(1000) }], new Date());
  assert.ok(docs[0].title.length <= 300);
  assert.ok(docs[0].link.length <= 500);
  assert.ok(docs[0].gameKey.length <= 100);
});

test("clampHistoryLimit: implicit 10, minim 1, maxim 25", () => {
  assert.equal(clampHistoryLimit(0), 10);
  assert.equal(clampHistoryLimit(-5), 1);
  assert.equal(clampHistoryLimit(5), 5);
  assert.equal(clampHistoryLimit(100), 25);
});

test("recordSent e best-effort: nu arunca daca insertMany esueaza", async () => {
  let logged = false;
  const repo = createHistoryRepository({
    NotificationHistoryModel: makeModel({ insertThrows: true }),
    withMongoRetry: passThroughRetry,
    logger: () => { logged = true; }
  });
  await repo.recordSent("g1", [{ kind: "update", title: "x" }]);
  assert.equal(logged, true, "esecul trebuie logat, nu aruncat");
});

test("recordSent nu apeleaza insertMany cand nu sunt intrari valide", async () => {
  let called = false;
  const repo = createHistoryRepository({
    NotificationHistoryModel: makeModel({ onInsert: () => { called = true; } }),
    withMongoRetry: passThroughRetry,
    logger: noopLogger
  });
  await repo.recordSent("g1", []);
  assert.equal(called, false);
});

test("getRecent: aplica filtrul de tip, clamp pe limita si mapeaza documentele", async () => {
  let capturedFilter: Record<string, unknown> | null = null;
  let capturedLimit = 0;
  const repo = createHistoryRepository({
    NotificationHistoryModel: makeModel({
      onFind: filter => { capturedFilter = filter as Record<string, unknown>; },
      onLimit: count => { capturedLimit = count; },
      docs: [{ kind: "discount", gameKey: "", title: "Deal", link: "https://d", sentAt: new Date("2026-06-01T00:00:00Z") }]
    }),
    withMongoRetry: passThroughRetry,
    logger: noopLogger
  });
  const records = await repo.getRecent("g1", "discount", 5);
  assert.deepEqual(capturedFilter, { guildId: "g1", kind: "discount" });
  assert.equal(capturedLimit, 5);
  assert.equal(records.length, 1);
  assert.equal(records[0].kind, "discount");
  assert.ok(records[0].sentAt instanceof Date);
});

test("getRecent: kind 'all' nu filtreaza dupa kind", async () => {
  let capturedFilter: Record<string, unknown> | null = null;
  const repo = createHistoryRepository({
    NotificationHistoryModel: makeModel({ onFind: filter => { capturedFilter = filter as Record<string, unknown>; } }),
    withMongoRetry: passThroughRetry,
    logger: noopLogger
  });
  await repo.getRecent("g2", "all", 100);
  assert.deepEqual(capturedFilter, { guildId: "g2" });
});
