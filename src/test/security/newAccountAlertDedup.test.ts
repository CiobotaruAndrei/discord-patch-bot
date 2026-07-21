import test from "node:test";
import assert from "node:assert/strict";

import { createNewAccountAlertDelivery } from "../../features/command-security/newAccountAlertDedup.js";

const FIXED_NOW = Date.parse("2026-07-18T12:00:00.000Z");

function memoryModel(nowFn: () => number = () => FIXED_NOW, opts: { failMarkDelivered?: boolean } = {}) {
  const rows = new Map<string, { status: string; claimToken?: string; leaseUntil: Date; deliveredAt?: Date }>();
  return {
    rows,
    model: {
      findOneAndUpdate: async (filter: Record<string, object | string | object[]>, update: { $set?: Record<string, string | Date> }) => {
        const id = String(filter._id);
        const current = rows.get(id);
        const now = nowFn();
        if (current?.status === "delivered" || current?.status === "sent-unconfirmed" || (current && current.leaseUntil.getTime() > now)) throw new Error("duplicate key");
        const row = {
          status: String(update.$set?.status),
          claimToken: String(update.$set?.claimToken),
          leaseUntil: new Date(String(update.$set?.leaseUntil))
        };
        rows.set(id, row);
        return row;
      },
      updateOne: async (filter: Record<string, string>, update: { $set?: Record<string, string | Date>; $unset?: Record<string, string> }) => {
        if (opts.failMarkDelivered && update.$set?.status === "delivered") throw new Error("mongo down");
        const row = rows.get(filter._id);
        if (!row || row.claimToken !== filter.claimToken || row.status !== filter.status) return { modifiedCount: 0 };
        if (update.$set?.status) row.status = String(update.$set.status);
        if (update.$set?.deliveredAt) row.deliveredAt = new Date(String(update.$set.deliveredAt));
        if (update.$set?.leaseUntil) row.leaseUntil = new Date(String(update.$set.leaseUntil));
        if (update.$unset?.claimToken !== undefined) delete row.claimToken;
        return { modifiedCount: 1 };
      }
    }
  };
}

test("new-account delivery: claim concurent, delivered si deduplicare persistenta", async () => {
  const memory = memoryModel();
  let token = 0;
  const delivery = createNewAccountAlertDelivery(memory.model, () => `token-${++token}`, () => Date.parse("2026-07-18T12:00:00.000Z"));
  const [first, second] = await Promise.all([delivery.claim("guild-1", "user-1"), delivery.claim("guild-1", "user-1")]);
  assert.ok(first);
  assert.equal(second, null);
  assert.equal(await first.markDelivered(), true);
  assert.equal(await delivery.claim("guild-1", "user-1"), null);
});

test("new-account delivery: markDelivered esuat dupa send -> sent-unconfirmed, fara re-revendicare (audit 154b #3)", async () => {
  const memory = memoryModel(() => FIXED_NOW, { failMarkDelivered: true });
  let token = 0;
  const delivery = createNewAccountAlertDelivery(memory.model, () => `token-${++token}`, () => FIXED_NOW);
  const claim = await delivery.claim("guild-1", "user-1");
  assert.ok(claim);
  assert.equal(await claim.markDelivered().catch(() => false), false, "markDelivered esueaza (hiccup Mongo dupa send reusit)");
  assert.equal(await claim.markSentUnconfirmed(), true, "starea persista drept sent-unconfirmed, nu succes complet");
  assert.equal(memory.rows.get("guild-1:user-1")?.status, "sent-unconfirmed");

  const laterDelivery = createNewAccountAlertDelivery(memory.model, () => "token-later", () => FIXED_NOW + 10 * 60_000);
  assert.equal(await laterDelivery.claim("guild-1", "user-1"), null, "dupa expirarea lease-ului (5 min) sent-unconfirmed NU se re-revendica -> fara duplicat / fara retrimitere oarba la restart");
});

test("new-account delivery: release dupa send esuat permite retry", async () => {
  const memory = memoryModel();
  let token = 0;
  const delivery = createNewAccountAlertDelivery(memory.model, () => `token-${++token}`, () => Date.parse("2026-07-18T12:00:00.000Z"));
  const first = await delivery.claim("guild-1", "user-1");
  assert.ok(first);
  await first.release();
  assert.ok(await delivery.claim("guild-1", "user-1"));
});
