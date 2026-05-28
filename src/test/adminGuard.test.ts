import test from "node:test";
import assert from "node:assert/strict";

type TestInteraction = {
  commandName: string;
  guild: { id: string };
  deferred: boolean;
  replied: boolean;
  isChatInputCommand: () => boolean;
  memberPermissions: { has: () => boolean };
  reply: (payload: unknown) => Promise<void>;
  followUp: (payload: unknown) => Promise<void>;
};
type TestGame = { key: string };

type AdminGuardModule = ((interaction: TestInteraction) => Promise<boolean>) & {
  ADMIN_REQUIRED_MESSAGE: string;
  isGuildAdmin: (interaction: TestInteraction) => boolean;
};

type AdminCommandGuardModule = ((context: Record<string, unknown>) => void) & {
  createAdminCommandGuard: (deps: { requireGuildAdmin: (interaction: TestInteraction) => Promise<boolean> }) => {
    handleAdminProtectedCommand: (
      interaction: TestInteraction,
      games: TestGame[],
      next?: (interaction: TestInteraction, games: TestGame[]) => Promise<unknown>
    ) => Promise<unknown>;
  };
  isAdminProtectedCommand: (interaction: TestInteraction) => boolean;
};

const requireGuildAdmin = require("../features/command-security/adminPermissionGuard") as AdminGuardModule;
const adminCommandGuard = require("../features/command-security/adminCommandRouterGuard") as AdminCommandGuardModule;

function makeInteraction(isAdmin: boolean, deferred = false) {
  const replies: unknown[] = [];
  const followUps: unknown[] = [];
  return {
    interaction: {
      commandName: "set",
      guild: { id: "guild-1" },
      deferred,
      replied: false,
      isChatInputCommand: () => true,
      memberPermissions: { has: () => isAdmin },
      reply: async (payload: unknown) => { replies.push(payload); },
      followUp: async (payload: unknown) => { followUps.push(payload); }
    },
    replies,
    followUps
  };
}

test("admin guard accepts guild administrators without replying", async () => {
  const { interaction, replies } = makeInteraction(true);

  assert.equal(requireGuildAdmin.isGuildAdmin(interaction), true);
  assert.equal(await requireGuildAdmin(interaction), true);
  assert.deepEqual(replies, []);
});

test("admin guard rejects non-admins with an ephemeral reply", async () => {
  const { interaction, replies } = makeInteraction(false);

  assert.equal(await requireGuildAdmin(interaction), false);
  assert.deepEqual(replies, [{ content: requireGuildAdmin.ADMIN_REQUIRED_MESSAGE, flags: 64 }]);
});

test("admin guard uses followUp after an interaction was deferred", async () => {
  const { interaction, replies, followUps } = makeInteraction(false, true);

  assert.equal(await requireGuildAdmin(interaction), false);
  assert.deepEqual(replies, []);
  assert.deepEqual(followUps, [{ content: requireGuildAdmin.ADMIN_REQUIRED_MESSAGE, flags: 64 }]);
});

test("admin command guard blocks protected commands before delegating", async () => {
  const { interaction } = makeInteraction(false);
  const delegated: string[] = [];
  const guard = adminCommandGuard.createAdminCommandGuard({ requireGuildAdmin: async () => false });

  const result = await guard.handleAdminProtectedCommand(interaction, [], async handledInteraction => {
    delegated.push(handledInteraction.commandName);
    return "delegated";
  });

  assert.equal(result, undefined);
  assert.deepEqual(delegated, []);
  assert.equal(adminCommandGuard.isAdminProtectedCommand(interaction), true);
});

test("admin command guard delegates protected commands for admins", async () => {
  const { interaction } = makeInteraction(true);
  const guard = adminCommandGuard.createAdminCommandGuard({ requireGuildAdmin: async () => true });

  const result = await guard.handleAdminProtectedCommand(interaction, [{ key: "cs2" }], async (_handledInteraction, games) => games[0].key);

  assert.equal(result, "cs2");
});
