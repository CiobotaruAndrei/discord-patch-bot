import test from "node:test";
import assert from "node:assert/strict";

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
  const deps = {
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
  return { handler, commandHandler, edits, alerts, updateCalls, invalidated, getStored: () => stored, getScoped: () => scoped };
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
  assert.equal(harness.getScoped()["start:updates"]?.roleId, "role-admin");
  assert.equal(harness.getScoped()["start:updates"]?.mode, "role-or-higher");
  assert.deepEqual(harness.invalidated, ["guild-1"]);
  assert.match(String(harness.edits[0]), /start updates/);
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
  const harness = makeHarness(globalRule, { "start:updates": scopedRule });

  await harness.handler.handleAdminCommandAccess(interaction("admin-command-access", "list", true, "/start updates"));
  await harness.handler.handleAdminCommandAccess(interaction("admin-command-access", "list", true, "/stop updates"));

  assert.match(String(harness.edits[0]), /start updates/);
  assert.match(String(harness.edits[0]), /role-start/);
  assert.match(String(harness.edits[1]), /fallback-ul global/);
  assert.match(String(harness.edits[1]), /role-global/);
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
  const harness = makeHarness(globalRule, { "start:updates": scopedRule });

  await harness.handler.handleAdminCommandAccess(interaction("delete", "admin-command-access", true, "/start updates"));

  assert.equal(harness.getStored()?.roleId, "role-global");
  assert.equal("start:updates" in harness.getScoped(), false);
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
