import test from "node:test";
import assert from "node:assert/strict";

import securityInteractionHandler from "../../features/command-handlers/securityInteractionHandler.js";

test("activarea alertelor de conturi noi revine la false daca scanarea initiala esueaza", async () => {
  const writes: Array<Record<string, unknown> | readonly Record<string, unknown>[]> = [];
  const responses: unknown[] = [];
  const handler = securityInteractionHandler.buildCommandHandler({
    GuildModel: {
      updateOne: async (_filter, update) => {
        writes.push(update);
        return { modifiedCount: 1 };
      }
    },
    getGuildSettings: async () => ({
      newAccountAlertChannelId: "security",
      newAccountAlertsEnabled: false
    }),
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload) => {
      responses.push(payload);
      return payload;
    },
    checkChannelPermissions: async () => ({
      viewChannel: true,
      sendMessages: true,
      embedLinks: true
    }),
    formatUserError: (_err, fallback) => fallback
  });
  const interaction = {
    commandName: "start",
    guild: {
      id: "guild-1",
      members: {
        fetch: async () => {
          throw new Error("member scan failed");
        }
      },
      channels: {
        fetch: async () => ({ send: async () => undefined })
      }
    },
    options: {
      getSubcommand: () => "new-account-alerts",
      getInteger: () => null,
      getString: () => null,
      getChannel: () => null
    },
    isChatInputCommand: () => true
  };

  await assert.rejects(async () => {
    await handler.handle(interaction, []);
  });

  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0], { $set: { newAccountAlertsEnabled: true } });
  assert.deepEqual(writes[1], { $set: { newAccountAlertsEnabled: false } });
  assert.equal(responses.length, 0);
});

test("purge explica limita Discord de 14 zile si cate mesaje au fost omise", async () => {
  const responses: Array<{ content?: string }> = [];
  const handler = securityInteractionHandler.buildCommandHandler({
    GuildModel: { updateOne: async () => ({ modifiedCount: 1 }) },
    getGuildSettings: async () => null,
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload: unknown) => {
      responses.push(payload as { content?: string });
      return payload;
    },
    checkChannelPermissions: async () => null,
    formatUserError: (_err, fallback) => fallback
  });
  const interaction = {
    commandName: "purge-amount",
    guild: { id: "guild-1" },
    channel: {
      bulkDelete: async () => new Map([["one", true], ["two", true]])
    },
    options: {
      getSubcommand: () => "",
      getInteger: () => 5,
      getString: () => null,
      getChannel: () => null
    },
    isChatInputCommand: () => true
  };

  await handler.handle(interaction, []);

  assert.match(responses[0].content ?? "", /14 zile/);
  assert.match(responses[0].content ?? "", /3 mesaje/);
});

test("lock-channel restaureaza permisiunea Discord daca persistenta esueaza", async () => {
  const edits: Array<boolean | null> = [];
  const responses: unknown[] = [];
  const channel = {
    id: "channel-1",
    permissionOverwrites: {
      cache: {
        get: () => ({
          allow: { has: (permission: string) => permission === "SendMessages" },
          deny: { has: () => false }
        })
      },
      edit: async (_target: object, permissions: Record<string, boolean | null>) => {
        edits.push(permissions.SendMessages);
      }
    },
    send: async () => undefined
  };
  const handler = securityInteractionHandler.buildCommandHandler({
    GuildModel: {
      updateOne: async () => {
        throw new Error("mongo unavailable");
      }
    },
    getGuildSettings: async () => ({ lockedChannelIds: [], lockedChannelPermissions: [] }),
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload) => {
      responses.push(payload);
      return payload;
    },
    checkChannelPermissions: async () => null,
    formatUserError: (_err, fallback) => fallback
  });
  const interaction = {
    commandName: "lock-channel",
    guild: {
      id: "guild-1",
      roles: { everyone: { id: "everyone" } }
    },
    user: { id: "admin-1" },
    options: {
      getSubcommand: () => "",
      getInteger: () => null,
      getString: () => "mentenanta",
      getChannel: () => channel,
      getAttachment: () => null
    },
    isChatInputCommand: () => true
  };

  await handler.handle(interaction, []);

  assert.deepEqual(edits, [false, true]);
  assert.match(JSON.stringify(responses[0]), /Eroare la modificarea permisiunilor/);
});

test("setarea unui canal de alerta este refuzata daca lipseste o permisiune obligatorie", async () => {
  let writes = 0;
  const responses: unknown[] = [];
  const handler = securityInteractionHandler.buildCommandHandler({
    GuildModel: {
      updateOne: async () => {
        writes++;
        return { modifiedCount: 1 };
      }
    },
    getGuildSettings: async () => null,
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload) => {
      responses.push(payload);
      return payload;
    },
    checkChannelPermissions: async () => ({
      viewChannel: true,
      sendMessages: true,
      embedLinks: false
    }),
    formatUserError: (_err, fallback) => fallback
  });
  const interaction = {
    commandName: "set",
    guild: { id: "guild-1" },
    options: {
      getSubcommand: () => "threat-alert-channel",
      getInteger: () => null,
      getString: () => null,
      getChannel: () => ({ id: "channel-1" })
    },
    isChatInputCommand: () => true
  };

  await handler.handle(interaction, []);

  assert.equal(writes, 0);
  assert.match(JSON.stringify(responses[0]), /Embed Links/);
});

test("/start bot-add-protection refuza activarea cand botului ii lipsesc View Audit Log / Kick Members / pozitia ierarhica (audit, #25)", async () => {
  const writes: Array<Record<string, unknown>> = [];
  const responses: string[] = [];
  const handler = securityInteractionHandler.buildCommandHandler({
    GuildModel: { updateOne: async (_filter, update: Record<string, unknown>) => { writes.push(update); return { modifiedCount: 1 }; } },
    getGuildSettings: async () => ({ botAddProtectionEnabled: false, botAddAlertChannelId: "security" }),
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload: unknown) => { responses.push((payload as { content?: string }).content ?? ""); return payload; },
    checkChannelPermissions: async () => ({ viewChannel: true, sendMessages: true, embedLinks: true }),
    formatUserError: (_err, fallback) => fallback
  });
  const interaction = {
    commandName: "start",
    guild: {
      id: "guild-1",
      members: { me: { permissions: { has: () => false }, roles: { highest: { position: 0 } } }, fetch: async () => ({ values: () => [][Symbol.iterator]() }) },
      channels: { fetch: async () => ({ send: async () => undefined }) }
    },
    options: { getSubcommand: () => "bot-add-protection", getInteger: () => null, getString: () => null, getChannel: () => null },
    isChatInputCommand: () => true
  };

  await handler.handle(interaction, []);

  assert.equal(writes.length, 0, "protectia NU e activata cand lipsesc conditiile");
  assert.match(responses[0], /View Audit Log/);
  assert.match(responses[0], /Kick Members/);
  assert.match(responses[0], /ierarhie|@everyone/);
});

test("/start bot-add-protection porneste cand botul are toate permisiunile si pozitia (audit, #25)", async () => {
  const writes: Array<Record<string, unknown>> = [];
  const handler = securityInteractionHandler.buildCommandHandler({
    GuildModel: { updateOne: async (_filter, update: Record<string, unknown>) => { writes.push(update); return { modifiedCount: 1 }; } },
    getGuildSettings: async () => ({ botAddProtectionEnabled: false, botAddAlertChannelId: "security" }),
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload) => payload,
    checkChannelPermissions: async () => ({ viewChannel: true, sendMessages: true, embedLinks: true }),
    formatUserError: (_err, fallback) => fallback
  });
  const interaction = {
    commandName: "start",
    guild: {
      id: "guild-1",
      members: { me: { permissions: { has: () => true }, roles: { highest: { position: 5 } } }, fetch: async () => ({ values: () => [][Symbol.iterator]() }) },
      channels: { fetch: async () => ({ send: async () => undefined }) }
    },
    options: { getSubcommand: () => "bot-add-protection", getInteger: () => null, getString: () => null, getChannel: () => null },
    isChatInputCommand: () => true
  };

  await handler.handle(interaction, []);

  assert.deepEqual(writes[0], { $set: { botAddProtectionEnabled: true } });
});
