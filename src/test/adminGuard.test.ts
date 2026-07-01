import test from "node:test";
import assert from "node:assert/strict";

type TestInteraction = {
  commandName: string;
  guild: {
    id: string;
    ownerId?: string | null;
    fetchOwner?: () => Promise<{ id?: string; user?: { id?: string } | null } | null>;
    roles?: { cache?: { has: (roleId: string) => boolean; get?: (roleId: string) => { position?: number } | undefined } };
  } | null;
  user?: { id: string };
  globalAccessCodeAuthorized?: boolean;
  deferred: boolean;
  replied: boolean;
  isChatInputCommand: () => boolean;
  memberPermissions: { has: (permission?: unknown) => boolean };
  member?: { roles?: { has?: (roleId: string) => boolean; cache?: { has: (roleId: string) => boolean }; highest?: { position?: number } } | readonly string[] };
  options?: {
    getSubcommand?: (required?: boolean) => string;
    getSubcommandGroup?: (required?: boolean) => string | null;
  };
  reply: (payload: unknown) => Promise<void>;
  followUp: (payload: unknown) => Promise<void>;
  deferReply?: (payload?: unknown) => Promise<void>;
  editReply?: (payload: unknown) => Promise<void>;
  showModal?: (modal: unknown) => Promise<void>;
  awaitModalSubmit?: (options: { filter: (interaction: TestModalSubmit) => boolean; time: number }) => Promise<TestModalSubmit>;
};
type TestGame = { key: string };
type TestModalSubmit = {
  customId: string;
  user: { id: string };
  deferred: boolean;
  replied: boolean;
  fields: { getTextInputValue: (customId: string) => string };
  reply: (payload: unknown) => Promise<void>;
  followUp: (payload: unknown) => Promise<void>;
  deferReply: (payload?: unknown) => Promise<void>;
  editReply: (payload: unknown) => Promise<void>;
};

type AdminGuardModule = ((interaction: TestInteraction) => Promise<boolean>) & {
  ADMIN_REQUIRED_MESSAGE: string;
  isGuildAdmin: (interaction: TestInteraction) => boolean;
  hasAllowedAdminRole: (interaction: TestInteraction) => boolean;
  hasConfiguredAdminRole: (interaction: TestInteraction, config: { mode?: "role" | "role-or-higher" | null; roleId?: string | null } | null) => boolean;
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
  isOwnerOnlyAdminAccessCommand: (interaction: TestInteraction) => boolean;
  isGuildOwner: (interaction: TestInteraction) => Promise<boolean>;
};

const requireGuildAdmin = require("../features/command-security/adminPermissionGuard") as AdminGuardModule;
const adminCommandGuard = require("../features/command-security/adminCommandRouterGuard") as AdminCommandGuardModule;
const globalAccessCode = require("../features/command-security/globalAccessCode") as typeof import("../features/command-security/globalAccessCode");

function makeInteraction(isAdmin: boolean, deferred = false): { interaction: TestInteraction; replies: unknown[]; followUps: unknown[] } {
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

test("admin guard nu mai accepta BOT_ADMIN_ROLE_IDS ca regula implicita", async () => {
  const previous = process.env.BOT_ADMIN_ROLE_IDS;
  process.env.BOT_ADMIN_ROLE_IDS = "role-allowed";
  try {
    const { interaction, replies } = makeInteraction(false);
    interaction.member = { roles: { has: (roleId: string) => roleId === "role-allowed" } };

    assert.equal(requireGuildAdmin.hasAllowedAdminRole(interaction), false);
    assert.equal(await requireGuildAdmin(interaction), false);
    assert.deepEqual(replies, [{ content: requireGuildAdmin.ADMIN_REQUIRED_MESSAGE, flags: 64 }]);
  } finally {
    if (previous === undefined) delete process.env.BOT_ADMIN_ROLE_IDS;
    else process.env.BOT_ADMIN_ROLE_IDS = previous;
  }
});

test("admin guard accepts configured exact admin role without Discord Administrator", () => {
  const { interaction } = makeInteraction(false);
  interaction.member = { roles: { has: (roleId: string) => roleId === "role-allowed" } };

  assert.equal(requireGuildAdmin.hasConfiguredAdminRole(interaction, { mode: "role", roleId: "role-allowed" }), true);
});

test("admin guard accepts configured role IDs cand member.roles e un array brut de ID-uri (interactiune necache-uita) (R[Medium] #2)", () => {
  const { interaction } = makeInteraction(false);
  interaction.member = { roles: ["role-other", "role-allowed"] };

  assert.equal(requireGuildAdmin.hasConfiguredAdminRole(interaction, { mode: "role", roleId: "role-allowed" }), true);
});

test("admin guard respinge cand member.roles e array fara rolul configurat (nu accepta orbeste orice array) (R[Medium] #2)", () => {
  const { interaction } = makeInteraction(false);
  interaction.member = { roles: ["role-x", "role-y"] };

  assert.equal(requireGuildAdmin.hasConfiguredAdminRole(interaction, { mode: "role", roleId: "role-allowed" }), false);
});

test("admin guard accepts configured role-or-higher by Discord role position", () => {
  const { interaction } = makeInteraction(false);
  interaction.guild = {
    id: "guild-1",
    roles: { cache: { has: () => false, get: (roleId: string) => roleId === "role-required" ? { position: 5 } : undefined } }
  };
  interaction.member = { roles: { has: () => false, highest: { position: 7 } } };

  assert.equal(requireGuildAdmin.hasConfiguredAdminRole(interaction, { mode: "role-or-higher", roleId: "role-required" }), true);
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

function modalCustomId(modal: unknown): string {
  const json = (modal as { toJSON?: () => { custom_id?: string } }).toJSON?.();
  return String(json?.custom_id || "");
}

function attachAccessCodeModal(interaction: TestInteraction, code: string, modalReplies: unknown[], modalEdits: unknown[]): void {
  let customId = "";
  interaction.showModal = async modal => { customId = modalCustomId(modal); };
  interaction.awaitModalSubmit = async options => {
    const submit: TestModalSubmit = {
      customId,
      user: { id: interaction.user?.id || "" },
      deferred: false,
      replied: false,
      fields: { getTextInputValue: () => code },
      reply: async payload => { submit.replied = true; modalReplies.push(payload); },
      followUp: async payload => { modalReplies.push(payload); },
      deferReply: async () => { submit.deferred = true; },
      editReply: async payload => { modalEdits.push(payload); }
    };
    assert.equal(options.filter(submit), true);
    return submit;
  };
}

test("global access code hash verifica secretul fara text simplu", () => {
  const hash = globalAccessCode.sha256Hex("test-access-code-123");

  assert.equal(globalAccessCode.verifyGlobalAccessCode("test-access-code-123", { BOT_GLOBAL_ACCESS_CODE_HASH: hash }), "valid");
  assert.equal(globalAccessCode.verifyGlobalAccessCode("gresit", { BOT_GLOBAL_ACCESS_CODE_HASH: hash }), "invalid");
  assert.equal(globalAccessCode.verifyGlobalAccessCode("test-access-code-123", { BOT_GLOBAL_ACCESS_CODE_HASH: "change_me" }), "not-configured");
});

test("admin command guard delegates protected commands dupa codul global corect introdus in modal", async () => {
  const previousHash = process.env.BOT_GLOBAL_ACCESS_CODE_HASH;
  const previousPlain = process.env.BOT_GLOBAL_ACCESS_CODE;
  process.env.BOT_GLOBAL_ACCESS_CODE_HASH = globalAccessCode.sha256Hex("test-access-code-123");
  delete process.env.BOT_GLOBAL_ACCESS_CODE;
  try {
    const { interaction } = makeInteraction(false);
    interaction.commandName = "config";
    const modalReplies: unknown[] = [];
    const modalEdits: unknown[] = [];
    attachAccessCodeModal(interaction, "test-access-code-123", modalReplies, modalEdits);
    const delegated: Array<boolean | undefined> = [];
    const target: Record<string, unknown> & {
      handleInteraction: (handledInteraction: TestInteraction, games: TestGame[]) => Promise<unknown>;
    } = {
      GuildModel: {
        db: { readyState: 1 },
        findOne: () => ({ lean: async () => ({ adminCommandAccess: null }) }),
        updateOne: async () => ({ modifiedCount: 1 })
      },
      adminAlert: async () => undefined,
      handleInteraction: async handledInteraction => {
        delegated.push(handledInteraction.globalAccessCodeAuthorized);
        await handledInteraction.editReply?.({ content: "config ok" });
        return "delegated";
      }
    };

    adminCommandGuard(target);
    const result = await target.handleInteraction(interaction, []);

    assert.equal(result, "delegated");
    assert.deepEqual(delegated, [true]);
    assert.deepEqual(modalReplies, [{ content: "Access granted.", flags: 64 }]);
    assert.deepEqual(modalEdits, [{ content: "config ok" }]);
  } finally {
    if (previousHash === undefined) delete process.env.BOT_GLOBAL_ACCESS_CODE_HASH;
    else process.env.BOT_GLOBAL_ACCESS_CODE_HASH = previousHash;
    if (previousPlain === undefined) delete process.env.BOT_GLOBAL_ACCESS_CODE;
    else process.env.BOT_GLOBAL_ACCESS_CODE = previousPlain;
  }
});

test("admin command guard lasa ownerul serverului sa configureze accesul admin fara Administrator sau cod global", async () => {
  const { interaction } = makeInteraction(false);
  interaction.commandName = "set";
  interaction.guild = { id: "guild-1", ownerId: "user-1" };
  interaction.options = {
    getSubcommand: () => "admin-command-access",
    getSubcommandGroup: () => null
  };
  const delegated: string[] = [];
  const target: Record<string, unknown> & {
    handleInteraction: (handledInteraction: TestInteraction, games: TestGame[]) => Promise<unknown>;
  } = {
    GuildModel: {
      db: { readyState: 1 },
      findOne: () => ({ lean: async () => ({ adminCommandAccess: null }) }),
      updateOne: async () => ({ modifiedCount: 1 })
    },
    handleInteraction: async handledInteraction => {
      delegated.push(handledInteraction.commandName);
      return "delegated";
    }
  };

  assert.equal(adminCommandGuard.isOwnerOnlyAdminAccessCommand(interaction), true);
  assert.equal(await adminCommandGuard.isGuildOwner(interaction), true);
  adminCommandGuard(target);
  const result = await target.handleInteraction(interaction, []);

  assert.equal(result, "delegated");
  assert.deepEqual(delegated, ["set"]);
});

test("admin command guard refuza codul global gresit si alerteaza dupa incercari repetate", async () => {
  const previousHash = process.env.BOT_GLOBAL_ACCESS_CODE_HASH;
  const previousPlain = process.env.BOT_GLOBAL_ACCESS_CODE;
  process.env.BOT_GLOBAL_ACCESS_CODE_HASH = globalAccessCode.sha256Hex("test-access-code-123");
  delete process.env.BOT_GLOBAL_ACCESS_CODE;
  try {
    const alerts: string[] = [];
    const delegated: string[] = [];
    const target: Record<string, unknown> & {
      handleInteraction: (handledInteraction: TestInteraction, games: TestGame[]) => Promise<unknown>;
    } = {
      GuildModel: {
        db: { readyState: 1 },
        findOne: () => ({ lean: async () => ({ adminCommandAccess: null }) }),
        updateOne: async () => ({ modifiedCount: 1 })
      },
      adminAlert: async (kind: string) => { alerts.push(String(kind)); },
      handleInteraction: async handledInteraction => { delegated.push(handledInteraction.commandName); return "delegated"; }
    };
    adminCommandGuard(target);

    for (let i = 0; i < 5; i += 1) {
      const { interaction } = makeInteraction(false);
      interaction.commandName = "config";
      interaction.user = { id: "bad-code-user" };
      attachAccessCodeModal(interaction, "gresit", [], []);
      await target.handleInteraction(interaction, []);
    }

    assert.deepEqual(delegated, []);
    assert.deepEqual(alerts, ["security:access-code"]);
  } finally {
    if (previousHash === undefined) delete process.env.BOT_GLOBAL_ACCESS_CODE_HASH;
    else process.env.BOT_GLOBAL_ACCESS_CODE_HASH = previousHash;
    if (previousPlain === undefined) delete process.env.BOT_GLOBAL_ACCESS_CODE;
    else process.env.BOT_GLOBAL_ACCESS_CODE = previousPlain;
  }
});

test("admin command guard delegates protected commands for configured role access", async () => {
  const { interaction } = makeInteraction(false);
  interaction.commandName = "config";
  interaction.member = { roles: { has: (roleId: string) => roleId === "role-allowed" } };
  const delegated: string[] = [];
  const target: Record<string, unknown> & {
    handleInteraction: (handledInteraction: TestInteraction, games: TestGame[]) => Promise<unknown>;
  } = {
    GuildModel: {
      db: { readyState: 1 },
      findOne: () => ({
        lean: async () => ({
          adminCommandAccess: { mode: "role", roleId: "role-allowed" }
        })
      }),
      updateOne: async () => ({ modifiedCount: 1 })
    },
    handleInteraction: async (handledInteraction: TestInteraction, _games: TestGame[]) => {
      delegated.push(handledInteraction.commandName);
      return "delegated";
    }
  };

  adminCommandGuard(target);
  const result = await target.handleInteraction(interaction, []);

  assert.equal(result, "delegated");
  assert.deepEqual(delegated, ["config"]);
});

test("admin command guard foloseste regula dedicata pe comanda inaintea fallback-ului global", async () => {
  const { interaction: startInteraction } = makeInteraction(false);
  startInteraction.commandName = "start";
  startInteraction.options = {
    getSubcommand: () => "updates",
    getSubcommandGroup: () => null
  };
  startInteraction.member = { roles: { has: (roleId: string) => roleId === "role-start" } };
  const delegated: string[] = [];
  const target: Record<string, unknown> & {
    handleInteraction: (handledInteraction: TestInteraction, games: TestGame[]) => Promise<unknown>;
  } = {
    GuildModel: {
      db: { readyState: 1 },
      findOne: () => ({
        lean: async () => ({
          adminCommandAccess: { mode: "role", roleId: "role-global" },
          adminCommandAccessByCommand: {
            "start:updates": { mode: "role", roleId: "role-start" }
          }
        })
      }),
      updateOne: async () => ({ modifiedCount: 1 })
    },
    handleInteraction: async (handledInteraction: TestInteraction) => {
      delegated.push(`${handledInteraction.commandName}:${handledInteraction.options?.getSubcommand?.(false) || ""}`);
      return "delegated";
    }
  };
  adminCommandGuard(target);

  const startResult = await target.handleInteraction(startInteraction, []);

  assert.equal(startResult, "delegated");
  assert.deepEqual(delegated, ["start:updates"]);

  const { interaction: stopInteraction, replies } = makeInteraction(false);
  stopInteraction.commandName = "stop";
  stopInteraction.options = {
    getSubcommand: () => "updates",
    getSubcommandGroup: () => null
  };
  stopInteraction.member = { roles: { has: (roleId: string) => roleId === "role-start" } };

  const stopResult = await target.handleInteraction(stopInteraction, []);

  assert.equal(stopResult, undefined);
  assert.deepEqual(delegated, ["start:updates"]);
  assert.deepEqual(replies, [{ content: "Access denied.", flags: 64 }]);
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
    "backup", "bot-log", "server-log", "future-release", "maintenance", "admin-command-access", "delete"
  ]) {
    const { interaction } = makeInteraction(false);
    interaction.commandName = cmd;
    assert.equal(adminCommandGuard.isAdminProtectedCommand(interaction), true, `/${cmd} trebuie sa treaca prin guard-ul de admin runtime`);
  }
  for (const cmd of ["ping", "games", "help", "report", "history", "latest", "price-check", "deal-score", "player-count", "top", "suggest-command", "watchlist-game"]) {
    const { interaction } = makeInteraction(false);
    interaction.commandName = cmd;
    assert.equal(adminCommandGuard.isAdminProtectedCommand(interaction), false, `/${cmd} ramane public (fara guard de admin)`);
  }
});

test("comenzile verb /add si /remove sunt protejate runtime, exceptie /add suggestion (public)", () => {
  const adminCases: Array<[string, string]> = [
    ["add", "price-alert"], ["add", "watchlist"], ["add", "backup"],
    ["remove", "price-alert"], ["remove", "watchlist"]
  ];
  for (const [cmd, sub] of adminCases) {
    const { interaction } = makeInteraction(false);
    interaction.commandName = cmd;
    interaction.options!.getSubcommand = () => sub;
    assert.equal(adminCommandGuard.isAdminProtectedCommand(interaction), true, `/${cmd} ${sub} trece prin guard-ul de admin runtime`);
  }
  const { interaction: pub } = makeInteraction(false);
  pub.commandName = "add";
  pub.options!.getSubcommand = () => "suggestion";
  assert.equal(adminCommandGuard.isAdminProtectedCommand(pub), false, "/add suggestion ramane public (oricine poate propune o comanda)");
});

test("guard: handler care intoarce handledCommandError e auditat ca 'Command error.', nu 'Access granted.' (R[P2] audit onest)", async () => {
  const mod = require("../features/command-security/adminCommandRouterGuard") as AdminCommandGuardModule & {
    createAdminCommandGuard: (deps: { requireGuildAdmin: (interaction: TestInteraction) => Promise<boolean> }, target?: { GuildModel?: unknown }) => {
      handleAdminProtectedCommand: (interaction: TestInteraction, games: TestGame[], next?: (interaction: TestInteraction, games: TestGame[]) => Promise<unknown>) => Promise<unknown>;
    };
  };
  const { handledCommandError } = require("../features/command-security/commandOutcome") as typeof import("../features/command-security/commandOutcome");

  const audits: string[] = [];
  const target = {
    GuildModel: {
      updateOne: async (_filter: unknown, update: Record<string, unknown>) => {
        const entry = (update.$push as { botAuditLog?: { $each?: Array<{ result?: string }> } } | undefined)?.botAuditLog?.$each?.[0];
        if (entry?.result) audits.push(entry.result);
        return { modifiedCount: 1 };
      }
    }
  };
  const guard = mod.createAdminCommandGuard({ requireGuildAdmin: async () => true }, target);
  const interaction = {
    commandName: "config",
    guild: { id: "guild-1" },
    user: { id: "user-1" },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    memberPermissions: { has: () => true },
    options: { getSubcommand: () => "", getSubcommandGroup: () => null },
    reply: async () => undefined,
    followUp: async () => undefined
  } satisfies TestInteraction;

  await guard.handleAdminProtectedCommand(interaction, [], async () => handledCommandError("mongo down"));
  await guard.handleAdminProtectedCommand(interaction, [], async () => ({ content: "ok" }));

  assert.deepEqual(audits, ["Command error.", "Access granted."], "un handler care si-a tratat eroarea intern e auditat onest, nu ca succes");
});
