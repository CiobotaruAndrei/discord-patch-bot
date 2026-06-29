import test from "node:test";
import assert from "node:assert/strict";

type TestInteraction = {
  commandName: string;
  guild: { id: string } | null;
  user?: { id: string };
  deferred: boolean;
  replied: boolean;
  isChatInputCommand: () => boolean;
  memberPermissions: { has: (permission?: unknown) => boolean };
  member?: { roles?: { has?: (roleId: string) => boolean; cache?: { has: (roleId: string) => boolean } } };
  options?: {
    getSubcommand?: (required?: boolean) => string;
    getSubcommandGroup?: (required?: boolean) => string | null;
  };
  reply: (payload: unknown) => Promise<void>;
  followUp: (payload: unknown) => Promise<void>;
};
type TestGame = { key: string };

type AdminGuardModule = ((interaction: TestInteraction) => Promise<boolean>) & {
  ADMIN_REQUIRED_MESSAGE: string;
  isGuildAdmin: (interaction: TestInteraction) => boolean;
  hasAllowedAdminRole: (interaction: TestInteraction) => boolean;
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
  isSensitiveAdminCommand: (interaction: TestInteraction) => boolean;
  hasSensitiveUserAccess: (interaction: TestInteraction) => boolean;
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
      user: { id: "user-1" },
      deferred,
      replied: false,
      isChatInputCommand: () => true,
      memberPermissions: { has: () => isAdmin },
      member: { roles: { has: (_roleId: string) => false } },
      options: {
        getSubcommand: () => "",
        getSubcommandGroup: () => null
      },
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

test("admin guard accepts configured admin role IDs without Discord Administrator", async () => {
  const previous = process.env.BOT_ADMIN_ROLE_IDS;
  process.env.BOT_ADMIN_ROLE_IDS = "role-allowed";
  try {
    const { interaction, replies } = makeInteraction(false);
    interaction.member = { roles: { has: (roleId: string) => roleId === "role-allowed" } };

    assert.equal(requireGuildAdmin.hasAllowedAdminRole(interaction), true);
    assert.equal(await requireGuildAdmin(interaction), true);
    assert.deepEqual(replies, []);
  } finally {
    if (previous === undefined) delete process.env.BOT_ADMIN_ROLE_IDS;
    else process.env.BOT_ADMIN_ROLE_IDS = previous;
  }
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

test("admin command guard blocks sensitive commands for users outside BOT_SENSITIVE_USER_IDS", async () => {
  const previous = process.env.BOT_SENSITIVE_USER_IDS;
  process.env.BOT_SENSITIVE_USER_IDS = "trusted-user";
  try {
    const { interaction, replies } = makeInteraction(true);
    const delegated: string[] = [];
    interaction.commandName = "backup";
    interaction.user = { id: "other-user" };
    interaction.options = {
      getSubcommand: () => "load",
      getSubcommandGroup: () => null
    };
    const guard = adminCommandGuard.createAdminCommandGuard({ requireGuildAdmin: async () => true });

    const result = await guard.handleAdminProtectedCommand(interaction, [], async handledInteraction => {
      delegated.push(handledInteraction.commandName);
      return "delegated";
    });

    assert.equal(adminCommandGuard.isSensitiveAdminCommand(interaction), true);
    assert.equal(adminCommandGuard.hasSensitiveUserAccess(interaction), false);
    assert.equal(result, undefined);
    assert.deepEqual(delegated, []);
    assert.deepEqual(replies, [{ content: "Access denied.", flags: 64 }]);
  } finally {
    if (previous === undefined) delete process.env.BOT_SENSITIVE_USER_IDS;
    else process.env.BOT_SENSITIVE_USER_IDS = previous;
  }
});

test("admin command guard delegates protected commands for admins", async () => {
  const { interaction } = makeInteraction(true);
  const guard = adminCommandGuard.createAdminCommandGuard({ requireGuildAdmin: async () => true });

  const result = await guard.handleAdminProtectedCommand(interaction, [{ key: "cs2" }], async (_handledInteraction, games) => games[0].key);

  assert.equal(result, "cs2");
});

test("admin command guard refuza explicit comenzile admin in DM (fara guild) si NU deleaga la handler (fix bypass /health in DM)", async () => {
  const replies: unknown[] = [];
  const dmInteraction: TestInteraction = {
    commandName: "health",
    guild: null,
    user: { id: "user-1" },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    memberPermissions: { has: () => false },
    member: { roles: { has: (_roleId: string) => false } },
    options: {
      getSubcommand: () => "",
      getSubcommandGroup: () => null
    },
    reply: async (payload: unknown) => { replies.push(payload); },
    followUp: async () => {}
  };
  const delegated: string[] = [];
  let requireGuildAdminCalled = false;
  const guard = adminCommandGuard.createAdminCommandGuard({
    requireGuildAdmin: async () => { requireGuildAdminCalled = true; return true; }
  });

  const result = await guard.handleAdminProtectedCommand(dmInteraction, [], async () => { delegated.push("ran"); return "delegated"; });

  assert.equal(adminCommandGuard.isAdminProtectedCommand(dmInteraction), true, "/health in DM ramane comanda admin (match pe nume, nu pe guild)");
  assert.equal(result, undefined);
  assert.deepEqual(delegated, [], "handler-ul NU ruleaza fara guild (fix bypass)");
  assert.equal(requireGuildAdminCalled, false, "refuzat inainte de verificarea de admin (in DM nu exista permisiuni de server)");
  assert.equal(replies.length, 1, "raspuns explicit de refuz");
  const reply = replies[0] as { content: string; flags: number };
  assert.match(reply.content, /doar pe servere/);
  assert.equal(reply.flags, 64, "raspuns ephemeral");
});

test("toate comenzile administrative sunt protejate runtime, iar comenzile publice nu", () => {
  for (const cmd of [
    "start", "stop", "set", "outbox", "health", "config", "reset-config",
    "admin-alerts", "price-alert", "sources", "watchlist", "snooze", "unsnooze",
    "backup", "bot-log", "server-log"
  ]) {
    const { interaction } = makeInteraction(false);
    interaction.commandName = cmd;
    assert.equal(adminCommandGuard.isAdminProtectedCommand(interaction), true, `/${cmd} trebuie sa treaca prin guard-ul de admin runtime`);
  }
  for (const cmd of ["ping", "games", "help", "report", "history", "latest", "price-check", "suggest-command"]) {
    const { interaction } = makeInteraction(false);
    interaction.commandName = cmd;
    assert.equal(adminCommandGuard.isAdminProtectedCommand(interaction), false, `/${cmd} ramane public (fara guard de admin)`);
  }
});
