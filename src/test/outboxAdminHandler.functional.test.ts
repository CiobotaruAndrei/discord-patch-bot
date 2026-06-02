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
    client: { user: { id: "bot-1" }, channels: { fetch: async () => null } },
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
  paused?: boolean;
  updateManyResult?: { modifiedCount?: number; matchedCount?: number };
  notificationChannelId?: string | null;
  discountChannelId?: string | null;
  channelPermissions?: (channelId: string) => { sendMessages: boolean; embedLinks: boolean; readMessageHistory: boolean } | null;
  lockToken?: string | null;
  drainResult?: { sent?: number; retried?: number; deadLettered?: number; queued?: number };
} = {}) {
  const replies: string[] = [];
  const updateManyCalls: Array<{ filter: unknown; update: unknown }> = [];
  const pauseCalls: boolean[] = [];
  const permissionChecks: string[] = [];
  const lockCalls: Array<{ name: string; ttl: number }> = [];
  const releaseCalls: string[] = [];
  let drainCalls = 0;
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
      notificationDeadLetter: opts.deadLetters ?? [],
      notificationChannelId: opts.notificationChannelId ?? null,
      discountChannelId: opts.discountChannelId ?? null
    }),
    getOutboxPaused: async () => opts.paused ?? false,
    setOutboxPaused: async (paused: boolean) => { pauseCalls.push(paused); },
    checkChannelPermissions: async (_interaction: unknown, channelId: string) => {
      permissionChecks.push(channelId);
      return opts.channelPermissions ? opts.channelPermissions(channelId) : null;
    },
    acquireDbLock: async (name: string, ttl: number) => {
      lockCalls.push({ name, ttl });
      return opts.lockToken === undefined ? "lock-token" : opts.lockToken;
    },
    releaseDbLock: async (_name: string, token: string) => { releaseCalls.push(token); },
    drainOutbox: async () => {
      drainCalls++;
      return opts.drainResult ?? { sent: 0, retried: 0, deadLettered: 0, queued: 0 };
    },
    safeDefer: async () => undefined,
    safeEdit: async (_interaction: unknown, content: string) => { replies.push(content); return content; },
    formatUserError: (_err: unknown, fallback: string) => fallback,
    logger: () => undefined,
    outboxEnabled: opts.outboxEnabled ?? true,
    recoveryVerifyGlobal: opts.recoveryVerifyGlobal ?? false,
    recoveryStrict: opts.recoveryStrict ?? false
  };
  return { deps, replies, updateManyCalls, pauseCalls, permissionChecks, lockCalls, releaseCalls, getDrainCalls: () => drainCalls };
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

test("/outbox drain-now: lock liber -> dreneaza, elibereaza lock-ul si raporteaza", async () => {
  const { deps, replies, lockCalls, releaseCalls, getDrainCalls } = makeDeps({ drainResult: { sent: 4, retried: 1, deadLettered: 0, queued: 2 } });
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "drain-now"));
  assert.equal(lockCalls.length, 1);
  assert.equal(lockCalls[0].name, "outbox_drain", "foloseste lock-ul dedicat outbox_drain");
  assert.equal(getDrainCalls(), 1, "a drenat o data");
  assert.equal(releaseCalls.length, 1, "a eliberat lock-ul");
  assert.match(replies[0], /trimise \*\*4\*\*/);
  assert.match(replies[0], /ramase in coada \*\*2\*\*/);
});

test("/outbox drain-now: lock detinut -> raporteaza ocupat, nu dreneaza", async () => {
  const { deps, replies, getDrainCalls, releaseCalls } = makeDeps({ lockToken: null });
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "drain-now"));
  assert.equal(getDrainCalls(), 0, "nu dreneaza cand lock-ul e detinut");
  assert.equal(releaseCalls.length, 0, "nu elibereaza un lock pe care nu l-a obtinut");
  assert.match(replies[0], /detinut de o alta drenare/);
});

test("/outbox drain-now: outbox dezactivat -> mesaj, fara lock", async () => {
  const { deps, replies, lockCalls, getDrainCalls } = makeDeps({ outboxEnabled: false });
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "drain-now"));
  assert.equal(lockCalls.length, 0, "nu incearca lock daca outbox-ul e oprit");
  assert.equal(getDrainCalls(), 0);
  assert.match(replies[0], /nu este activat/);
});

test("/outbox status afiseaza starea de drenare (activa/pe pauza)", async () => {
  const active = makeDeps({ paused: false });
  const h1 = installOutboxAdmin.createOutboxAdminHandler(active.deps);
  await h1.handleOutboxInteraction(makeInteraction(null, "status"));
  assert.match(active.replies[0], /Drenare: \*\*ACTIVA\*\*/);

  const paused = makeDeps({ paused: true });
  const h2 = installOutboxAdmin.createOutboxAdminHandler(paused.deps);
  await h2.handleOutboxInteraction(makeInteraction(null, "status"));
  assert.match(paused.replies[0], /Drenare: \*\*PE PAUZA\*\*/);
});

test("/outbox pause si /outbox resume comuta flagul de drenare", async () => {
  const { deps, replies, pauseCalls } = makeDeps({});
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "pause"));
  await handler.handleOutboxInteraction(makeInteraction(null, "resume"));
  assert.deepEqual(pauseCalls, [true, false], "pause -> true, resume -> false");
  assert.match(replies[0], /pusa pe pauza/);
  assert.match(replies[1], /reluata/);
});

test("/outbox permissions raporteaza permisiunile pe canalele configurate si semnaleaza ce lipseste", async () => {
  const { deps, replies, permissionChecks } = makeDeps({
    notificationChannelId: "chan-upd",
    discountChannelId: "chan-deal",
    channelPermissions: (id) => id === "chan-upd"
      ? { sendMessages: true, embedLinks: true, readMessageHistory: true }
      : { sendMessages: true, embedLinks: true, readMessageHistory: false }
  });
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "permissions"));
  assert.deepEqual(permissionChecks, ["chan-upd", "chan-deal"], "verifica ambele canale configurate");
  assert.match(replies[0], /<#chan-upd>/);
  assert.match(replies[0], /<#chan-deal>/);
  assert.match(replies[0], /Read Message History \*\*LIPSA\*\*/);
  assert.match(replies[0], /recovery-verify nu poate citi istoricul/);
});

test("/outbox permissions fara canale configurate raspunde corespunzator", async () => {
  const { deps, replies, permissionChecks } = makeDeps({});
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "permissions"));
  assert.equal(permissionChecks.length, 0, "fara canale nu se verifica permisiuni");
  assert.match(replies[0], /Niciun canal de notificari configurat/);
});

test("/outbox permissions: canal inaccesibil -> necunoscut", async () => {
  const { deps, replies } = makeDeps({ notificationChannelId: "chan-x", channelPermissions: () => null });
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "permissions"));
  assert.match(replies[0], /necunoscut/);
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
    getOutboxPaused: async () => false,
    setOutboxPaused: async () => undefined,
    checkChannelPermissions: async () => null,
    acquireDbLock: async () => "lock-token",
    releaseDbLock: async () => undefined,
    drainOutbox: async () => ({ sent: 0, retried: 0, deadLettered: 0, queued: 0 }),
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
