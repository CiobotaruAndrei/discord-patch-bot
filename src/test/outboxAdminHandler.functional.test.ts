import test from "node:test";
import assert from "node:assert/strict";

const installOutboxAdmin = require("../features/command-handlers/outboxAdminHandler") as
  ((context: Record<string, unknown>) => void) & {
    createOutboxAdminHandler: (deps: Record<string, unknown>) => { handleOutboxInteraction: (interaction: unknown) => Promise<unknown> };
    isDirectOutboxCommand: (interaction: unknown) => boolean;
  };

type DeadLetterEntry = { kind?: string; itemId?: string; title?: string; reason?: string; attempts?: number; failedAt?: Date };

function makeInteraction(group: string | null, sub: string) {
  return {
    commandName: "outbox",
    guild: { id: "guild-1" },
    options: { getSubcommandGroup: () => group, getSubcommand: () => sub },
    isChatInputCommand: () => true,
    deferred: false,
    replied: false,
    reply: async () => undefined,
    followUp: async () => undefined
  };
}

function makeDeps(opts: {
  guildQueued?: number;
  totalQueued?: number;
  perGuildVerify?: boolean;
  deadLetters?: DeadLetterEntry[];
  outboxEnabled?: boolean;
  recoveryVerifyGlobal?: boolean;
  recoveryStrict?: boolean;
  updateManyResult?: { modifiedCount?: number; matchedCount?: number };
} = {}) {
  const replies: string[] = [];
  const updateManyCalls: Array<{ filter: unknown; update: unknown }> = [];
  const deps = {
    NotificationOutboxModel: {
      countDocuments: async (filter: { guildId?: string } = {}) => (filter && filter.guildId ? (opts.guildQueued ?? 0) : (opts.totalQueued ?? 0)),
      updateMany: async (filter: unknown, update: unknown) => {
        updateManyCalls.push({ filter, update });
        return opts.updateManyResult ?? { modifiedCount: opts.guildQueued ?? 0 };
      }
    },
    getGuildSettings: async () => ({
      outboxRecoveryVerify: opts.perGuildVerify ?? false,
      notificationDeadLetter: opts.deadLetters ?? []
    }),
    safeDefer: async () => undefined,
    safeEdit: async (_interaction: unknown, content: string) => { replies.push(content); return content; },
    formatUserError: (_err: unknown, fallback: string) => fallback,
    logger: () => undefined,
    outboxEnabled: opts.outboxEnabled ?? true,
    recoveryVerifyGlobal: opts.recoveryVerifyGlobal ?? false,
    recoveryStrict: opts.recoveryStrict ?? false
  };
  return { deps, replies, updateManyCalls };
}

test("/outbox status afiseaza coada, dead-letter si starea recovery-verify", async () => {
  const { deps, replies } = makeDeps({ guildQueued: 3, totalQueued: 12, perGuildVerify: true, deadLetters: [{ kind: "update" }], outboxEnabled: true, recoveryVerifyGlobal: false, recoveryStrict: true });
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "status"));
  assert.match(replies[0], /Joburi in coada \(acest server\): \*\*3\*\*/);
  assert.match(replies[0], /Joburi in coada \(global\): \*\*12\*\*/);
  assert.match(replies[0], /Dead-letter \(acest server\): \*\*1\*\*/);
  assert.match(replies[0], /Recovery-verify acest server: \*\*ON\*\*/);
  assert.match(replies[0], /strict: \*\*ON\*\*/);
});

test("/outbox deadletters listeaza intrarile sau spune ca e gol", async () => {
  const empty = makeDeps({ deadLetters: [] });
  const h1 = installOutboxAdmin.createOutboxAdminHandler(empty.deps);
  await h1.handleOutboxInteraction(makeInteraction(null, "deadletters"));
  assert.match(empty.replies[0], /Nicio livrare in dead-letter/);

  const filled = makeDeps({ deadLetters: [{ kind: "discount", title: "Joc X", reason: "permanent", attempts: 1, failedAt: new Date(0) }] });
  const h2 = installOutboxAdmin.createOutboxAdminHandler(filled.deps);
  await h2.handleOutboxInteraction(makeInteraction(null, "deadletters"));
  assert.match(filled.replies[0], /Joc X/);
  assert.match(filled.replies[0], /permanent/);
});

test("/outbox retry reprogrameaza doar joburile acestui server", async () => {
  const { deps, replies, updateManyCalls } = makeDeps({ updateManyResult: { modifiedCount: 4 } });
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "retry"));
  assert.equal(updateManyCalls.length, 1);
  assert.deepEqual(updateManyCalls[0].filter, { guildId: "guild-1" });
  const update = updateManyCalls[0].update as { $set: { availableAt: Date }; $unset: Record<string, string> };
  assert.ok(update.$set.availableAt instanceof Date, "seteaza availableAt acum");
  assert.ok("lockedUntil" in update.$unset && "lockedBy" in update.$unset, "elibereaza lease-ul");
  assert.match(replies[0], /4 joburi/);
});

test("/outbox retry fara joburi raspunde corespunzator", async () => {
  const { deps, replies } = makeDeps({ updateManyResult: { modifiedCount: 0 } });
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "retry"));
  assert.match(replies[0], /Nu exista joburi in coada/);
});

test("/outbox recovery-verify status afiseaza starea per-guild si globala", async () => {
  const { deps, replies } = makeDeps({ perGuildVerify: true, recoveryVerifyGlobal: false, recoveryStrict: false });
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction("recovery-verify", "status"));
  assert.match(replies[0], /Acest server: \*\*ON\*\*/);
  assert.match(replies[0], /Global: \*\*OFF\*\*/);
});

test("/outbox subcomanda necunoscuta -> reply explicit", async () => {
  const { deps, replies } = makeDeps({});
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "ceva-nou"));
  assert.match(replies[0], /nu este recunoscuta/);
});

test("install: deleaga interactiunile non-/outbox catre handler-ul urmator", async () => {
  const delegated: string[] = [];
  const context: Record<string, unknown> = {
    NotificationOutboxModel: { countDocuments: async () => 0, updateMany: async () => ({}) },
    getGuildSettings: async () => null,
    safeDefer: async () => undefined,
    safeEdit: async () => undefined,
    formatUserError: (_e: unknown, f: string) => f,
    logger: () => undefined,
    MessageFlags: { Ephemeral: 64 },
    handleInteraction: async (interaction: { commandName?: string }) => { delegated.push(interaction.commandName || ""); }
  };
  installOutboxAdmin(context);
  await (context.handleInteraction as (i: unknown, g: unknown[]) => Promise<unknown>)({ commandName: "ping", isChatInputCommand: () => true, guild: { id: "g" } }, []);
  assert.deepEqual(delegated, ["ping"], "comenzile non-outbox sunt delegate mai jos");
});

test("isDirectOutboxCommand recunoaste doar /outbox in guild", () => {
  assert.equal(installOutboxAdmin.isDirectOutboxCommand({ commandName: "outbox", isChatInputCommand: () => true, guild: { id: "g" } }), true);
  assert.equal(installOutboxAdmin.isDirectOutboxCommand({ commandName: "set", isChatInputCommand: () => true, guild: { id: "g" } }), false);
  assert.equal(installOutboxAdmin.isDirectOutboxCommand({ commandName: "outbox", isChatInputCommand: () => true, guild: null }), false);
});
