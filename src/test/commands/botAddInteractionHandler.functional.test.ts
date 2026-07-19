import test from "node:test";
import assert from "node:assert/strict";

import { buildCommandHandler, display, orderBotAddRecords } from "../../features/command-handlers/botAddInteractionHandler.js";
import type { BotAddPermissionRecord } from "../../features/moderation/botAddRepository.js";

const NOW = Date.parse("2026-07-18T12:00:00.000Z");

function record(overrides: Partial<BotAddPermissionRecord>): BotAddPermissionRecord {
  return {
    requestId: "req",
    botId: "111111111111111111",
    requesterId: "user-1",
    requestedAt: new Date(NOW),
    status: "pending",
    ...overrides
  };
}

test("orderBotAddRecords: intrarile active (pending/approved neexpirate) sunt inaintea istoricului (audit, #29)", () => {
  const records = [
    record({ requestId: "old-used", status: "used", requestedAt: new Date(NOW - 1000), usedAt: new Date(NOW) }),
    record({ requestId: "active-approved", status: "approved", requestedAt: new Date(NOW - 5000), expiresAt: new Date(NOW + 60_000) }),
    record({ requestId: "old-rejected", status: "rejected", requestedAt: new Date(NOW - 2000) }),
    record({ requestId: "active-pending", status: "pending", requestedAt: new Date(NOW - 3000), expiresAt: new Date(NOW + 60_000) }),
    record({ requestId: "expired-approved", status: "approved", requestedAt: new Date(NOW - 4000), expiresAt: new Date(NOW - 60_000) })
  ];
  const ordered = orderBotAddRecords(records, NOW).map(entry => entry.requestId);
  assert.deepEqual(ordered.slice(0, 2), ["active-pending", "active-approved"], "cele doua active, ordonate dupa recenta cererii, sunt primele");
  assert.ok(ordered.indexOf("active-approved") < ordered.indexOf("old-used"), "activele sunt inaintea istoricului");
  assert.ok(ordered.indexOf("active-approved") < ordered.indexOf("expired-approved"), "aprobarea expirata e istoric, nu activa");
});

test("display: contine toate campurile - requestId, bot, solicitant, status, cerut, raspuns de owner (audit, #29)", () => {
  const line = display(record({ requestId: "req-7", status: "rejected", ownerId: "owner-1", respondedAt: new Date(NOW) }));
  assert.match(line, /#req-7/);
  assert.match(line, /bot 111111111111111111/);
  assert.match(line, /solicitant <@user-1>/);
  assert.match(line, /status respinsa/);
  assert.match(line, /cerut </);
  assert.match(line, /de <@owner-1>/);
});

test("respingerea unei solicitari bot-add notifica solicitantul in canal si direct", async () => {
  const updates: Array<{ content?: string; allowedMentions?: { users?: string[] } }> = [];
  const direct: Array<{ content?: string }> = [];
  const handler = buildCommandHandler({
    GuildModel: {
      updateOne: async () => ({}),
      findOne: async () => ({ botAddPermissions: [] }),
      findOneAndUpdate: async () => ({
        botAddPermissions: [record({ requestId: "req-1", requesterId: "user-9", status: "rejected", ownerId: "owner-1", respondedAt: new Date(NOW) })]
      })
    },
    getGuildSettings: async () => ({ botAddProtectionEnabled: true, botAddAlertChannelId: "chan" })
  });
  const interaction = {
    isButton: () => true,
    isChatInputCommand: () => false,
    customId: "bot-add:reject:req-1",
    guild: {
      id: "guild-1",
      ownerId: "owner-1",
      members: { fetch: async () => ({ send: async (payload: unknown) => { direct.push(payload as { content?: string }); return payload; } }) }
    },
    user: { id: "owner-1" },
    reply: async () => undefined,
    update: async (payload: unknown) => { updates.push(payload as { content?: string; allowedMentions?: { users?: string[] } }); return payload; }
  };
  await handler.handle(interaction, []);

  assert.equal(updates.length, 1, "raspunsul editeaza mesajul de aprobare");
  assert.match(updates[0].content ?? "", /Respinsa/);
  assert.match(updates[0].content ?? "", /<@user-9>/);
  assert.match(updates[0].content ?? "", /respinsa de owner/);
  assert.match(updates[0].content ?? "", /Notificare directa trimisa/);
  assert.deepEqual(updates[0].allowedMentions?.users, ["user-9"], "solicitantul e mentionat efectiv");
  assert.equal(direct.length, 1);
  assert.match(direct[0].content ?? "", /respinsa de owner/);
});

test("o solicitare anulata la oprirea protectiei nu mai poate fi aprobata", async () => {
  const updates: Array<{ content?: string; components?: unknown[] }> = [];
  const handler = buildCommandHandler({
    GuildModel: {
      updateOne: async () => ({}),
      findOne: async () => ({ botAddPermissions: [record({ status: "cancelled", cancellationReason: "protection-stopped", cancelledAt: new Date(NOW) })] }),
      findOneAndUpdate: async () => null
    },
    getGuildSettings: async () => ({ botAddProtectionEnabled: false, botAddAlertChannelId: "chan" })
  });
  const interaction = {
    isButton: () => true,
    isChatInputCommand: () => false,
    customId: "bot-add:approve:req",
    guild: { id: "guild-1", ownerId: "owner-1" },
    user: { id: "owner-1" },
    reply: async () => undefined,
    update: async (payload: unknown) => { updates.push(payload as { content?: string; components?: unknown[] }); return payload; }
  };

  await handler.handle(interaction, []);

  assert.match(updates[0].content ?? "", /anulata la oprirea protectiei/);
  assert.deepEqual(updates[0].components, []);
});

test("bot-add request: canal de aprobare indisponibil => NU se persista solicitarea (fara orfan) (audit, #9)", async () => {
  let createCalls = 0;
  const replies: Array<{ content?: string }> = [];
  const handler = buildCommandHandler({
    GuildModel: {
      updateOne: async () => ({}),
      findOne: async () => ({ botAddPermissions: [] }),
      findOneAndUpdate: async () => { createCalls++; return { botAddPermissions: [] }; }
    },
    getGuildSettings: async () => ({ botAddProtectionEnabled: true, botAddAlertChannelId: "chan" })
  });
  const interaction = {
    isButton: () => false,
    isChatInputCommand: () => true,
    commandName: "bot-add-request",
    options: { getString: () => "222222222222222222" },
    guild: { id: "guild-1", ownerId: "owner-1", channels: { fetch: async () => null }, members: { fetch: async () => null } },
    user: { id: "user-1" },
    reply: async (payload: unknown) => { replies.push(payload as { content?: string }); return payload; }
  };
  await handler.handle(interaction, []);
  assert.equal(createCalls, 0, "validarea canalului e inainte de persistenta; nu se creeaza record");
  assert.match(replies[0]?.content ?? "", /nu este disponibil/);
});

test("bot-add request: send-ul mesajului de aprobare esueaza => solicitarea nou-creata e anulata (pull), nu ramane activa (audit, #9)", async () => {
  const updateCalls: Array<Record<string, unknown>> = [];
  const replies: Array<{ content?: string }> = [];
  const handler = buildCommandHandler({
    GuildModel: {
      updateOne: async (_filter: Record<string, unknown>, update: Record<string, unknown>) => { updateCalls.push(update); return {}; },
      findOne: async () => ({ botAddPermissions: [] }),
      findOneAndUpdate: async () => ({ botAddPermissions: [] })
    },
    getGuildSettings: async () => ({ botAddProtectionEnabled: true, botAddAlertChannelId: "chan" })
  });
  const interaction = {
    isButton: () => false,
    isChatInputCommand: () => true,
    commandName: "bot-add-request",
    options: { getString: () => "222222222222222222" },
    guild: {
      id: "guild-1",
      ownerId: "owner-1",
      channels: { fetch: async () => ({ send: async () => { throw new Error("missing permissions"); } }) },
      members: { fetch: async () => null }
    },
    user: { id: "user-1" },
    reply: async (payload: unknown) => { replies.push(payload as { content?: string }); return payload; }
  };
  await handler.handle(interaction, []);
  assert.ok(updateCalls.some(update => Object.prototype.hasOwnProperty.call(update, "$pull")), "solicitarea nelivrata e eliminata (pull) ca sa nu ramana orfana");
  assert.match(replies[0]?.content ?? "", /anulata/);
});

test("bot-add request: daca livrarea SI anularea pending-ului esueaza, userul NU e informat ca solicitarea a fost anulata (audit 154 #7)", async () => {
  const replies: Array<{ content?: string }> = [];
  const handler = buildCommandHandler({
    GuildModel: {
      updateOne: async (_filter: Record<string, unknown>, update: Record<string, unknown>) => {
        if (Object.prototype.hasOwnProperty.call(update, "$pull")) throw new Error("cancel failed");
        return {};
      },
      findOne: async () => ({ botAddPermissions: [] }),
      findOneAndUpdate: async () => ({ botAddPermissions: [] })
    },
    getGuildSettings: async () => ({ botAddProtectionEnabled: true, botAddAlertChannelId: "chan" })
  });
  const interaction = {
    isButton: () => false,
    isChatInputCommand: () => true,
    commandName: "bot-add-request",
    options: { getString: () => "222222222222222222" },
    guild: {
      id: "guild-1",
      ownerId: "owner-1",
      channels: { fetch: async () => ({ send: async () => { throw new Error("missing permissions"); } }) },
      members: { fetch: async () => null }
    },
    user: { id: "user-1" },
    reply: async (payload: unknown) => { replies.push(payload as { content?: string }); return payload; }
  };
  await handler.handle(interaction, []);
  assert.match(replies[0]?.content ?? "", /asteapta expirarea|nu am putut anula/, "cand anularea esueaza userul e indrumat, nu mintit");
  assert.doesNotMatch(replies[0]?.content ?? "", /solicitarea a fost anulata\. Reincearca/);
});
