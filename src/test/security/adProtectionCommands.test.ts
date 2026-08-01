import test from "node:test";
import assert from "node:assert/strict";

import attachAdHandler from "../../features/command-handlers/adProtectionInteractionHandler.js";
import { createAdProtectionRepository } from "../../features/command-security/adProtectionRepository.js";
import { adFingerprint } from "../../features/command-security/adRequestTypes.js";
import { adAttemptLines, adRequestLines, orderAdRequests } from "../../features/command-presentation/adProtectionMessages.js";
import { START_STOP_TOGGLE_FIELDS, SET_CHANNEL_FIELDS } from "../../features/command-security/securityCommandFields.js";
import { adStore } from "./adStore.js";
import { moduleContext } from "../moduleContextStub.js";

import type { AdRequestRecord } from "../../features/command-security/adRequestTypes.js";

const T0 = new Date("2026-08-01T12:00:00.000Z");

function harness(settings: Record<string, unknown> = { adProtectionEnabled: true, adAlertChannelId: "c-ads" }) {
  const requests = adStore();
  const attempts = adStore();
  const sent: Record<string, unknown>[] = [];
  const handler = attachAdHandler.buildCommandHandler(moduleContext<Parameters<typeof attachAdHandler.buildCommandHandler>[0]>({
    AdRequestModel: requests,
    AdAttemptModel: attempts,
    getGuildSettings: async () => settings
  }));
  return { requests, attempts, sent, handler, repo: createAdProtectionRepository(requests, attempts) };
}

function interaction(overrides: Record<string, unknown> = {}, sent: Record<string, unknown>[] = []) {
  const replies: Record<string, unknown>[] = [];
  const strings = (overrides.strings ?? {}) as Record<string, string>;
  return {
    replies,
    guild: {
      id: "g1",
      ownerId: "owner-1",
      channels: { fetch: async () => ({ send: async (payload: Record<string, unknown>) => { sent.push(payload); return undefined; } }) }
    },
    user: { id: "u1" },
    isChatInputCommand: () => true,
    isButton: () => false,
    commandName: "ad-request",
    reply: async (payload: Record<string, unknown>) => { replies.push(payload); return undefined; },
    followUp: async (payload: Record<string, unknown>) => { replies.push(payload); return undefined; },
    update: async (payload: Record<string, unknown>) => { replies.push(payload); return undefined; },
    options: {
      getSubcommand: () => "list",
      getString: (name: string) => strings[name] ?? null,
      getUser: () => (overrides.target as { id: string } | undefined) ?? null,
      getAttachment: () => (overrides.attachment as { url: string } | undefined) ?? null
    },
    ...overrides
  };
}

async function run(setup: ReturnType<typeof harness>, overrides: Record<string, unknown> = {}) {
  const call = interaction(overrides, setup.sent);
  await setup.handler.handle(
    moduleContext<Parameters<typeof setup.handler.handle>[0]>(call),
    moduleContext<Parameters<typeof setup.handler.handle>[1]>({})
  );
  return call;
}

test("ad-protection si ad-alert-channel sunt inregistrate ca protectie reala", () => {
  assert.equal(SET_CHANNEL_FIELDS["ad-alert-channel"], "adAlertChannelId");
  const toggle = START_STOP_TOGGLE_FIELDS["ad-protection"];
  assert.ok(toggle, "fara intrare in tabel, /start ad-protection ar cadea pe handlerul de abonamente");
  assert.equal(toggle.channel, "adAlertChannelId");
  assert.equal(toggle.enabled, "adProtectionEnabled");
});

test("cu protectia oprita, cererea e refuzata cu explicatie in loc sa fie salvata", async () => {
  const setup = harness({ adProtectionEnabled: false, adAlertChannelId: "c-ads" });
  const call = await run(setup, { strings: { reclama: "Intra pe serverul meu" } });

  assert.match(String(call.replies[0]?.content), /nu este pornita/);
  assert.equal(setup.requests.records.length, 0);
});

test("fara canal configurat, cererea nu se salveaza degeaba", async () => {
  const setup = harness({ adProtectionEnabled: true, adAlertChannelId: null });
  const call = await run(setup, { strings: { reclama: "Intra pe serverul meu" } });

  assert.match(String(call.replies[0]?.content), /nu este configurat/);
  assert.equal(setup.requests.records.length, 0);
});

test("cererea salveaza reclama exacta si ajunge in canal cu butoane", async () => {
  const setup = harness();
  const call = await run(setup, { strings: { reclama: "Intra pe serverul meu discord.gg/abcd" } });

  assert.equal(setup.requests.records.length, 1);
  assert.equal(setup.requests.records[0].requesterId, "u1");
  assert.equal(setup.requests.records[0].invite, "discord.gg/abcd");
  assert.ok(setup.sent[0]?.components, "ownerul primeste butoanele Aproba/Respinge");
  assert.match(String(call.replies[0]?.content), /trimisa proprietarului/);
});

test("un text prea scurt e refuzat inainte de orice scriere", async () => {
  const setup = harness();
  const call = await run(setup, { strings: { reclama: "ab" } });

  assert.match(String(call.replies[0]?.content), /prea scurt/);
  assert.equal(setup.requests.records.length, 0);
});

test("un non-owner nu poate decide o cerere si nu poate vedea lista", async () => {
  const setup = harness();
  await run(setup, { strings: { reclama: "Intra pe serverul meu" } });
  const requestId = String(setup.requests.records[0]._id);

  const decision = await run(setup, { isButton: () => true, customId: `ad-request:approve:${requestId}`, user: { id: "alt" } });
  assert.match(String(decision.replies[0]?.content), /Doar proprietarul/);
  assert.equal(setup.requests.records[0].status, "pending");

  const list = await run(setup, { commandName: "ad-permissions", user: { id: "alt" } });
  assert.match(String(list.replies[0]?.content), /Doar proprietarul/);
});

test("ownerul aproba, iar mesajul spune limitele aprobarii si scoate butoanele", async () => {
  const setup = harness();
  await run(setup, { strings: { reclama: "Intra pe serverul meu" } });
  const requestId = String(setup.requests.records[0]._id);

  const call = await run(setup, { isButton: () => true, customId: `ad-request:approve:${requestId}`, user: { id: "owner-1" } });

  assert.equal(setup.requests.records[0].status, "approved");
  assert.match(String(call.replies[0]?.content), /o singura data/);
  assert.deepEqual(call.replies[0]?.components, []);
});

test("o cerere deja decisa nu mai poate fi decisa a doua oara", async () => {
  const setup = harness();
  await run(setup, { strings: { reclama: "Intra pe serverul meu" } });
  const requestId = String(setup.requests.records[0]._id);
  await run(setup, { isButton: () => true, customId: `ad-request:reject:${requestId}`, user: { id: "owner-1" } });

  const second = await run(setup, { isButton: () => true, customId: `ad-request:approve:${requestId}`, user: { id: "owner-1" } });

  assert.match(String(second.replies[0]?.content), /nu mai este in asteptare/);
  assert.equal(setup.requests.records[0].status, "rejected");
});

test("ad-attempts arata contorul si istoricul, iar un membru curat primeste 0/3", async () => {
  const setup = harness();
  await setup.repo.recordAttempt("g1", "u9", "c1", "invitatie", T0);
  await setup.repo.recordAttempt("g1", "u9", "c1", "invitatie", T0);

  const call = await run(setup, { commandName: "ad-attempts", target: { id: "u9" } });
  assert.match(String(call.replies[0]?.content), /2\/3/);

  const clean = await run(setup, { commandName: "ad-attempts", target: { id: "u-curat" } });
  assert.match(String(clean.replies[0]?.content), /0\/3/);
});

test("lista de cereri pune activele inaintea istoricului", () => {
  const base = {
    guildId: "g1", requesterId: "u1", adText: "reclama", fingerprint: adFingerprint("reclama", null),
    link: null, invite: null, attachmentUrl: null, target: null, ownerId: null,
    respondedAt: null, usedAt: null, expiresAt: null
  };
  const records: AdRequestRecord[] = [
    { ...base, _id: "a", status: "used", requestedAt: new Date("2026-08-01T10:00:00Z") },
    { ...base, _id: "b", status: "pending", requestedAt: new Date("2026-08-01T09:00:00Z") },
    { ...base, _id: "c", status: "approved", requestedAt: new Date("2026-08-01T08:00:00Z") }
  ];

  assert.deepEqual(orderAdRequests(records).map(entry => entry._id), ["b", "c", "a"]);
  assert.match(adRequestLines(records)[0], /active: 2/);
  assert.equal(adRequestLines([]).length, 0);
});

test("raportul de tentative spune cate warn-uri au fost emise, nu doar contorul curent", () => {
  const lines = adAttemptLines("u1", {
    _id: "g1:u1", guildId: "g1", userId: "u1", strikes: 1, totalDeleted: 7, totalWarns: 2,
    lastAttemptAt: T0, lastChannelId: "c1",
    history: [{ at: T0, channelId: "c1", summary: "invitatie", warned: true }]
  }).join("\n");

  assert.match(lines, /contor activ: \*\*1\/3\*\*/);
  assert.match(lines, /sterse in total: 7/);
  assert.match(lines, /warn-uri automate: 2/);
  assert.match(lines, /\(warn emis\)/);
});
