import test from "node:test";
import assert from "node:assert/strict";
import { AuditLogEvent } from "discord.js";

import { createSecurityRuntime } from "../../features/command-security/securityRuntime.js";
import type { GuildAuditLogRecord } from "../../features/admin-records/auditLogRepository.js";

function auditModel(records: GuildAuditLogRecord[]) {
  return {
    create: async (record: GuildAuditLogRecord) => {
      records.push(record);
      return record;
    },
    find: () => ({
      sort() { return this; },
      skip() { return this; },
      limit() { return this; },
      lean: async () => []
    })
  };
}

function emptyGuildModel() {
  return {
    findOne: async () => ({ botAddPermissions: [] }),
    findOneAndUpdate: async () => null,
    updateOne: async () => ({ modifiedCount: 1 })
  };
}

test("un bot fara aprobare exacta este eliminat si auditat", async () => {
  const sent: Array<{ content?: string }> = [];
  const audits: GuildAuditLogRecord[] = [];
  const kicks: string[] = [];
  const now = Date.parse("2026-07-16T12:00:00.000Z");
  const metrics = { securityBotAddsBlocked: 0 };
  const runtime = createSecurityRuntime({
    getGuildSettings: async () => ({
      _id: "guild-1",
      botAddProtectionEnabled: true,
      botAddAlertChannelId: "security"
    }),
    client: {
      channels: {
        fetch: async () => ({
          send: async (payload: { content?: string }) => { sent.push(payload); }
        })
      }
    },
    GuildModel: emptyGuildModel(),
    GuildAuditLogModel: auditModel(audits),
    metrics,
    now: () => now
  });

  await runtime.handleGuildMemberAdd({
    guild: {
      id: "guild-1",
      ownerId: "owner-1",
      fetchAuditLogs: async (options: { type: AuditLogEvent }) => {
        assert.equal(options.type, AuditLogEvent.BotAdd);
        return {
          entries: new Map([["entry", {
            target: { id: "bot-1" },
            executor: { id: "requester-1" },
            createdTimestamp: now
          }]])
        };
      }
    },
    user: {
      id: "bot-1",
      tag: "unsafe-bot",
      bot: true,
      createdTimestamp: now - 3_600_000
    },
    kick: async reason => { kicks.push(reason ?? ""); }
  });

  assert.equal(kicks.length, 1);
  assert.equal(metrics.securityBotAddsBlocked, 1);
  assert.equal(audits[0].action, "bot-add-blocked");
  assert.equal(sent.length, 3);
  assert.match(sent[0].content ?? "", /Bot neaprobat eliminat/);
  assert.match(sent[1].content ?? "", /Bot suspect/);
  assert.match(sent[2].content ?? "", /risc ridicat/);
});

test("amenintarile confirmate sunt sterse, iar cele neconfirmate sunt doar alertate", async () => {
  const sent: Array<{ content?: string }> = [];
  let deleted = 0;
  const runtime = createSecurityRuntime({
    getGuildSettings: async () => ({
      _id: "guild-1",
      threatProtectionEnabled: true,
      threatAlertChannelId: "security"
    }),
    client: {
      channels: {
        fetch: async () => ({
          send: async (payload: { content?: string }) => { sent.push(payload); }
        })
      }
    },
    GuildModel: emptyGuildModel(),
    GuildAuditLogModel: auditModel([]),
    httpReq: async () => {
      throw new Error("inspection unavailable");
    }
  });
  const base = {
    guild: { id: "guild-1" },
    author: { id: "user-1", tag: "user", bot: false },
    channel: { id: "general" },
    attachments: new Map()
  };

  await runtime.handleMessageCreate({
    ...base,
    content: "@everyone danger",
    delete: async () => { deleted++; }
  });
  await runtime.handleMessageCreate({
    ...base,
    content: "https://example.test/unavailable",
    delete: async () => { deleted++; }
  });

  assert.equal(deleted, 1);
  assert.equal(sent.length, 2);
  assert.match(sent[0].content ?? "", /mesaj sters/);
  assert.match(sent[1].content ?? "", /mesaj pastrat/);
  assert.doesNotMatch(sent[1].content ?? "", /example\.test/);
});
