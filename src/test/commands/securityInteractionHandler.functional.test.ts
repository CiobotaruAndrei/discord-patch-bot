import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";

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
    send: async () => undefined,
    permissionsFor: () => ({ has: () => true })
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
      roles: { everyone: { id: "everyone" } },
      members: { me: {}, fetch: async () => ({ values: () => [][Symbol.iterator]() }) }
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

test("/lock-channel trimite anuntul de blocare cu send legat de canal, nu detasat (audit #4)", async () => {
  const responses: unknown[] = [];
  const channel = {
    id: "channel-1",
    delivered: [] as unknown[],
    permissionOverwrites: {
      cache: {
        get: () => ({
          allow: { has: (permission: string) => permission === "SendMessages" },
          deny: { has: () => false }
        })
      },
      edit: async () => undefined
    },
    send(payload: unknown): Promise<unknown> {
      this.delivered.push(payload);
      return Promise.resolve(undefined);
    },
    permissionsFor: () => ({ has: () => true })
  };
  const handler = securityInteractionHandler.buildCommandHandler({
    GuildModel: { updateOne: async () => ({ modifiedCount: 1 }) },
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
      roles: { everyone: { id: "everyone" } },
      members: { me: {}, fetch: async () => ({ values: () => [][Symbol.iterator]() }) }
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

  assert.equal(channel.delivered.length, 1, "anuntul de blocare a fost livrat cu this legat de canal");
  assert.match(JSON.stringify(responses[responses.length - 1]), /blocat/);
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

test("/stop bot-add-protection dezactiveaza si anuleaza aprobarile active printr-un singur update atomic", async () => {
  const now = Date.now();
  const updates: Array<{ update: Record<string, unknown>; options?: Record<string, unknown> }> = [];
  const responses: string[] = [];
  const handler = securityInteractionHandler.buildCommandHandler({
    GuildModel: { updateOne: async (_filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>) => { updates.push({ update, options }); return { modifiedCount: 1 }; } },
    getGuildSettings: async () => ({
      botAddProtectionEnabled: true,
      botAddAlertChannelId: "security",
      botAddPermissions: [
        { requestId: "r1", botId: "b1", requesterId: "u1", status: "pending", expiresAt: new Date(now + 60_000) },
        { requestId: "r2", botId: "b2", requesterId: "u2", status: "approved", expiresAt: new Date(now + 60_000) },
        { requestId: "r3", botId: "b3", requesterId: "u3", status: "used", usedAt: new Date(now) },
        { requestId: "r4", botId: "b4", requesterId: "u4", status: "approved", expiresAt: new Date(now - 60_000) }
      ]
    }),
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload: unknown) => { responses.push((payload as { content?: string }).content ?? ""); return payload; },
    checkChannelPermissions: async () => ({ viewChannel: true, sendMessages: true, embedLinks: true }),
    formatUserError: (_err, fallback) => fallback
  });
  const interaction = {
    commandName: "stop",
    guild: { id: "guild-1" },
    options: { getSubcommand: () => "bot-add-protection", getInteger: () => null, getString: () => null, getChannel: () => null },
    isChatInputCommand: () => true
  };

  await handler.handle(interaction, []);

  assert.equal(updates.length, 1);
  assert.ok(Array.isArray(updates[0].update));
  const pipeline = updates[0].update as readonly Record<string, unknown>[];
  const set = pipeline[0].$set as Record<string, unknown>;
  assert.equal(set.botAddProtectionEnabled, false);
  assert.ok("botAddPermissions" in set);
  assert.match(responses[0], /active anulate: 2/, "doar cele 2 neexpirate (pending + approved) sunt raportate, nu cele used/expirate");
});

test("/stop bot-add-protection pastreaza protectia activa daca update-ul atomic esueaza", async () => {
  const responses: string[] = [];
  const handler = securityInteractionHandler.buildCommandHandler({
    GuildModel: { updateOne: async () => { throw new Error("mongo unavailable"); } },
    getGuildSettings: async () => ({ botAddProtectionEnabled: true, botAddAlertChannelId: "security", botAddPermissions: [] }),
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload: unknown) => { responses.push((payload as { content?: string }).content ?? ""); return payload; },
    checkChannelPermissions: async () => ({ viewChannel: true, sendMessages: true, embedLinks: true }),
    formatUserError: (_err, fallback) => fallback
  });
  const interaction = {
    commandName: "stop",
    guild: { id: "guild-1" },
    options: { getSubcommand: () => "bot-add-protection", getInteger: () => null, getString: () => null, getChannel: () => null },
    isChatInputCommand: () => true
  };

  await handler.handle(interaction, []);

  assert.match(responses[0], /NU a fost oprita/);
  assert.match(responses[0], /Starea anterioara a ramas activa/);
});

test("/lock-channel refuza cand botului ii lipsesc permisiunile efective in canal (View Channel / Manage Roles) inainte de a modifica ceva (audit, #18)", async () => {
  const edits: Array<boolean | null> = [];
  const responses: Array<{ content?: string }> = [];
  const channel = {
    id: "channel-1",
    permissionOverwrites: {
      cache: { get: () => ({ allow: { has: () => false }, deny: { has: () => false } }) },
      edit: async (_target: object, permissions: Record<string, boolean | null>) => { edits.push(permissions.SendMessages); }
    },
    permissionsFor: () => ({ has: (flag: bigint) => flag === PermissionFlagsBits.ViewChannel })
  };
  const handler = securityInteractionHandler.buildCommandHandler({
    GuildModel: { updateOne: async () => ({ modifiedCount: 1 }) },
    getGuildSettings: async () => ({ lockedChannelIds: [], lockedChannelPermissions: [] }),
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload: unknown) => { responses.push(payload as { content?: string }); return payload; },
    checkChannelPermissions: async () => null,
    formatUserError: (_err, fallback) => fallback
  });
  const interaction = {
    commandName: "lock-channel",
    guild: { id: "guild-1", roles: { everyone: { id: "everyone" } }, members: { me: {}, fetch: async () => ({ values: () => [][Symbol.iterator]() }) } },
    user: { id: "admin-1" },
    options: { getSubcommand: () => "", getInteger: () => null, getString: () => "mentenanta", getChannel: () => channel, getAttachment: () => null },
    isChatInputCommand: () => true
  };

  await handler.handle(interaction, []);

  assert.equal(edits.length, 0, "nu se modifica nicio permisiune cand botul nu are dreptul efectiv");
  assert.match(responses[0].content ?? "", /Manage Roles/);
  assert.doesNotMatch(responses[0].content ?? "", /View Channel/, "botul ARE View Channel, deci nu apare in lipsa");
});

test("/lock-channel compenseaza Mongo si permisiunea Discord daca mesajul obligatoriu esueaza", async () => {
  const edits: Array<boolean | null> = [];
  const writes: Array<Record<string, unknown> | readonly Record<string, unknown>[]> = [];
  const responses: Array<{ content?: string }> = [];
  const channel = {
    id: "channel-1",
    permissionOverwrites: {
      cache: { get: () => ({ allow: { has: () => true }, deny: { has: () => false } }) },
      edit: async (_target: object, permissions: Record<string, boolean | null>) => { edits.push(permissions.SendMessages); }
    },
    permissionsFor: () => ({ has: () => true }),
    send: async () => { throw new Error("delivery failed"); }
  };
  const handler = securityInteractionHandler.buildCommandHandler({
    GuildModel: { updateOne: async (_filter, update) => { writes.push(update); return { modifiedCount: 1 }; } },
    getGuildSettings: async () => ({ lockedChannelIds: [], lockedChannelPermissions: [] }),
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload: unknown) => { responses.push(payload as { content?: string }); return payload; },
    checkChannelPermissions: async () => null,
    formatUserError: (_error, fallback) => fallback
  });
  const command = {
    commandName: "lock-channel",
    guild: { id: "guild-1", roles: { everyone: { id: "everyone" } }, members: { me: {}, fetch: async () => ({ values: () => [][Symbol.iterator]() }) } },
    user: { id: "admin-1" },
    options: { getSubcommand: () => "", getInteger: () => null, getString: () => "mentenanta", getChannel: () => channel, getAttachment: () => null },
    isChatInputCommand: () => true
  };

  await handler.handle(command, []);

  assert.deepEqual(edits, [false, true]);
  assert.equal(writes.length, 2);
  assert.match(JSON.stringify(writes[0]), /lockedChannelIds/);
  assert.match(JSON.stringify(writes[1]), /\$filter/);
  assert.match(responses[0].content ?? "", /Eroare/);
});

test("/lock-channel: daca revenirea persistentei esueaza in compensare, permisiunea Discord e TOTUSI restaurata si userul afla ca e partial (audit 154 #7)", async () => {
  const edits: Array<boolean | null> = [];
  const responses: Array<{ content?: string }> = [];
  let updateCount = 0;
  const channel = {
    id: "channel-1",
    permissionOverwrites: {
      cache: { get: () => ({ allow: { has: () => true }, deny: { has: () => false } }) },
      edit: async (_target: object, permissions: Record<string, boolean | null>) => { edits.push(permissions.SendMessages); }
    },
    permissionsFor: () => ({ has: () => true }),
    send: async () => { throw new Error("delivery failed"); }
  };
  const handler = securityInteractionHandler.buildCommandHandler({
    GuildModel: { updateOne: async () => { updateCount++; if (updateCount >= 2) throw new Error("mongo revert down"); return { modifiedCount: 1 }; } },
    getGuildSettings: async () => ({ lockedChannelIds: [], lockedChannelPermissions: [] }),
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload: unknown) => { responses.push(payload as { content?: string }); return payload; },
    checkChannelPermissions: async () => null,
    formatUserError: (_error, fallback) => fallback
  });
  const command = {
    commandName: "lock-channel",
    guild: { id: "guild-1", roles: { everyone: { id: "everyone" } }, members: { me: {}, fetch: async () => ({ values: () => [][Symbol.iterator]() }) } },
    user: { id: "admin-1" },
    options: { getSubcommand: () => "", getInteger: () => null, getString: () => "mentenanta", getChannel: () => channel, getAttachment: () => null },
    isChatInputCommand: () => true
  };

  await handler.handle(command, []);

  assert.deepEqual(edits, [false, true], "permisiunea Discord e restaurata (true) chiar daca revenirea persistentei a esuat");
  assert.match(responses.at(-1)?.content ?? "", /partiala|verificare manuala/, "userul afla ca a fost o compensare partiala");
});

test("/purge refuza cand botului ii lipsesc permisiunile efective in canal (Manage Messages / Read Message History) inainte de bulkDelete (audit, #18)", async () => {
  let bulkCalls = 0;
  const responses: Array<{ content?: string }> = [];
  const handler = securityInteractionHandler.buildCommandHandler({
    GuildModel: { updateOne: async () => ({ modifiedCount: 1 }) },
    getGuildSettings: async () => null,
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload: unknown) => { responses.push(payload as { content?: string }); return payload; },
    checkChannelPermissions: async () => null,
    formatUserError: (_err, fallback) => fallback
  });
  const interaction = {
    commandName: "purge-amount",
    guild: { id: "guild-1", members: { me: {}, fetch: async () => ({ values: () => [][Symbol.iterator]() }) } },
    channel: {
      bulkDelete: async () => { bulkCalls++; return new Map(); },
      permissionsFor: () => ({ has: (flag: bigint) => flag === PermissionFlagsBits.ViewChannel })
    },
    options: { getSubcommand: () => "", getInteger: () => 5, getString: () => null, getChannel: () => null },
    isChatInputCommand: () => true
  };

  await handler.handle(interaction, []);

  assert.equal(bulkCalls, 0, "bulkDelete nu e apelat cand lipsesc permisiunile efective");
  assert.match(responses[0].content ?? "", /Manage Messages/);
  assert.match(responses[0].content ?? "", /Read Message History/);
});
