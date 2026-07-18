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
  assert.match(line, /status rejected/);
  assert.match(line, /cerut </);
  assert.match(line, /de <@owner-1>/);
});

test("respingerea unei solicitari bot-add notifica solicitantul (mentiune + allowedMentions) (audit, #29)", async () => {
  const updates: Array<{ content?: string; allowedMentions?: { users?: string[] } }> = [];
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
    guild: { id: "guild-1", ownerId: "owner-1" },
    user: { id: "owner-1" },
    reply: async () => undefined,
    update: async (payload: unknown) => { updates.push(payload as { content?: string; allowedMentions?: { users?: string[] } }); return payload; }
  };
  await handler.handle(interaction, []);

  assert.equal(updates.length, 1, "raspunsul editeaza mesajul de aprobare");
  assert.match(updates[0].content ?? "", /Respinsa/);
  assert.match(updates[0].content ?? "", /<@user-9>/);
  assert.match(updates[0].content ?? "", /respinsa de owner/);
  assert.deepEqual(updates[0].allowedMentions?.users, ["user-9"], "solicitantul e mentionat efectiv");
});
