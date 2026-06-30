import test from "node:test";
import assert from "node:assert/strict";

const attachAdminAccessCode = require("../features/command-handlers/adminAccessCodeHandler") as typeof import("../features/command-handlers/adminAccessCodeHandler");

type StoredGrant = {
  userId: string;
  grantedAt: Date;
  expiresAt: Date;
};

function withAccessCodes<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env.BOT_ADMIN_ACCESS_CODES;
  if (value === undefined) delete process.env.BOT_ADMIN_ACCESS_CODES;
  else process.env.BOT_ADMIN_ACCESS_CODES = value;
  return run().finally(() => {
    if (previous === undefined) delete process.env.BOT_ADMIN_ACCESS_CODES;
    else process.env.BOT_ADMIN_ACCESS_CODES = previous;
  });
}

function makeHarness(initialGrants: StoredGrant[] = []) {
  const edits: unknown[] = [];
  const updateCalls: Array<{ filter: object; update: object | readonly object[]; options?: object }> = [];
  const invalidated: string[] = [];
  let grants = [...initialGrants];
  const handler = attachAdminAccessCode.createAdminAccessCodeHandler({
    GuildModel: {
      updateOne: async (filter: object, update: object | readonly object[], options?: object) => {
        updateCalls.push({ filter, update, options });
        if (Array.isArray(update)) {
          const serialized = JSON.stringify(update);
          const userId = serialized.includes("user-1") ? "user-1" : "";
          if (userId) {
            grants = grants.filter(grant => grant.userId !== userId);
            grants.push({ userId, grantedAt: new Date(), expiresAt: new Date(Date.now() + 30 * 60 * 1000) });
          }
        } else if ("$pull" in update) {
          grants = [];
        }
        return { modifiedCount: 1 };
      },
      findOne: () => ({
        lean: async () => ({ adminAccessCodeGrants: grants })
      })
    },
    invalidateGuildCache: (guildId: string) => { invalidated.push(guildId); },
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload) => { edits.push(payload); return payload; },
    logger: () => undefined,
    MessageFlags: { Ephemeral: 64 }
  });
  return { handler, edits, updateCalls, invalidated, getGrants: () => grants };
}

function interaction(subcommand: string, code = "valid-admin-code-1") {
  return {
    commandName: "admin-access",
    guild: { id: "guild-1" },
    user: { id: "user-1" },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    options: {
      getSubcommand: () => subcommand,
      getString: () => code
    },
    reply: async () => undefined,
    followUp: async () => undefined
  };
}

test("/admin-access unlock refuza cand codurile nu sunt configurate", async () => {
  await withAccessCodes(undefined, async () => {
    const harness = makeHarness();

    await harness.handler.handleAdminAccessCode(interaction("unlock"));

    assert.deepEqual(harness.updateCalls, []);
    assert.deepEqual(harness.edits[0], { content: "Codul de acces admin nu este configurat pentru bot.", flags: 64 });
  });
});

test("/admin-access unlock refuza codul invalid", async () => {
  await withAccessCodes("valid-admin-code-1", async () => {
    const harness = makeHarness();

    await harness.handler.handleAdminAccessCode(interaction("unlock", "wrong-admin-code"));

    assert.deepEqual(harness.updateCalls, []);
    assert.deepEqual(harness.edits[0], { content: "Access denied.", flags: 64 });
  });
});

test("/admin-access unlock acorda grant temporar fara sa persiste codul secret", async () => {
  await withAccessCodes("valid-admin-code-1", async () => {
    const harness = makeHarness();

    await harness.handler.handleAdminAccessCode(interaction("unlock", "valid-admin-code-1"));

    assert.equal(harness.updateCalls.length, 1);
    assert.equal(JSON.stringify(harness.updateCalls[0].update).includes("adminAccessCodeGrants"), true);
    assert.equal(JSON.stringify(harness.updateCalls[0].update).includes("valid-admin-code-1"), false);
    assert.deepEqual(harness.invalidated, ["guild-1"]);
    assert.match(JSON.stringify(harness.edits[0]), /Access granted/);
  });
});

test("/admin-access status arata grantul activ al userului", async () => {
  const harness = makeHarness([{ userId: "user-1", grantedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }]);

  await harness.handler.handleAdminAccessCode(interaction("status"));

  assert.match(JSON.stringify(harness.edits[0]), /activ pana la/);
});

test("/admin-access revoke sterge grantul userului curent", async () => {
  const harness = makeHarness([{ userId: "user-1", grantedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }]);

  await harness.handler.handleAdminAccessCode(interaction("revoke"));

  assert.equal(harness.getGrants().length, 0);
  assert.deepEqual(harness.invalidated, ["guild-1"]);
  assert.match(JSON.stringify(harness.edits[0]), /revocat/);
});
