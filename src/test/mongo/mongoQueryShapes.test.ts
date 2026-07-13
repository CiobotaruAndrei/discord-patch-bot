import test from "node:test";
import assert from "node:assert/strict";
import type { MongoFilter, MongoUpdate, MongoProjection, MongoQueryOptions } from "../../infra/mongo/mongoQueryShapes.js";

test("formele Mongo comune accepta obiecte de query/update tipice (contract compile-time)", () => {
  const filter: MongoFilter = { guildId: "g1", status: { $in: ["queued", "leased"] } };
  const update: MongoUpdate = { $set: { status: "delivered" }, $unset: { lockedUntil: "" } };
  const projection: MongoProjection = { seenDiscounts: 1, _id: 0 };
  const options: MongoQueryOptions = { upsert: true, ordered: false };

  assert.equal(filter.guildId, "g1");
  assert.deepEqual((update.$set as Record<string, unknown>).status, "delivered");
  assert.equal(projection.seenDiscounts, 1);
  assert.equal(options.upsert, true);
});
