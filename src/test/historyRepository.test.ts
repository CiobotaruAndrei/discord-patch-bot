import test from "node:test";
import assert from "node:assert/strict";

import * as mod from "../features/notifications/historyRepository";
const { sanitizeHistoryDocs, clampHistoryLimit, createHistoryRepository, buildHistoryDedupeKey } = mod;

const passThroughRetry = <T>(fn: () => Promise<T>): Promise<T> => fn();
const noopLogger = () => undefined;

interface FakeModelOpts {
  onInsert?: () => void;
  insertThrows?: boolean;
  onBulkWrite?: (ops: unknown[]) => void;
  bulkWriteThrows?: boolean;
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
    bulkWrite: async (ops: unknown[]) => {
      if (opts.bulkWriteThrows) throw new Error("mongo down");
      if (opts.onBulkWrite) opts.onBulkWrite(ops);
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

test("recordSent e best-effort: nu arunca daca scrierea esueaza", async () => {
  let logged = false;
  const repo = createHistoryRepository({
    NotificationHistoryModel: makeModel({ bulkWriteThrows: true }),
    withMongoRetry: passThroughRetry,
    logger: () => { logged = true; }
  });
  await repo.recordSent("g1", [{ kind: "update", title: "x" }]);
  assert.equal(logged, true, "esecul trebuie logat, nu aruncat");
});

test("recordSent: intrarile cu identitate (link/title) sunt scrise idempotent prin upsert pe (guildId, dedupeKey)", async () => {
  let captured: unknown[] | null = null;
  const repo = createHistoryRepository({
    NotificationHistoryModel: makeModel({ onBulkWrite: ops => { captured = ops; } }),
    withMongoRetry: passThroughRetry,
    logger: noopLogger
  });
  await repo.recordSent("g1", [{ kind: "update", gameKey: "cs2", title: "Patch", link: "https://x/y", itemId: "u-123" }]);
  const ops = captured as Array<{ updateOne: { filter: Record<string, unknown>; update: Record<string, unknown>; upsert: boolean } }> | null;
  assert.ok(ops && ops.length === 1, "o operatie de upsert per intrare cu identitate");
  assert.equal(ops![0].updateOne.upsert, true, "upsert: true -> idempotent la re-livrare (crash recovery)");
  assert.deepEqual(ops![0].updateOne.filter, { guildId: "g1", dedupeKey: buildHistoryDedupeKey("update", "cs2", "https://x/y", "Patch", "u-123") }, "filtrul de dedup e (guildId, dedupeKey) cu cheie hash stabila");
  assert.match(String(ops![0].updateOne.filter.dedupeKey), /^history:v1:[0-9a-f]{64}$/, "dedupeKey e un hash sha256 cu prefix de versiune (rezistent la coliziuni de separator)");
  assert.ok("$setOnInsert" in ops![0].updateOne.update, "scrie doar la insert (nu suprascrie la re-livrare)");
});

test("buildHistoryDedupeKey: hash determinist, distinct per identitate, gol cand nu exista identitate", () => {
  const a = buildHistoryDedupeKey("update", "cs2", "https://x/y", "Patch", "u-1");
  assert.equal(a, buildHistoryDedupeKey("update", "cs2", "https://x/y", "Patch", "u-1"), "acelasi input -> aceeasi cheie (dedup la re-livrare)");
  assert.notEqual(a, buildHistoryDedupeKey("update", "cs2", "https://x/y", "Patch", "u-2"), "itemId diferit -> cheie diferita (nu colapseaza notificari distincte)");
  assert.equal(buildHistoryDedupeKey("update", "", "", "", ""), "", "fara identitate -> cheie goala (nu intra in index-ul unic partial)");
});

test("buildHistoryDedupeKey: separatorul nu cauzeaza coliziuni (hash peste JSON structurat)", () => {
  const split = buildHistoryDedupeKey("update", "a", "b:c", "", "");
  const shifted = buildHistoryDedupeKey("update", "a:b", "c", "", "");
  assert.notEqual(split, shifted, "valorile care contin ':' nu se ciocnesc (vechiul `${kind}:${gameKey}:${link}` le-ar fi colapsat)");
});

test("sanitizeHistoryDocs: doua notificari fara link cu acelasi titlu dar itemId diferit raman distincte", () => {
  const docs = sanitizeHistoryDocs("g", [
    { kind: "update", gameKey: "cs2", title: "Patch", itemId: "u-1" },
    { kind: "update", gameKey: "cs2", title: "Patch", itemId: "u-2" },
    { kind: "update" }
  ], new Date());
  assert.notEqual(docs[0].dedupeKey, docs[1].dedupeKey, "itemId diferit -> intrari distincte chiar fara link/titlu diferit");
  assert.match(docs[0].dedupeKey, /^history:v1:[0-9a-f]{64}$/);
  assert.equal(docs[2].dedupeKey, "", "fara link, titlu sau itemId -> dedupeKey gol");
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
