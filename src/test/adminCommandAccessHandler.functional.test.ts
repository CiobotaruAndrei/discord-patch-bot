import test from "node:test";
import assert from "node:assert/strict";

const attachAdminCommandAccess = require("../features/command-handlers/adminCommandAccessHandler") as typeof import("../features/command-handlers/adminCommandAccessHandler");

type StoredAccess = {
  mode: "role" | "role-or-higher";
  roleId: string;
  updatedBy: string;
  updatedAt: Date;
} | null;

function makeHarness(initial: StoredAccess = null) {
  let stored = initial;
  const edits: unknown[] = [];
  const updateCalls: Array<{ filter: object; update: object; options?: object }> = [];
  const invalidated: string[] = [];
  const handler = attachAdminCommandAccess.createAdminCommandAccessHandler({
    GuildModel: {
      updateOne: async (filter: object, update: object, options?: object) => {
        updateCalls.push({ filter, update, options });
        const set = (update as { $set?: { adminCommandAccess?: StoredAccess } }).$set;
        if (set && "adminCommandAccess" in set) stored = set.adminCommandAccess ?? null;
        return { modifiedCount: 1 };
      },
      findOne: () => ({
        lean: async () => ({ adminCommandAccess: stored })
      })
    },
    invalidateGuildCache: (guildId: string) => { invalidated.push(guildId); },
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload) => { edits.push(payload); return payload; },
    logger: () => undefined,
    MessageFlags: { Ephemeral: 64 }
  });
  return { handler, edits, updateCalls, invalidated, getStored: () => stored };
}

function interaction(commandName: string, subcommand: string, owner = true) {
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
      getString: () => "role-or-higher",
      getBoolean: () => true
    },
    reply: async () => undefined,
    followUp: async () => undefined
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

test("/admin-command-access list explica accesul implicit cand nu exista regula", async () => {
  const harness = makeHarness();

  await harness.handler.handleAdminCommandAccess(interaction("admin-command-access", "list"));

  assert.match(String(harness.edits[0]), /implicit/);
  assert.match(String(harness.edits[0]), /Administrator/);
});

test("/delete admin-command-access sterge regula configurata", async () => {
  const harness = makeHarness({ mode: "role", roleId: "role-admin", updatedBy: "user-1", updatedAt: new Date() });

  await harness.handler.handleAdminCommandAccess(interaction("delete", "admin-command-access"));

  assert.equal(harness.getStored(), null);
  assert.deepEqual(harness.invalidated, ["guild-1"]);
});

test("admin-command-access refuza userul care nu este owner", async () => {
  const harness = makeHarness();

  await harness.handler.handleAdminCommandAccess(interaction("set", "admin-command-access", false));

  assert.equal(harness.updateCalls.length, 0);
  assert.deepEqual(harness.invalidated, []);
  assert.deepEqual(harness.edits[0], { content: "Access denied. Doar ownerul serverului poate modifica regulile de acces admin.", flags: 64 });
});
