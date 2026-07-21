import test from "node:test";
import assert from "node:assert/strict";

import {
  createNewAccountAlertDelivery,
  deliverNewAccountAlert,
  reconcileStuckNewAccountSends,
  countUnresolvedNewAccountSends
} from "../../features/command-security/newAccountAlertDedup.js";

const FIXED_NOW = Date.parse("2026-07-18T12:00:00.000Z");

interface Row {
  guildId?: string;
  userId?: string;
  status: string;
  claimToken?: string;
  leaseUntil: Date;
  sendingAt?: Date;
  deliveredAt?: Date;
}

interface MemoryOptions {
  failStatuses?: string[];
}

function statusMatches(expected: unknown, actual: string): boolean {
  if (typeof expected === "string") return expected === actual;
  if (expected && typeof expected === "object" && "$in" in expected) {
    const allowed = (expected as { $in?: unknown }).$in;
    return Array.isArray(allowed) && allowed.includes(actual);
  }
  return false;
}

function memoryModel(nowFn: () => number = () => FIXED_NOW, opts: MemoryOptions = {}) {
  const rows = new Map<string, Row>();
  const failing = new Set(opts.failStatuses ?? []);
  return {
    rows,
    model: {
      findOneAndUpdate: async (filter: Record<string, object | string | object[]>, update: { $set?: Record<string, string | Date> }) => {
        const id = String(filter._id);
        const current = rows.get(id);
        const now = nowFn();
        if (current && ["delivered", "sent-unconfirmed", "sending"].includes(current.status)) throw new Error("duplicate key");
        if (current && current.leaseUntil.getTime() > now) throw new Error("duplicate key");
        const row: Row = {
          guildId: String(update.$set?.guildId ?? ""),
          userId: String(update.$set?.userId ?? ""),
          status: String(update.$set?.status),
          claimToken: String(update.$set?.claimToken),
          leaseUntil: new Date(String(update.$set?.leaseUntil))
        };
        rows.set(id, row);
        return row;
      },
      updateOne: async (filter: Record<string, unknown>, update: { $set?: Record<string, string | Date>; $unset?: Record<string, string> }) => {
        const nextStatus = update.$set?.status;
        if (typeof nextStatus === "string" && failing.has(nextStatus)) throw new Error("mongo down");
        const row = rows.get(String(filter._id));
        if (!row || row.claimToken !== filter.claimToken || !statusMatches(filter.status, row.status)) return { modifiedCount: 0 };
        if (update.$set?.status) row.status = String(update.$set.status);
        if (update.$set?.deliveredAt) row.deliveredAt = new Date(String(update.$set.deliveredAt));
        if (update.$set?.leaseUntil) row.leaseUntil = new Date(String(update.$set.leaseUntil));
        if (update.$set?.sendingAt) row.sendingAt = new Date(String(update.$set.sendingAt));
        if (update.$unset?.claimToken !== undefined) delete row.claimToken;
        if (update.$unset?.sendingAt !== undefined) delete row.sendingAt;
        return { modifiedCount: 1 };
      },
      updateMany: async (filter: Record<string, unknown>, update: { $set?: Record<string, string | Date>; $unset?: Record<string, string> }) => {
        const before = filter.sendingAt && typeof filter.sendingAt === "object" && "$lte" in filter.sendingAt
          ? new Date(String((filter.sendingAt as { $lte?: unknown }).$lte)).getTime()
          : Number.POSITIVE_INFINITY;
        let modifiedCount = 0;
        for (const row of rows.values()) {
          if (row.status !== filter.status) continue;
          if (!row.sendingAt || row.sendingAt.getTime() > before) continue;
          row.status = String(update.$set?.status);
          delete row.sendingAt;
          modifiedCount++;
        }
        return { modifiedCount };
      },
      countDocuments: async (filter: Record<string, unknown>) => {
        let total = 0;
        for (const row of rows.values()) {
          if (row.guildId === filter.guildId && row.status === filter.status) total++;
        }
        return total;
      }
    }
  };
}

test("new-account delivery: claim concurent, delivered si deduplicare persistenta", async () => {
  const memory = memoryModel();
  let token = 0;
  const delivery = createNewAccountAlertDelivery(memory.model, () => `token-${++token}`, () => FIXED_NOW);
  const [first, second] = await Promise.all([delivery.claim("guild-1", "user-1"), delivery.claim("guild-1", "user-1")]);
  assert.ok(first);
  assert.equal(second, null);
  assert.equal(await first.beginSend(), true);
  assert.equal(await first.markDelivered(), true);
  assert.equal(await delivery.claim("guild-1", "user-1"), null);
});

test("new-account delivery: markDelivered esuat dupa send -> sent-unconfirmed, fara re-revendicare (audit 154b #3)", async () => {
  const memory = memoryModel(() => FIXED_NOW, { failStatuses: ["delivered"] });
  let token = 0;
  const delivery = createNewAccountAlertDelivery(memory.model, () => `token-${++token}`, () => FIXED_NOW);
  const claim = await delivery.claim("guild-1", "user-1");
  assert.ok(claim);
  assert.equal(await claim.beginSend(), true);
  assert.equal(await claim.markDelivered().catch(() => false), false, "markDelivered esueaza (hiccup Mongo dupa send reusit)");
  assert.equal(await claim.markSentUnconfirmed(), true, "starea persista drept sent-unconfirmed, nu succes complet");
  assert.equal(memory.rows.get("guild-1:user-1")?.status, "sent-unconfirmed");

  const laterDelivery = createNewAccountAlertDelivery(memory.model, () => "token-later", () => FIXED_NOW + 10 * 60_000);
  assert.equal(await laterDelivery.claim("guild-1", "user-1"), null, "dupa expirarea lease-ului (5 min) sent-unconfirmed NU se re-revendica -> fara duplicat / fara retrimitere oarba la restart");
  assert.equal(memory.rows.get("guild-1:user-1")?.status, "sent-unconfirmed", "starea protectoare ramane neschimbata dupa incercarea de re-revendicare");
});

test("new-account delivery: release dupa send esuat permite retry", async () => {
  const memory = memoryModel();
  let token = 0;
  const delivery = createNewAccountAlertDelivery(memory.model, () => `token-${++token}`, () => FIXED_NOW);
  const first = await delivery.claim("guild-1", "user-1");
  assert.ok(first);
  assert.equal(await first.release(), true);
  assert.ok(await delivery.claim("guild-1", "user-1"));
});

test("outage Mongo TOTAL dupa un send reusit: starea ramane nedeterminata si NU se retrimite dupa expirarea lease-ului (audit 154c #2)", async () => {
  const memory = memoryModel(() => FIXED_NOW, { failStatuses: ["delivered", "sent-unconfirmed"] });
  let token = 0;
  const delivery = createNewAccountAlertDelivery(memory.model, () => `token-${++token}`, () => FIXED_NOW);
  const claim = await delivery.claim("guild-1", "user-1");
  assert.ok(claim);

  let sends = 0;
  const outcome = await deliverNewAccountAlert(claim, async () => { sends++; });
  assert.equal(sends, 1, "mesajul a fost trimis o data");
  assert.equal(outcome, "undetermined", "cand ambele scrieri de finalizare esueaza, starea raportata este nedeterminata, nu sent-unconfirmed confirmat");
  assert.equal(memory.rows.get("guild-1:user-1")?.status, "sending", "documentul ramane in starea protectoare persistata INAINTE de send");

  const afterLease = createNewAccountAlertDelivery(memory.model, () => "token-later", () => FIXED_NOW + 60 * 60_000);
  assert.equal(
    await afterLease.claim("guild-1", "user-1"),
    null,
    "dupa o ora (mult peste lease-ul de 5 minute) perechea guild+user NU poate fi re-revendicata, deci mesajul nu se retrimite"
  );
});

test("scrierea protectoare esuata INAINTE de send opreste trimiterea (fail-closed), nu trimite orbeste", async () => {
  let clock = FIXED_NOW;
  const memory = memoryModel(() => clock, { failStatuses: ["sending"] });
  let token = 0;
  const delivery = createNewAccountAlertDelivery(memory.model, () => `token-${++token}`, () => clock);
  const claim = await delivery.claim("guild-1", "user-1");
  assert.ok(claim);

  let sends = 0;
  const outcome = await deliverNewAccountAlert(claim, async () => { sends++; });
  assert.equal(outcome, "not-claimed");
  assert.equal(sends, 0, "fara starea protectoare persistata nu se trimite nimic");
  assert.equal(memory.rows.get("guild-1:user-1")?.status, "claimed", "documentul ramane doar revendicat, nu trece in starea de trimitere");

  clock = FIXED_NOW + 10 * 60_000;
  assert.ok(await delivery.claim("guild-1", "user-1"), "nimic nu a fost livrat, deci dupa expirarea lease-ului reincercarea este permisa");
});

test("un send esuat elibereaza claim-ul, deci alerta poate fi reincercata", async () => {
  const memory = memoryModel();
  let token = 0;
  const delivery = createNewAccountAlertDelivery(memory.model, () => `token-${++token}`, () => FIXED_NOW);
  const claim = await delivery.claim("guild-1", "user-1");
  assert.ok(claim);

  await assert.rejects(deliverNewAccountAlert(claim, async () => { throw new Error("Discord 503"); }));
  assert.equal(memory.rows.get("guild-1:user-1")?.status, "released");
  assert.ok(await delivery.claim("guild-1", "user-1"), "un esec de trimitere nu blocheaza definitiv alerta");
});

test("recovery-ul de la repornire inchide starea ambigua fara sa retrimita nimic (audit 154c #2)", async () => {
  const memory = memoryModel(() => FIXED_NOW, { failStatuses: ["delivered", "sent-unconfirmed"] });
  let token = 0;
  const delivery = createNewAccountAlertDelivery(memory.model, () => `token-${++token}`, () => FIXED_NOW);
  const claim = await delivery.claim("guild-1", "user-1");
  assert.ok(claim);
  await deliverNewAccountAlert(claim, async () => undefined);
  assert.equal(await countUnresolvedNewAccountSends(memory.model, "guild-1"), 1, "starea nedeterminata este vizibila operational");

  const tooEarly = await reconcileStuckNewAccountSends(memory.model, 15 * 60_000, () => FIXED_NOW + 60_000);
  assert.equal(tooEarly, 0, "o trimitere in curs nu e inchisa prematur");

  const closed = await reconcileStuckNewAccountSends(memory.model, 15 * 60_000, () => FIXED_NOW + 30 * 60_000);
  assert.equal(closed, 1);
  assert.equal(memory.rows.get("guild-1:user-1")?.status, "sent-unconfirmed", "recovery-ul presupune ca mesajul a plecat si inchide starea; NU redeschide claim-ul");
  assert.equal(await countUnresolvedNewAccountSends(memory.model, "guild-1"), 0);

  const afterRecovery = createNewAccountAlertDelivery(memory.model, () => "token-later", () => FIXED_NOW + 60 * 60_000);
  assert.equal(await afterRecovery.claim("guild-1", "user-1"), null, "dupa reconciliere alerta tot nu se retrimite");
});
