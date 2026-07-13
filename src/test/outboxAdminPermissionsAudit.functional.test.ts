import test from "node:test";
import assert from "node:assert/strict";
import { installOutboxAdmin, makeDeps, makeInteraction } from "./outboxAdminTestKit.js";
import { installCommandChain, type ChainableCommandModule } from "./commandChainTestKit.js";
import type { DeadLetterEntry } from "./outboxAdminTestKit.js";

test("/outbox permissions raporteaza permisiunile pe canalele configurate si semnaleaza ce lipseste", async () => {
  const { deps, replies, permissionChecks } = makeDeps({
    notificationChannelId: "chan-upd",
    discountChannelId: "chan-deal",
    channelPermissions: (id) => id === "chan-upd"
      ? { viewChannel: true, sendMessages: true, embedLinks: true, readMessageHistory: true }
      : { viewChannel: true, sendMessages: true, embedLinks: true, readMessageHistory: false }
  });
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "permissions"));
  assert.deepEqual(permissionChecks, ["chan-upd", "chan-deal"], "verifica ambele canale configurate");
  assert.match(replies[0], /<#chan-upd>/);
  assert.match(replies[0], /<#chan-deal>/);
  assert.match(replies[0], /Read Message History \*\*LIPSA\*\*/);
  assert.match(replies[0], /recovery-verify nu poate citi istoricul/);
});

test("/outbox permissions auditeaza si canalele DLC + future-release si afiseaza View Channel (R[Medium] #1)", async () => {
  const { deps, replies, permissionChecks } = makeDeps({
    notificationChannelId: "chan-upd",
    dlcChannelId: "chan-dlc",
    futureReleaseChannelId: "chan-fr",
    channelPermissions: (id) => id === "chan-dlc"
      ? { viewChannel: false, sendMessages: true, embedLinks: true, readMessageHistory: true }
      : { viewChannel: true, sendMessages: true, embedLinks: true, readMessageHistory: true }
  });
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "permissions"));
  assert.deepEqual(permissionChecks, ["chan-upd", "chan-dlc", "chan-fr"], "auditul include si canalele DLC + future-release, nu doar updates/reduceri/YouTube");
  assert.match(replies[0], /DLC \(<#chan-dlc>\)/);
  assert.match(replies[0], /Future-release \(<#chan-fr>\)/);
  assert.match(replies[0], /View Channel \*\*LIPSA\*\*/, "raportul afiseaza si permisiunea View Channel (lipsa pe canalul DLC)");
});

test("/outbox permissions auditeaza si canalul YouTube (documentatia spune ca include YouTube)", async () => {
  const { deps, replies, permissionChecks } = makeDeps({
    notificationChannelId: "chan-upd",
    youtubeNotificationChannelId: "chan-yt",
    channelPermissions: () => ({ viewChannel: true, sendMessages: true, embedLinks: true, readMessageHistory: true })
  });
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "permissions"));
  assert.deepEqual(permissionChecks, ["chan-upd", "chan-yt"], "auditul include canalul YouTube");
  assert.match(replies[0], /YouTube \(<#chan-yt>\)/, "raportul listeaza canalul YouTube");
});

test("/outbox permissions auditeaza si canalele din rutele speciale YouTube, nu doar canalul principal", async () => {
  const { deps, replies, permissionChecks } = makeDeps({
    youtubeNotificationChannelId: "chan-yt-main",
    youtubeChannelRoutes: [
      { channelId: "UCaaa", discordChannelIds: ["chan-route-1", "chan-route-2"] },
      { channelId: "UCbbb", discordChannelIds: ["chan-route-2"] }
    ],
    channelPermissions: () => ({ viewChannel: true, sendMessages: true, embedLinks: true, readMessageHistory: true })
  });
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "permissions"));
  for (const id of ["chan-yt-main", "chan-route-1", "chan-route-2"]) {
    assert.ok(permissionChecks.includes(id), `auditul verifica ${id}`);
    assert.match(replies[0], new RegExp(`<#${id}>`), `raportul listeaza ${id}`);
  }
});

test("/outbox permissions fara canale configurate raspunde corespunzator", async () => {
  const { deps, replies, permissionChecks } = makeDeps({});
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "permissions"));
  assert.equal(permissionChecks.length, 0, "fara canale nu se verifica permisiuni");
  assert.match(replies[0], /Niciun canal de notificari configurat/);
});

test("/outbox permissions fara canale: hint-ul indica si comenzile de setup DLC + future-release, nu doar updates/reduceri/YouTube (R[Low] #5)", async () => {
  const { deps, replies } = makeDeps({});
  const handler = installOutboxAdmin.createOutboxAdminHandler(deps);
  await handler.handleOutboxInteraction(makeInteraction(null, "permissions"));
  assert.match(replies[0], /\/start dlc/, "auditul cunoaste canalul DLC, deci hint-ul trebuie sa spuna cum se configureaza");
  assert.match(replies[0], /\/future-release start/, "auditul cunoaste canalul future-release, deci hint-ul trebuie sa indice comanda de setup");
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
    env: { NOTIFICATION_OUTBOX_ENABLED: false, NOTIFICATION_OUTBOX_RECOVERY_VERIFY: false, NOTIFICATION_OUTBOX_RECOVERY_STRICT: false },
    handleInteraction: async (interaction: { commandName?: string }) => { delegated.push(interaction.commandName || ""); }
  };
  installCommandChain(context, [installOutboxAdmin] as object as ChainableCommandModule[]);
  await (context.handleInteraction as (i: unknown, g: unknown[]) => Promise<unknown>)({ commandName: "ping", isChatInputCommand: () => true, guild: { id: "g" } }, []);
  assert.deepEqual(delegated, ["ping"], "comenzile non-outbox sunt delegate mai jos");
});

test("install: citeste flag-urile outbox din env-ul injectat (RuntimeEnv), nu din process.env", async () => {
  const replies: string[] = [];
  const context: Record<string, unknown> = {
    NotificationOutboxModel: { countDocuments: async () => 0, updateMany: async () => ({}) },
    GuildModel: { updateOne: async () => ({ modifiedCount: 1 }) },
    invalidateGuildCache: () => undefined,
    listReplayableDeadLetters: async () => [],
    deleteReplayedDeadLetters: async () => undefined,
    deleteAllReplayPayloads: async () => undefined,
    getGuildSettings: async () => ({ outboxRecoveryVerify: false, notificationDeadLetter: [] }),
    getOutboxPaused: async () => false,
    setOutboxPaused: async () => undefined,
    checkChannelPermissions: async () => null,
    acquireDbLock: async () => "lock-token",
    releaseDbLock: async () => undefined,
    drainOutbox: async () => ({ sent: 0, retried: 0, deadLettered: 0, queued: 0 }),
    safeDefer: async () => undefined,
    safeEdit: async (_interaction: unknown, content: string) => { replies.push(content); return content; },
    formatUserError: (_e: unknown, f: string) => f,
    logger: () => undefined,
    MessageFlags: { Ephemeral: 64 },
    env: { NOTIFICATION_OUTBOX_ENABLED: true, NOTIFICATION_OUTBOX_RECOVERY_VERIFY: true, NOTIFICATION_OUTBOX_RECOVERY_STRICT: true }
  };
  installCommandChain(context, [installOutboxAdmin] as object as ChainableCommandModule[]);
  await (context.handleInteraction as (i: unknown, g: unknown[]) => Promise<unknown>)(makeInteraction(null, "status"), []);
  assert.match(replies[0], /Outbox activat \(global\): \*\*ON\*\*/);
  assert.match(replies[0], /Recovery-verify global: \*\*ON\*\* \| strict: \*\*ON\*\*/);
});

test("isDirectOutboxCommand recunoaste doar /outbox in guild", () => {
  assert.equal(installOutboxAdmin.isDirectOutboxCommand({ commandName: "outbox", isChatInputCommand: () => true, guild: { id: "g" } }), true);
  assert.equal(installOutboxAdmin.isDirectOutboxCommand({ commandName: "set", isChatInputCommand: () => true, guild: { id: "g" } }), false);
  assert.equal(installOutboxAdmin.isDirectOutboxCommand({ commandName: "outbox", isChatInputCommand: () => true, guild: null }), false);
});

