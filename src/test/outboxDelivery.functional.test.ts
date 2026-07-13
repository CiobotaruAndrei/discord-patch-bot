import test from "node:test";
import assert from "node:assert/strict";
import { createOutboxDelivery } from "../features/notifications/outboxDelivery.js";
import type { OutboxDeliveryClient } from "../features/notifications/outboxDelivery.js";
import { applyDedupeMarker, messageHasDedupeMarker, outboxDedupeMarker } from "../features/notifications/notificationOutbox.js";

interface SentPayload { embeds?: Array<{ footer?: { text?: string } }> }

function makeHarness(opts: {
  recoveryVerify?: boolean;
  recoveryStrict?: boolean;
  canSend?: boolean;
  channel?: "missing" | "ok";
  history?: "has" | "missing" | "throws";
  dedupeKey?: string;
  sendThrows?: unknown;
} = {}) {
  const sent: SentPayload[] = [];
  let historyFetches = 0;
  const dedupeKey = opts.dedupeKey ?? "abcdef0123456789ffffffff";
  const marker = outboxDedupeMarker(dedupeKey);
  const channel = {
    id: "c1",
    send: async (payload: SentPayload) => {
      if (opts.sendThrows) throw opts.sendThrows;
      sent.push(payload);
      return { id: "msg" };
    },
    messages: {
      fetch: async () => {
        historyFetches++;
        if (opts.history === "throws") throw new Error("fetch failed");
        if (opts.history === "has") return [{ embeds: [{ footer: { text: `deal · ${marker}` } }] }];
        return [];
      }
    }
  };
  const client: OutboxDeliveryClient = {
    isReady: () => true,
    user: { id: "bot-1" },
    channels: { fetch: async () => (opts.channel === "missing" ? null : channel) }
  };
  const delivery = createOutboxDelivery({
    canSendEmbeds: () => opts.canSend ?? true,
    isPermanentDiscordError: (err: unknown) => (err as { code?: number } | null)?.code === 50001,
    acquireSendSlot: async () => undefined,
    applyDedupeMarker, messageHasDedupeMarker, outboxDedupeMarker,
    recoveryVerify: opts.recoveryVerify ?? false,
    recoveryStrict: opts.recoveryStrict ?? false
  });
  return { delivery, sent, client, dedupeKey, marker, getHistoryFetches: () => historyFetches };
}

test("outboxDelivery: client fara user (ne-ready) -> esec tranzitoriu, nu dead-letter (review #11.1)", async () => {
  const a = makeHarness();
  const notReadyClient: OutboxDeliveryClient = { isReady: () => true, user: null, channels: a.client.channels };
  const result = await a.delivery.deliver(notReadyClient, { channelId: "c1", payload: {} });
  assert.deepEqual(result, { ok: false, permanent: false }, "jobul se reincearca dupa ce clientul devine ready, nu ajunge in dead-letter");
  assert.equal(a.sent.length, 0, "nimic trimis cu clientul ne-ready");
});

test("outboxDelivery: canal lipsa sau fara permisiuni -> esec permanent", async () => {
  const a = makeHarness({ channel: "missing" });
  assert.deepEqual(await a.delivery.deliver(a.client, { channelId: "c1", payload: {} }), { ok: false, permanent: true });
  const b = makeHarness({ canSend: false });
  assert.deepEqual(await b.delivery.deliver(b.client, { channelId: "c1", payload: {} }), { ok: false, permanent: true });
});

test("outboxDelivery: send aruncă -> esec, permanent dupa codul Discord", async () => {
  const a = makeHarness({ sendThrows: { code: 50001 } });
  assert.deepEqual(await a.delivery.deliver(a.client, { channelId: "c1", payload: { embeds: [{}] } }), { ok: false, permanent: true });
  const b = makeHarness({ sendThrows: { code: 0 } });
  assert.deepEqual(await b.delivery.deliver(b.client, { channelId: "c1", payload: { embeds: [{}] } }), { ok: false, permanent: false });
});

test("outboxDelivery: verify off -> trimite payload-ul fara marker, fara fetch istoric", async () => {
  const h = makeHarness({ recoveryVerify: false });
  const res = await h.delivery.deliver(h.client, { channelId: "c1", payload: { embeds: [{ footer: { text: "deal" } }] }, dedupeKey: h.dedupeKey, deliveries: 2 });
  assert.deepEqual(res, { ok: true });
  assert.equal(h.getHistoryFetches(), 0, "verify off -> nu se face fetch istoric");
  assert.ok(!h.sent[0].embeds?.[0].footer?.text?.includes("id:"), "fara marker cand verify e off");
});

test("outboxDelivery: job proaspat (deliveries=1, verify on) -> trimite cu marker, fara fetch istoric", async () => {
  const h = makeHarness({ recoveryVerify: true });
  const res = await h.delivery.deliver(h.client, { channelId: "c1", payload: { embeds: [{}] }, dedupeKey: h.dedupeKey, deliveries: 1 });
  assert.deepEqual(res, { ok: true });
  assert.equal(h.getHistoryFetches(), 0, "job proaspat nu verifica istoricul");
  assert.ok(h.sent[0].embeds?.[0].footer?.text?.includes(h.marker), "embed-ul primeste marker-ul");
});

test("outboxDelivery: recovery (deliveries>1) cu marker gasit in istoric -> NU re-trimite", async () => {
  const h = makeHarness({ recoveryVerify: true, history: "has" });
  const res = await h.delivery.deliver(h.client, { channelId: "c1", payload: { embeds: [{}] }, dedupeKey: h.dedupeKey, deliveries: 2 });
  assert.deepEqual(res, { ok: true, recoveryFetched: true, recoveryDuplicate: true });
  assert.equal(h.sent.length, 0, "mesaj deja postat -> fara re-trimitere");
});

test("outboxDelivery: recovery fara marker in istoric -> trimite (recoveryFetched)", async () => {
  const h = makeHarness({ recoveryVerify: true, history: "missing" });
  const res = await h.delivery.deliver(h.client, { channelId: "c1", payload: { embeds: [{}] }, dedupeKey: h.dedupeKey, deliveries: 2 });
  assert.deepEqual(res, { ok: true, recoveryFetched: true, recoveryFailed: false, recoveryMarkerMissing: true });
  assert.equal(h.sent.length, 1, "nu e in istoric -> trimite");
});

test("outboxDelivery: recovery cu fetch istoric esuat -> trimite, marcheaza recoveryFailed", async () => {
  const h = makeHarness({ recoveryVerify: true, history: "throws" });
  const res = await h.delivery.deliver(h.client, { channelId: "c1", payload: { embeds: [{}] }, dedupeKey: h.dedupeKey, deliveries: 2 });
  assert.deepEqual(res, { ok: true, recoveryFetched: false, recoveryFailed: true, recoveryMarkerMissing: false });
  assert.equal(h.sent.length, 1, "la esec de verificare, trimite (fail-open)");
});

test("outboxDelivery: strict mode + fetch istoric esuat -> NU trimite, esec tranzitoriu cu recoveryFailed", async () => {
  const h = makeHarness({ recoveryVerify: true, recoveryStrict: true, history: "throws" });
  const res = await h.delivery.deliver(h.client, { channelId: "c1", payload: { embeds: [{}] }, dedupeKey: h.dedupeKey, deliveries: 2 });
  assert.deepEqual(res, { ok: false, permanent: false, recoveryFailed: true }, "strict -> fail-closed, reprogrameaza cu backoff");
  assert.equal(h.sent.length, 0, "strict: nu trimite cand nu poate verifica istoricul");
});

test("outboxDelivery: strict mode + marker gasit in istoric -> NU re-trimite (duplicat prevenit)", async () => {
  const h = makeHarness({ recoveryVerify: true, recoveryStrict: true, history: "has" });
  const res = await h.delivery.deliver(h.client, { channelId: "c1", payload: { embeds: [{}] }, dedupeKey: h.dedupeKey, deliveries: 2 });
  assert.deepEqual(res, { ok: true, recoveryFetched: true, recoveryDuplicate: true });
  assert.equal(h.sent.length, 0);
});

test("outboxDelivery: strict mode + istoric citit fara marker -> trimite normal", async () => {
  const h = makeHarness({ recoveryVerify: true, recoveryStrict: true, history: "missing" });
  const res = await h.delivery.deliver(h.client, { channelId: "c1", payload: { embeds: [{}] }, dedupeKey: h.dedupeKey, deliveries: 2 });
  assert.deepEqual(res, { ok: true, recoveryFetched: true, recoveryFailed: false, recoveryMarkerMissing: true });
  assert.equal(h.sent.length, 1, "verificare reusita, marker absent -> trimite");
});

test("outboxDelivery: override per-guild (job.recoveryVerify=true) activeaza verificarea desi global e off", async () => {
  const h = makeHarness({ recoveryVerify: false, history: "has" });
  const res = await h.delivery.deliver(h.client, { channelId: "c1", payload: { embeds: [{}] }, dedupeKey: h.dedupeKey, deliveries: 2, recoveryVerify: true });
  assert.equal((res as { recoveryDuplicate?: boolean }).recoveryDuplicate, true, "flag-ul de pe job activeaza verificarea");
  assert.equal(h.sent.length, 0);
});
