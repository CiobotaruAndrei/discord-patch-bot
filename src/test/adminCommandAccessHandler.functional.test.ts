import test from "node:test";
import assert from "node:assert/strict";
import type { GuildAuditLogRecord } from "../features/admin-records/auditLogRepository";

const attachAdminCommandAccess = require("../features/command-handlers/adminCommandAccessHandler") as typeof import("../features/command-handlers/adminCommandAccessHandler");
const globalAccessCode = require("../features/command-security/globalAccessCode") as typeof import("../features/command-security/globalAccessCode");

type StoredAccess = {
  mode: "role" | "role-or-higher";
  roleId: string;
  updatedBy: string;
  updatedAt: Date;
} | null;

type TestInteraction = {
  commandName: string;
  guild: { id: string; ownerId: string };
  user: { id: string };
  deferred: boolean;
  replied: boolean;
  globalAccessCodeAuthorized?: boolean;
  isChatInputCommand: () => boolean;
  options: {
    getSubcommand: () => string;
    getRole: () => { id: string; name: string };
    getString: (name?: string) => string | null;
    getBoolean: () => boolean;
  };
  reply: (payload?: unknown) => Promise<void>;
  followUp: (payload?: unknown) => Promise<void>;
};

function makeHarness(initial: StoredAccess = null, scopedInitial: Record<string, StoredAccess> = {}) {
  let stored = initial;
  const scoped: Record<string, StoredAccess> = { ...scopedInitial };
  const edits: unknown[] = [];
  const alerts: string[] = [];
  const updateCalls: Array<{ filter: object; update: object; options?: object }> = [];
  const invalidated: string[] = [];
  const auditDocs: GuildAuditLogRecord[] = [];
  const makeChain = () => {
    const chain = {
      sort: () => chain,
      skip: () => chain,
      limit: () => chain,
      lean: async () => []
    };
    return chain;
  };
  const deps = {
    GuildAuditLogModel: {
      create: async (doc: GuildAuditLogRecord) => { auditDocs.push(doc); return doc; },
      find: () => makeChain()
    },
    GuildModel: {
      updateOne: async (filter: object, update: object, options?: object) => {
        updateCalls.push({ filter, update, options });
        const set = (update as { $set?: Record<string, StoredAccess | undefined> }).$set;
        if (set && "adminCommandAccess" in set) stored = set.adminCommandAccess ?? null;
        if (set) {
          for (const [key, value] of Object.entries(set)) {
            if (key.startsWith("adminCommandAccessByCommand.")) scoped[key.slice("adminCommandAccessByCommand.".length)] = value ?? null;
          }
        }
        const unset = (update as { $unset?: Record<string, string> }).$unset;
        if (unset) {
          for (const key of Object.keys(unset)) {
            if (key.startsWith("adminCommandAccessByCommand.")) delete scoped[key.slice("adminCommandAccessByCommand.".length)];
          }
        }
        return { modifiedCount: 1 };
      },
      findOne: () => ({
        lean: async () => ({ adminCommandAccess: stored, adminCommandAccessByCommand: scoped })
      })
    },
    invalidateGuildCache: (guildId: string) => { invalidated.push(guildId); },
    safeDefer: async () => undefined,
    safeEdit: async (_interaction: object, payload: unknown) => { edits.push(payload); return payload; },
    logger: () => undefined,
    MessageFlags: { Ephemeral: 64 },
    adminAlert: async (kind: string) => { alerts.push(kind); }
  };
  const handler = attachAdminCommandAccess.createAdminCommandAccessHandler(deps);
  const commandHandler = attachAdminCommandAccess.buildCommandHandler(deps);
  return { handler, commandHandler, edits, alerts, updateCalls, invalidated, auditDocs, getStored: () => stored, getScoped: () => scoped };
}

function interaction(commandName: string, subcommand: string, owner = true, commandScope: string | null = null): TestInteraction {
  return {
    commandName,
    guild: { id: "guild-1", ownerId: owner ? "user-1" : "owner-1" },
    user: { id: "user-1" },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    options: {
      getSubcommand: () => subcommand,
      getRole: () => ({ id: "role-admin", name: "Moderatori" }),
      getString: (name?: string) => name === "command" ? commandScope : "role-or-higher",
      getBoolean: () => true
    },
    reply: async () => undefined,
    followUp: async () => undefined
  };
}

type ModalCapableInteraction = ReturnType<typeof interaction> & {
  showModal?: (modal: unknown) => Promise<void>;
  awaitModalSubmit?: (options: { filter: (submit: ModalSubmit) => boolean; time: number }) => Promise<ModalSubmit>;
};

type ModalSubmit = {
  customId: string;
  user: { id: string };
  deferred: boolean;
  replied: boolean;
  fields: { getTextInputValue: (customId: string) => string };
  reply: (payload: unknown) => Promise<void>;
  followUp: (payload: unknown) => Promise<void>;
  deferReply: () => Promise<void>;
  editReply: (payload: unknown) => Promise<void>;
};

function modalCustomId(modal: unknown): string {
  const json = (modal as { toJSON?: () => { custom_id?: string } }).toJSON?.();
  return String(json?.custom_id || "");
}

function attachAccessCodeModal(interaction: ModalCapableInteraction, code: string, replies: unknown[], edits: unknown[]): void {
  let customId = "";
  interaction.showModal = async modal => { customId = modalCustomId(modal); };
  interaction.awaitModalSubmit = async options => {
    const submit: ModalSubmit = {
      customId,
      user: { id: interaction.user?.id || "" },
      deferred: false,
      replied: false,
      fields: { getTextInputValue: () => code },
      reply: async payload => { submit.replied = true; replies.push(payload); },
      followUp: async payload => { replies.push(payload); },
      deferReply: async () => { submit.deferred = true; },
      editReply: async payload => { edits.push(payload); }
    };
    assert.equal(options.filter(submit), true);
    return submit;
  };
}

test("/set admin-command-access salveaza rolul si modul configurat de owner", async () => {
  const harness = makeHarness();

  await harness.handler.handleAdminCommandAccess(interaction("set", "admin-command-access"));

  assert.equal(harness.getStored()?.roleId, "role-admin");
  assert.equal(harness.getStored()?.mode, "role-or-higher");
  assert.deepEqual(harness.invalidated, ["guild-1"]);
  assert.match(String(harness.edits[0]), /role-admin/);
});

test("/set admin-command-access cu command salveaza regula doar pentru acea comanda admin", async () => {
  const harness = makeHarness({ mode: "role", roleId: "role-global", updatedBy: "owner", updatedAt: new Date() });

  await harness.handler.handleAdminCommandAccess(interaction("set", "admin-command-access", true, "/start updates"));

  assert.equal(harness.getStored()?.roleId, "role-global");
  assert.equal(harness.getScoped()["start-stop:updates"]?.roleId, "role-admin");
  assert.equal(harness.getScoped()["start-stop:updates"]?.mode, "role-or-higher");
  assert.deepEqual(harness.invalidated, ["guild-1"]);
  assert.match(String(harness.edits[0]), /start sau \/stop updates/);
});

test("/admin-command-access list semnaleaza conflictul dintre chei vechi start:/stop: cu roluri diferite, nu il ascunde (R[P3] #3)", async () => {
  const roleA = { mode: "role" as const, roleId: "role-a", updatedBy: "o", updatedAt: new Date() };
  const roleB = { mode: "role-or-higher" as const, roleId: "role-b", updatedBy: "o", updatedAt: new Date() };
  const harness = makeHarness(null, { "start:updates": roleA, "stop:updates": roleB });

  await harness.handler.handleAdminCommandAccess(interaction("admin-command-access", "list"));

  const out = String(harness.edits[0]);
  assert.match(out, /Reguli in conflict/, "listarea nu mai ascunde conflictul, il raporteaza");
  assert.match(out, /start:updates/);
  assert.match(out, /stop:updates/);
});

test("/set admin-command-access canonicalizeaza: seteaza cheia start-stop si curata cheile vechi start:/stop: (R[P3] #3)", async () => {
  const roleA = { mode: "role" as const, roleId: "role-a", updatedBy: "o", updatedAt: new Date() };
  const roleB = { mode: "role" as const, roleId: "role-b", updatedBy: "o", updatedAt: new Date() };
  const harness = makeHarness(null, { "start:updates": roleA, "stop:updates": roleB });

  await harness.handler.handleAdminCommandAccess(interaction("set", "admin-command-access", true, "/start updates"));

  const scoped = harness.getScoped();
  assert.equal(scoped["start-stop:updates"]?.roleId, "role-admin", "regula noua e scrisa sub cheia canonica");
  assert.equal("start:updates" in scoped, false, "cheia veche start: e curatata (nu mai poate genera conflict ascuns)");
  assert.equal("stop:updates" in scoped, false, "cheia veche stop: e curatata");
});

test("/set admin-command-access respinge o comanda publica (nu se aplica niciodata) fara sa salveze regula (R[P2] #2)", async () => {
  const harness = makeHarness();

  await harness.handler.handleAdminCommandAccess(interaction("set", "admin-command-access", true, "/ping"));

  assert.equal(harness.updateCalls.length, 0, "nu se scrie nicio regula pentru o comanda care nu e admin");
  assert.equal("ping" in harness.getScoped(), false);
  assert.deepEqual(harness.invalidated, []);
  assert.match(String(harness.edits[0]), /nu este o comanda admin/);
});

test("/set admin-command-access respinge un typo de comanda admin (bakup load) (R[P2] #2)", async () => {
  const harness = makeHarness();

  await harness.handler.handleAdminCommandAccess(interaction("set", "admin-command-access", true, "bakup load"));

  assert.equal(harness.updateCalls.length, 0, "un scope inexistent (typo) e respins, nu salvat ca regula silentioasa");
  assert.equal("bakup:load" in harness.getScoped(), false);
  assert.match(String(harness.edits[0]), /nu este o comanda admin/);
});

test("/set admin-command-access accepta o comanda admin reala cu subcomanda (backup load) (R[P2] #2)", async () => {
  const harness = makeHarness();

  await harness.handler.handleAdminCommandAccess(interaction("set", "admin-command-access", true, "/backup load"));

  assert.equal(harness.getScoped()["backup:load"]?.roleId, "role-admin", "un scope admin real e salvat");
  assert.deepEqual(harness.invalidated, ["guild-1"]);
});

test("/admin-command-access list explica accesul implicit cand nu exista regula", async () => {
  const harness = makeHarness();

  await harness.handler.handleAdminCommandAccess(interaction("admin-command-access", "list"));

  assert.match(String(harness.edits[0]), /implicit/);
  assert.match(String(harness.edits[0]), /Administrator/);
});

test("/admin-command-access list pentru command arata regula dedicata sau fallback global", async () => {
  const globalRule = { mode: "role" as const, roleId: "role-global", updatedBy: "owner", updatedAt: new Date() };
  const scopedRule = { mode: "role-or-higher" as const, roleId: "role-start", updatedBy: "owner", updatedAt: new Date() };
  const harness = makeHarness(globalRule, { "start-stop:updates": scopedRule });

  await harness.handler.handleAdminCommandAccess(interaction("admin-command-access", "list", true, "/start updates"));
  await harness.handler.handleAdminCommandAccess(interaction("admin-command-access", "list", true, "/stop updates"));

  assert.match(String(harness.edits[0]), /start sau \/stop updates/);
  assert.match(String(harness.edits[0]), /role-start/);
  assert.match(String(harness.edits[1]), /start sau \/stop updates/);
  assert.match(String(harness.edits[1]), /role-start/);
});

test("/delete admin-command-access sterge regula configurata", async () => {
  const harness = makeHarness({ mode: "role", roleId: "role-admin", updatedBy: "user-1", updatedAt: new Date() });

  await harness.handler.handleAdminCommandAccess(interaction("delete", "admin-command-access"));

  assert.equal(harness.getStored(), null);
  assert.deepEqual(harness.invalidated, ["guild-1"]);
});

test("/delete admin-command-access cu command sterge doar regula dedicata", async () => {
  const globalRule = { mode: "role" as const, roleId: "role-global", updatedBy: "owner", updatedAt: new Date() };
  const scopedRule = { mode: "role" as const, roleId: "role-start", updatedBy: "owner", updatedAt: new Date() };
  const harness = makeHarness(globalRule, {
    "start-stop:updates": scopedRule,
    "start:updates": scopedRule,
    "stop:updates": scopedRule
  });

  await harness.handler.handleAdminCommandAccess(interaction("delete", "admin-command-access", true, "/start updates"));

  assert.equal(harness.getStored()?.roleId, "role-global");
  assert.equal("start-stop:updates" in harness.getScoped(), false);
  assert.equal("start:updates" in harness.getScoped(), false);
  assert.equal("stop:updates" in harness.getScoped(), false);
  assert.deepEqual(harness.invalidated, ["guild-1"]);
});

test("admin-command-access refuza non-owner fara modal pentru codul global", async () => {
  const harness = makeHarness();
  const replies: unknown[] = [];
  const nonOwner = interaction("set", "admin-command-access", false);
  nonOwner.reply = async payload => { replies.push(payload); };

  await harness.handler.handleAdminCommandAccess(nonOwner);

  assert.equal(harness.updateCalls.length, 0);
  assert.deepEqual(harness.invalidated, []);
  assert.deepEqual(harness.edits, []);
  assert.deepEqual(replies, [{ content: "Access denied.", flags: 64 }]);
});

test("admin-command-access permite non-owner dupa codul global autorizat de guard", async () => {
  const harness = makeHarness();
  const nonOwner = interaction("admin-command-access", "list", false) as ReturnType<typeof interaction> & { globalAccessCodeAuthorized?: boolean };
  nonOwner.globalAccessCodeAuthorized = true;

  await harness.handler.handleAdminCommandAccess(nonOwner);

  assert.match(String(harness.edits[0]), /Acces admin pentru toate comenzile admin: implicit/);
  assert.match(String(harness.edits[0]), /codul global de acces/);
});

test("admin-command-access cere cod global pentru non-owner si salveaza cand codul e corect", async () => {
  const previousHash = process.env.BOT_GLOBAL_ACCESS_CODE_HASH;
  const previousPlain = process.env.BOT_GLOBAL_ACCESS_CODE;
  process.env.BOT_GLOBAL_ACCESS_CODE_HASH = globalAccessCode.sha256Hex("test-access-code-123");
  delete process.env.BOT_GLOBAL_ACCESS_CODE;
  try {
    const harness = makeHarness();
    const nonOwner = interaction("set", "admin-command-access", false) as ModalCapableInteraction;
    const modalReplies: unknown[] = [];
    const modalEdits: unknown[] = [];
    attachAccessCodeModal(nonOwner, "test-access-code-123", modalReplies, modalEdits);

    await harness.handler.handleAdminCommandAccess(nonOwner);

    assert.equal(harness.getStored()?.roleId, "role-admin");
    assert.equal(harness.getStored()?.mode, "role-or-higher");
    assert.deepEqual(modalReplies, [{ content: "Access granted.", flags: 64 }]);
  } finally {
    if (previousHash === undefined) delete process.env.BOT_GLOBAL_ACCESS_CODE_HASH;
    else process.env.BOT_GLOBAL_ACCESS_CODE_HASH = previousHash;
    if (previousPlain === undefined) delete process.env.BOT_GLOBAL_ACCESS_CODE;
    else process.env.BOT_GLOBAL_ACCESS_CODE = previousPlain;
  }
});

test("handlerul admin-command-access nu prinde /delete suggestion", () => {
  const harness = makeHarness();

  assert.equal(harness.commandHandler.canHandle(interaction("delete", "suggestion")), false);
});

test("/set si /delete admin-command-access scriu regula pe guild si auditul admin_access in colectia guildAuditLogs (R6 #7 + #6 audit split)", async () => {
  const setHarness = makeHarness();
  await setHarness.handler.handleAdminCommandAccess(interaction("set", "admin-command-access"));
  assert.equal(setHarness.updateCalls.length, 1, "regula = un singur updateOne pe guild, fara $push de audit");
  assert.equal(JSON.stringify(setHarness.updateCalls[0].update).includes("$push"), false);
  assert.equal(setHarness.auditDocs.length, 1);
  assert.equal(setHarness.auditDocs[0].kind, "server");
  assert.match(String(setHarness.auditDocs[0].action), /admin_access_set/);

  const deleteHarness = makeHarness({ mode: "role", roleId: "role-global", updatedBy: "owner", updatedAt: new Date() });
  await deleteHarness.handler.handleAdminCommandAccess(interaction("delete", "admin-command-access", true));
  assert.equal(deleteHarness.updateCalls.length, 1, "stergerea regulii = un singur updateOne pe guild");
  assert.equal(deleteHarness.auditDocs.length, 1);
  assert.match(String(deleteHarness.auditDocs[0].action), /admin_access_delete/);
});
