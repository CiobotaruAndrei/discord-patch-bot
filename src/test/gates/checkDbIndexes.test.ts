import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import attachMongoModels from "../../infra/mongo/models.js";
import * as mod from "../../scripts/check-db-indexes.js";
const { analyzeIndexes, collectDeclaredIndexes } = mod;

type DeclaredIndex = import("../../scripts/check-db-indexes.js").DeclaredIndex;

function idx(partial: Partial<DeclaredIndex> & { collection: string; key: Record<string, number | string> }): DeclaredIndex {
  return {
    model: partial.model || "M",
    collection: partial.collection,
    key: partial.key,
    fields: partial.fields || Object.keys(partial.key),
    unknownFields: partial.unknownFields || [],
    unique: partial.unique || false,
    sparse: partial.sparse || false,
    ttlSeconds: partial.ttlSeconds
  };
}

const DOC_ALL = "guilds notificationOutbox createdAt fetchsnapshots fetchedAt";

test("analyzeIndexes detecteaza index duplicat (aceeasi colectie + cheie)", () => {
  const indexes = [
    idx({ collection: "guilds", key: { subscribed: 1 } }),
    idx({ collection: "guilds", key: { subscribed: 1 } })
  ];
  const report = analyzeIndexes(indexes, "guilds subscribed");
  assert.equal(report.duplicates.length, 1);
  assert.equal(report.pass, false);
});

test("analyzeIndexes detecteaza index pe camp inexistent in schema", () => {
  const indexes = [idx({ collection: "guilds", key: { subscribedTypo: 1 }, unknownFields: ["subscribedTypo"] })];
  const report = analyzeIndexes(indexes, "guilds subscribedTypo");
  assert.equal(report.unknownFieldIndexes.length, 1);
  assert.match(report.unknownFieldIndexes[0], /subscribedTypo/);
  assert.equal(report.pass, false);
});

test("analyzeIndexes detecteaza colectie nedocumentata in OPERATIONS", () => {
  const indexes = [idx({ collection: "newCollection", key: { x: 1 }, fields: ["x"] })];
  const report = analyzeIndexes(indexes, "guilds notificationOutbox");
  assert.ok(report.undocumented.some(u => u.includes("newCollection")));
  assert.equal(report.pass, false);
});

test("analyzeIndexes detecteaza camp TTL nedocumentat", () => {
  const indexes = [idx({ collection: "fetchsnapshots", key: { fetchedAt: 1 }, fields: ["fetchedAt"], ttlSeconds: 86400 })];
  const report = analyzeIndexes(indexes, "fetchsnapshots");
  assert.ok(report.undocumented.some(u => u.includes("fetchedAt")), "campul TTL trebuie documentat explicit");
  assert.equal(report.pass, false);
});

test("analyzeIndexes trece cand totul e valid + documentat", () => {
  const indexes = [
    idx({ collection: "guilds", key: { subscribed: 1, notificationChannelId: 1 }, fields: ["subscribed", "notificationChannelId"] }),
    idx({ collection: "notificationOutbox", key: { createdAt: 1 }, fields: ["createdAt"], ttlSeconds: 604800 }),
    idx({ collection: "fetchsnapshots", key: { fetchedAt: 1 }, fields: ["fetchedAt"], ttlSeconds: 86400 })
  ];
  const report = analyzeIndexes(indexes, DOC_ALL + " subscribed notificationChannelId");
  assert.equal(report.duplicates.length, 0);
  assert.equal(report.unknownFieldIndexes.length, 0);
  assert.equal(report.undocumented.length, 0);
  assert.equal(report.pass, true);
});

test("gate real: index-urile reale din models.ts sunt valide si documentate in OPERATIONS.md", () => {
  const indexes = collectDeclaredIndexes(mongoose, attachMongoModels);
  assert.ok(indexes.length >= 8, `asteptam mai multe index-uri declarate, am gasit ${indexes.length}`);
  const outboxDedupe = indexes.find(i => i.collection === "notificationOutbox" && i.key.dedupeKey === 1);
  assert.ok(outboxDedupe, "indexul dedupeKey pe notificationOutbox exista");
  assert.equal(outboxDedupe?.unique, true);
  assert.equal(outboxDedupe?.sparse, true);

  const repoRoot = path.resolve(process.cwd(), "..");
  const operationsText = fs.readFileSync(path.join(repoRoot, "OPERATIONS.md"), "utf8");
  const report = analyzeIndexes(indexes, operationsText);
  assert.equal(report.duplicates.length, 0, `duplicate: ${report.duplicates.join(", ")}`);
  assert.equal(report.unknownFieldIndexes.length, 0, `camp inexistent: ${report.unknownFieldIndexes.join("; ")}`);
  assert.equal(report.undocumented.length, 0, `nedocumentate: ${report.undocumented.join(", ")}`);
  assert.equal(report.pass, true);
});
