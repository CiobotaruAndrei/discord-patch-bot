import test from "node:test";
import assert from "node:assert/strict";
import { AuditLogEvent, PermissionFlagsBits } from "discord.js";

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
    roles: {
      cache: new Map([["role-bot", {
        id: "role-bot",
        position: 1,
        permissions: { has: (flag: bigint) => flag === PermissionFlagsBits.Administrator }
      }]])
    },
    kick: async reason => { kicks.push(reason ?? ""); }
  });

  assert.equal(kicks.length, 1);
  assert.equal(metrics.securityBotAddsBlocked, 1);
  assert.equal(audits[0].action, "bot-add-blocked");
  assert.equal(sent.length, 3, "botul periculos produce 3 mesaje cu tag owner: eliminare + clasificare + actiune");
  assert.match(sent[0].content ?? "", /Bot neaprobat eliminat/);
  assert.match(sent[1].content ?? "", /risc ridicat/);
  assert.match(sent[1].content ?? "", /permisiune Administrator \(\+3\)/);
  assert.match(sent[1].content ?? "", /scor 6/);
  assert.match(sent[2].content ?? "", /Actiune recomandata pentru bot cu risc ridicat/);
  assert.ok(sent.every(message => (message.content ?? "").includes("<@owner-1>")), "toate cele 3 mesaje il mentioneaza pe owner");
});

test("ownerul serverului poate adauga un bot direct, fara aprobare one-time (fara kick)", async () => {
  const sent: Array<{ content?: string }> = [];
  const audits: GuildAuditLogRecord[] = [];
  const kicks: string[] = [];
  let consumeAttempts = 0;
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
    GuildModel: {
      findOne: async () => ({ botAddPermissions: [] }),
      findOneAndUpdate: async () => { consumeAttempts++; return null; },
      updateOne: async () => ({ modifiedCount: 1 })
    },
    GuildAuditLogModel: auditModel(audits),
    metrics,
    now: () => now
  });

  await runtime.handleGuildMemberAdd({
    guild: {
      id: "guild-1",
      ownerId: "owner-1",
      fetchAuditLogs: async () => ({
        entries: new Map([["entry", {
          target: { id: "bot-1" },
          executor: { id: "owner-1" },
          createdTimestamp: now
        }]])
      })
    },
    user: {
      id: "bot-1",
      tag: "owner-added-bot",
      bot: true,
      createdTimestamp: now - 3_600_000
    },
    roles: {
      cache: new Map([["role-bot", {
        id: "role-bot",
        position: 1,
        permissions: { has: (flag: bigint) => flag === PermissionFlagsBits.Administrator }
      }]])
    },
    kick: async reason => { kicks.push(reason ?? ""); }
  });

  assert.equal(kicks.length, 0, "botul adaugat de owner NU este eliminat");
  assert.equal(metrics.securityBotAddsBlocked, 0, "metricul de blocari nu creste pentru owner");
  assert.equal(consumeAttempts, 0, "ownerul nu consuma nicio aprobare one-time");
  assert.equal(audits[0].action, "bot-add-owner-direct");
  assert.equal(sent.length, 3, "botul periculos adaugat de owner produce 3 mesaje cu tag owner");
  assert.match(sent[0].content ?? "", /adaugat direct de ownerul serverului/);
  assert.match(sent[1].content ?? "", /aprobare valida pentru intrare \(-1\)/, "aprobarea ownerului scade scorul de risc");
  assert.match(sent[2].content ?? "", /Aprobare: owner direct/);
  assert.match(sent[2].content ?? "", /monitorizare owner necesara/, "botul periculos adaugat de owner ramane, cu monitorizare");
});

test("un bot SUSPECT (nu periculos) produce tot 3 mesaje cu tag owner: admitere + clasificare + actiune (raport post-#705, #1)", async () => {
  const sent: Array<{ content?: string }> = [];
  const audits: GuildAuditLogRecord[] = [];
  const now = Date.parse("2026-07-16T12:00:00.000Z");
  const approvedPermission = {
    requestId: "req-1",
    botId: "bot-1",
    requesterId: "requester-1",
    requestedAt: new Date(now - 60_000),
    status: "used",
    usedAt: new Date(now)
  };
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
    GuildModel: {
      findOne: async () => ({ botAddPermissions: [approvedPermission] }),
      findOneAndUpdate: async () => ({ botAddPermissions: [approvedPermission] }),
      updateOne: async () => ({ modifiedCount: 1 })
    },
    GuildAuditLogModel: auditModel(audits),
    now: () => now
  });

  await runtime.handleGuildMemberAdd({
    guild: {
      id: "guild-1",
      ownerId: "owner-1",
      fetchAuditLogs: async () => ({
        entries: new Map([["entry", {
          target: { id: "bot-1" },
          executor: { id: "requester-1" },
          createdTimestamp: now
        }]])
      })
    },
    user: {
      id: "bot-1",
      tag: "suspicious-bot",
      bot: true,
      createdTimestamp: now - 20 * 86_400_000
    },
    roles: {
      cache: new Map([["role-bot", {
        id: "role-bot",
        position: 1,
        permissions: { has: (flag: bigint) => flag === PermissionFlagsBits.ManageChannels }
      }]])
    },
    kick: async () => undefined
  });

  assert.equal(sent.length, 3, "un bot suspect produce tot 3 mesaje cu tag owner, nu doar 2");
  assert.match(sent[0].content ?? "", /Bot aprobat adaugat/);
  assert.match(sent[1].content ?? "", /Bot suspect detectat/);
  assert.match(sent[2].content ?? "", /Actiune recomandata pentru bot suspect/);
  assert.doesNotMatch(sent[1].content ?? "", /risc ridicat/, "un bot suspect nu e etichetat drept risc ridicat");
  assert.ok(sent.every(message => (message.content ?? "").includes("<@owner-1>")), "toate cele 3 mesaje il mentioneaza pe owner");
});

test("Audit Log intarziat: solicitantul e gasit la reincercare, botul aprobat nu e eliminat", async () => {
  const sent: Array<{ content?: string }> = [];
  const audits: GuildAuditLogRecord[] = [];
  const kicks: string[] = [];
  const waits: number[] = [];
  let fetchCalls = 0;
  const now = Date.parse("2026-07-16T12:00:00.000Z");
  const approvedPermission = {
    requestId: "req-1",
    botId: "bot-1",
    requesterId: "requester-1",
    requestedAt: new Date(now - 60_000),
    status: "used",
    usedAt: new Date(now)
  };
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
    GuildModel: {
      findOne: async () => ({ botAddPermissions: [approvedPermission] }),
      findOneAndUpdate: async () => ({ botAddPermissions: [approvedPermission] }),
      updateOne: async () => ({ modifiedCount: 1 })
    },
    GuildAuditLogModel: auditModel(audits),
    now: () => now,
    wait: async ms => { waits.push(ms); }
  });

  await runtime.handleGuildMemberAdd({
    guild: {
      id: "guild-1",
      ownerId: "owner-1",
      fetchAuditLogs: async () => {
        fetchCalls++;
        if (fetchCalls < 2) return { entries: new Map() };
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
      tag: "slow-audit-bot",
      bot: true,
      createdTimestamp: now - 90 * 86_400_000
    },
    kick: async reason => { kicks.push(reason ?? ""); }
  });

  assert.equal(fetchCalls, 2, "Audit Log-ul e recitit dupa prima incercare esuata");
  assert.deepEqual(waits, [2_000], "reincercarea e scurta si controlata");
  assert.equal(kicks.length, 0, "botul aprobat gasit la retry nu este eliminat");
  assert.equal(audits[0].action, "bot-add-approved-used");
  assert.match(sent[0].content ?? "", /Bot aprobat adaugat/);
});

test("solicitant nedetectat dupa toate reincercarile Audit Log => botul e eliminat, cu mesaj explicit", async () => {
  const sent: Array<{ content?: string }> = [];
  const audits: GuildAuditLogRecord[] = [];
  const kicks: string[] = [];
  const waits: number[] = [];
  let fetchCalls = 0;
  const now = Date.parse("2026-07-16T12:00:00.000Z");
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
    now: () => now,
    wait: async ms => { waits.push(ms); }
  });

  await runtime.handleGuildMemberAdd({
    guild: {
      id: "guild-1",
      ownerId: "owner-1",
      fetchAuditLogs: async () => { fetchCalls++; return { entries: new Map() }; }
    },
    user: {
      id: "bot-1",
      tag: "ghost-bot",
      bot: true,
      createdTimestamp: now - 90 * 86_400_000
    },
    kick: async reason => { kicks.push(reason ?? ""); }
  });

  assert.equal(fetchCalls, 3, "toate reincercarile Audit Log sunt epuizate inainte de eliminare");
  assert.deepEqual(waits, [2_000, 5_000]);
  assert.equal(kicks.length, 1, "fara solicitant detectat, botul e eliminat");
  assert.match(sent[0].content ?? "", /nedetectat dupa reincercari/);
});

function threatRuntime(input: {
  sent: Array<{ content?: string }>;
  settings?: Record<string, unknown>;
  httpReq?: () => Promise<{ data: Buffer; headers: Record<string, string>; status: number }>;
}) {
  return createSecurityRuntime({
    getGuildSettings: async () => ({
      _id: "guild-1",
      threatProtectionEnabled: true,
      threatAlertChannelId: "security",
      ...input.settings
    }),
    client: {
      channels: {
        fetch: async () => ({
          send: async (payload: { content?: string }) => { input.sent.push(payload); }
        })
      }
    },
    GuildModel: emptyGuildModel(),
    GuildAuditLogModel: auditModel([]),
    httpReq: input.httpReq ?? (async () => { throw new Error("inspection unavailable"); })
  });
}

const threatMessageBase = {
  guild: { id: "guild-1" },
  author: { id: "user-1", tag: "user", bot: false },
  channel: { id: "general" },
  attachments: new Map()
};

test("implicit: incalcarile de politica si resursele neconfirmate NU se sterg — doar alerta cu categoria corecta", async () => {
  const sent: Array<{ content?: string }> = [];
  let deleted = 0;
  const runtime = threatRuntime({ sent });

  await runtime.handleMessageCreate({
    ...threatMessageBase,
    content: "@everyone danger",
    delete: async () => { deleted++; }
  });
  await runtime.handleMessageCreate({
    ...threatMessageBase,
    content: "https://example.test/unavailable",
    delete: async () => { deleted++; }
  });

  assert.equal(deleted, 0, "fara politica explicita, nimic nu se sterge automat");
  assert.equal(sent.length, 2);
  assert.match(sent[0].content ?? "", /policy-violation/);
  assert.match(sent[0].content ?? "", /incalcare de politica a serverului, nu amenintare informatica/);
  assert.match(sent[0].content ?? "", /mesaj pastrat/);
  assert.match(sent[1].content ?? "", /mesaj pastrat/);
  assert.doesNotMatch(sent[1].content ?? "", /example\.test/);
});

test("implicit: un executabil detectat prin continut e tip riscant — alerta fara stergere, nu malware confirmat", async () => {
  const sent: Array<{ content?: string }> = [];
  let deleted = 0;
  const runtime = threatRuntime({
    sent,
    httpReq: async () => ({
      data: Buffer.from([0x4d, 0x5a, 0x90, 0x00]),
      headers: { "content-type": "application/octet-stream" },
      status: 200
    })
  });

  await runtime.handleMessageCreate({
    ...threatMessageBase,
    content: "",
    attachments: new Map([["a", { id: "a", name: "installer", url: "https://cdn.example.test/file" }]]),
    delete: async () => { deleted++; }
  });

  assert.equal(deleted, 0, "un instalator legitim nu mai e sters ca malware confirmat");
  assert.match(sent[0].content ?? "", /risky-file/);
  assert.match(sent[0].content ?? "", /neconfirmata ca malware/);
  assert.match(sent[0].content ?? "", /mesaj pastrat/);
});

test("un mesaj cu incalcare de politica SI fisier riscant e sters cand oricare categorie detectata are opt-in, nu doar verdictul cel mai sever (raport post-#705, #3)", async () => {
  const sent: Array<{ content?: string }> = [];
  let deleted = 0;
  const runtime = threatRuntime({
    sent,
    settings: { threatAutoDeletePolicyViolations: true },
    httpReq: async () => ({
      data: Buffer.from([0x4d, 0x5a, 0x90, 0x00]),
      headers: { "content-type": "application/octet-stream" },
      status: 200
    })
  });

  await runtime.handleMessageCreate({
    ...threatMessageBase,
    content: "@everyone uite fisierul",
    attachments: new Map([["a", { id: "a", name: "installer", url: "https://cdn.example.test/file" }]]),
    delete: async () => { deleted++; }
  });

  assert.equal(deleted, 1, "incalcarea de politica detectata are opt-in => mesajul se sterge, desi verdictul cel mai sever e risky-file fara opt-in");
  assert.match(sent[0].content ?? "", /risky-file/, "alerta raporteaza verdictul cel mai sever");
  assert.match(sent[0].content ?? "", /mentionare in masa/, "motivul incalcarii de politica e pastrat in alerta");
});

test("politica explicita a serverului activeaza stergerea pentru fisiere riscante si incalcari de politica", async () => {
  const sent: Array<{ content?: string }> = [];
  let deleted = 0;
  const policyRuntime = threatRuntime({
    sent,
    settings: { threatAutoDeletePolicyViolations: true }
  });
  await policyRuntime.handleMessageCreate({
    ...threatMessageBase,
    content: "@everyone danger",
    delete: async () => { deleted++; }
  });
  assert.equal(deleted, 1, "cu opt-in explicit, incalcarea de politica se sterge");
  assert.match(sent[0].content ?? "", /sters conform politicii explicite a serverului/);

  const riskyRuntime = threatRuntime({
    sent,
    settings: { threatAutoDeleteRiskyFiles: true },
    httpReq: async () => ({
      data: Buffer.from([0x4d, 0x5a, 0x90, 0x00]),
      headers: { "content-type": "application/octet-stream" },
      status: 200
    })
  });
  await riskyRuntime.handleMessageCreate({
    ...threatMessageBase,
    content: "",
    attachments: new Map([["a", { id: "a", name: "installer", url: "https://cdn.example.test/file" }]]),
    delete: async () => { deleted++; }
  });
  assert.equal(deleted, 2, "cu opt-in explicit, fisierul riscant se sterge");
  assert.match(sent[1].content ?? "", /sters conform politicii explicite a serverului/);
});

test("wiring end-to-end: un motor de reputatie care raporteaza malware duce la verdict confirmed si stergerea mesajului (audit, #21)", async () => {
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
    httpReq: async () => ({ data: Buffer.from([0x4d, 0x5a, 0x90, 0x00]), headers: { "content-type": "application/octet-stream" }, status: 200 }),
    reputationScan: async () => "malware"
  });

  await runtime.handleMessageCreate({
    guild: { id: "guild-1" },
    author: { id: "user-1", tag: "user", bot: false },
    channel: { id: "general" },
    content: "",
    attachments: new Map([["a", { id: "a", name: "installer", url: "https://cdn.example.test/file" }]]),
    delete: async () => { deleted++; }
  });

  assert.equal(deleted, 1, "verdictul confirmed de motorul de reputatie declanseaza stergerea neconditionata");
  assert.match(sent[0].content ?? "", /confirmed/);
});

test("bot neaprobat care NU poate fi eliminat (ierarhie) => incident critic cu tag owner + audit removal-failed, fara throw (audit, #25)", async () => {
  const sent: Array<{ content?: string }> = [];
  const audits: GuildAuditLogRecord[] = [];
  const now = Date.parse("2026-07-16T12:00:00.000Z");
  const metrics = { securityBotAddsBlocked: 0 };
  const runtime = createSecurityRuntime({
    getGuildSettings: async () => ({ _id: "guild-1", botAddProtectionEnabled: true, botAddAlertChannelId: "security" }),
    client: { channels: { fetch: async () => ({ send: async (payload: { content?: string }) => { sent.push(payload); } }) } },
    GuildModel: emptyGuildModel(),
    GuildAuditLogModel: auditModel(audits),
    metrics,
    now: () => now
  });

  await assert.doesNotReject(async () => runtime.handleGuildMemberAdd({
    guild: { id: "guild-1", ownerId: "owner-1", fetchAuditLogs: async () => ({ entries: new Map([["e", { target: { id: "bot-1" }, executor: { id: "requester-1" }, createdTimestamp: now }]]) }) },
    user: { id: "bot-1", tag: "unremovable-bot", bot: true, createdTimestamp: now - 3_600_000 },
    kick: async () => { throw new Error("Missing Permissions / hierarchy"); }
  }));

  assert.equal(metrics.securityBotAddsBlocked, 0, "eliminarea a esuat, deci nu se contorizeaza ca blocare reusita");
  assert.equal(audits[0].action, "bot-add-removal-failed");
  assert.match(sent[0].content ?? "", /INCIDENT CRITIC/);
  assert.match(sent[0].content ?? "", /<@owner-1>/);
});
