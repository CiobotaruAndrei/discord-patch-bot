import test from "node:test";
import assert from "node:assert/strict";

import type { GuildSettings } from "../types";
import { isHandledCommandError } from "../features/command-security/commandOutcome";

const installBackup = require("../features/command-handlers/backupInteractionHandler") as typeof import("../features/command-handlers/backupInteractionHandler");

type MongoCall = {
  filter: Record<string, unknown>;
  update: Record<string, unknown> | Array<Record<string, unknown>>;
  options?: Record<string, unknown>;
};

function makeInteraction(subcommand: string, values: { name?: string; confirm?: boolean } = {}) {
  return {
    commandName: "backup",
    guild: { id: "guild-1" },
    user: { id: "user-1" },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    options: {
      getSubcommand: () => subcommand,
      getString: (name: string) => name === "name" ? values.name ?? null : null,
      getBoolean: (name: string) => name === "confirm" ? values.confirm ?? null : null
    },
    reply: async (payload: unknown) => payload,
    followUp: async (payload: unknown) => payload
  };
}

function makeHarness(settings: GuildSettings | null) {
  const calls: MongoCall[] = [];
  const replies: unknown[] = [];
  const invalidated: string[] = [];
  const handler = installBackup.createBackupInteractionHandler({
    GuildModel: {
      updateOne: async (filter, update, options) => {
        calls.push({ filter, update, options });
        return { matchedCount: 1, modifiedCount: 1 };
      }
    },
    getGuildSettings: async () => settings,
    invalidateGuildCache: guildId => { invalidated.push(guildId); },
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload) => { replies.push(payload); return payload; },
    formatUserError: (_err, fallback) => fallback,
    logger: () => undefined,
    MessageFlags: { Ephemeral: 64 }
  });
  return { handler, calls, replies, invalidated };
}

test("/backup preview arata setarile schimbate si resursele Discord restaurate", () => {
  const preview = installBackup.renderBackupPreview({
    name: "prod",
    createdBy: "user-1",
    createdAt: new Date(),
    snapshot: {
      subscribed: true,
      notificationChannelId: "updates-channel",
      notificationRoleId: "updates-role"
    }
  }, {
    _id: "guild-1",
    subscribed: false
  });

  assert.match(preview, /Preview backup `prod`/);
  assert.match(preview, /`subscribed`/);
  assert.match(preview, /<#updates-channel>/);
  assert.match(preview, /<@&updates-role>/);
});

test("/backup load cere confirmare si nu scrie in Mongo fara confirm:true", async () => {
  const settings: GuildSettings = {
    _id: "guild-1",
    configBackups: [{
      name: "prod",
      createdBy: "user-1",
      createdAt: new Date(),
      snapshot: { subscribed: true }
    }]
  };
  const { handler, calls, replies } = makeHarness(settings);

  await handler.handleBackupInteraction(makeInteraction("load", { name: "prod", confirm: false }));

  assert.equal(calls.length, 0);
  assert.match(String(replies[0]), /confirm:true/);
});

test("/backup add salveaza backup-ul si auditul serverului", async () => {
  const { handler, calls, replies, invalidated } = makeHarness({
    _id: "guild-1",
    subscribed: true,
    notificationChannelId: "updates-channel"
  });

  await handler.handleBackupInteraction(makeInteraction("add", { name: "Prod Backup" }));

  assert.equal(calls.length, 2, "salvarea atomica (1 op) + auditul server-log (1 op)");
  assert.match(JSON.stringify(calls[0].update), /configBackups/);
  assert.match(JSON.stringify(calls[1].update), /serverAuditLog/);
  assert.deepEqual(invalidated, ["guild-1"]);
  assert.match(String(replies[0]), /prod-backup/);
});

test("/backup load cu confirmare restaureaza snapshot-ul si scrie server-log intr-o singura scriere atomica (R5 #7)", async () => {
  const settings: GuildSettings = {
    _id: "guild-1",
    subscribed: false,
    configBackups: [{
      name: "prod",
      createdBy: "user-1",
      createdAt: new Date(),
      snapshot: { subscribed: true, discountChannelId: "deals-channel" }
    }]
  };
  const { handler, calls, replies, invalidated } = makeHarness(settings);

  await handler.handleBackupInteraction(makeInteraction("load", { name: "prod", confirm: true }));

  assert.equal(calls.length, 1, "restore + audit = un singur updateOne (unit-of-work atomic pe acelasi document)");
  const restore = calls[0].update as { $set?: Record<string, unknown>; $unset?: Record<string, string>; $push?: Record<string, unknown> };
  assert.deepEqual(restore.$set, { subscribed: true, discountChannelId: "deals-channel" });
  assert.equal(restore.$unset?.youtubeChannelRoutes, "", "restore-ul curata si cheile absente din snapshot");
  assert.match(JSON.stringify(restore.$push), /serverAuditLog/, "auditul face parte din aceeasi scriere");
  assert.match(JSON.stringify(restore.$push), /backup_load/);
  assert.deepEqual(invalidated, ["guild-1"]);
  assert.match(String(replies[0]), /incarcat/);
});

test("/backup load: daca scrierea combinata esueaza, NIMIC nu e restaurat si comanda raporteaza eroare (atomic, R5 #7)", async () => {
  const settings: GuildSettings = {
    _id: "guild-1",
    configBackups: [{ name: "prod", createdBy: "user-1", createdAt: new Date(), snapshot: { subscribed: true } }]
  };
  const invalidated: string[] = [];
  const replies: unknown[] = [];
  let writes = 0;
  const handler = installBackup.createBackupInteractionHandler({
    GuildModel: {
      updateOne: async () => {
        writes++;
        throw new Error("mongo down");
      }
    },
    getGuildSettings: async () => settings,
    invalidateGuildCache: guildId => { invalidated.push(guildId); },
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload) => { replies.push(payload); return payload; },
    formatUserError: (_err, fallback) => fallback,
    logger: () => undefined,
    MessageFlags: { Ephemeral: 64 }
  });

  const result = await handler.handleBackupInteraction(makeInteraction("load", { name: "prod", confirm: true }));

  assert.equal(writes, 1, "o singura scriere combinata incercata");
  assert.deepEqual(invalidated, [], "cache-ul nu e invalidat cand scrierea atomica a esuat (nimic nu s-a schimbat)");
  assert.match(String(replies.at(-1)), /Eroare/, "userul afla ca operatia a esuat integral, nu primeste un succes partial");
  assert.equal(isHandledCommandError(result), true, "esecul scrierii atomice e o eroare de comanda reala");
});

test("/backup delete sterge backup-ul si scrie server-log intr-o singura scriere atomica, cu filtrul pe existenta (R5 #7)", async () => {
  const { handler, calls, replies, invalidated } = makeHarness({ _id: "guild-1" });

  await handler.handleBackupInteraction(makeInteraction("delete", { name: "prod", confirm: true }));

  assert.equal(calls.length, 1, "delete + audit = un singur updateOne");
  assert.equal((calls[0].filter as Record<string, unknown>)["configBackups.name"], "prod", "filtrul cere existenta backup-ului, ca auditul sa nu se scrie pentru un delete inexistent");
  const update = calls[0].update as { $pull?: Record<string, unknown>; $push?: Record<string, unknown> };
  assert.match(JSON.stringify(update.$pull), /prod/);
  assert.match(JSON.stringify(update.$push), /backup_delete/);
  assert.deepEqual(invalidated, ["guild-1"]);
  assert.match(String(replies[0]), /sters/);
});

test("/backup delete pentru un backup inexistent raspunde 'Nu exista' pe baza matchedCount, fara audit fantoma", async () => {
  const replies: unknown[] = [];
  const handler = installBackup.createBackupInteractionHandler({
    GuildModel: {
      updateOne: async () => ({ matchedCount: 0, modifiedCount: 0 })
    },
    getGuildSettings: async () => ({ _id: "guild-1" }),
    invalidateGuildCache: () => undefined,
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload) => { replies.push(payload); return payload; },
    formatUserError: (_err, fallback) => fallback,
    logger: () => undefined,
    MessageFlags: { Ephemeral: 64 }
  });

  await handler.handleBackupInteraction(makeInteraction("delete", { name: "lipsa", confirm: true }));

  assert.match(String(replies.at(-1)), /Nu exista/);
});

test("/backup preview arata explicit ce setari se vor STERGE la load (exista acum, lipsesc din backup) (R[P2] #1)", () => {
  const preview = installBackup.renderBackupPreview(
    { name: "vechi", createdBy: "u1", createdAt: new Date(), snapshot: { subscribed: true } },
    { _id: "guild-1", subscribed: false, youtubeChannelRoutes: [{ channelId: "c", discordChannelIds: ["d"] }], priceAlerts: [{ gameKey: "x", gameName: "X", threshold: 5, currency: "EUR" }] }
  );
  assert.match(preview, /se vor STERGE/i, "preview-ul are o sectiune de stergeri");
  assert.match(preview, /youtubeChannelRoutes/, "cheia care exista acum dar lipseste din backup e listata ca stearsa");
  assert.match(preview, /priceAlerts/, "si alertele de pret adaugate dupa backup sunt anuntate ca sterse");
});

test("/add backup (verb in fata) ruteaza la handleAdd si scrie configBackups", async () => {
  const { handler, calls, invalidated, replies } = makeHarness({
    _id: "guild-1",
    subscribed: true,
    notificationChannelId: "updates-channel"
  });
  const verb = { ...makeInteraction("backup", { name: "Prod Backup" }), commandName: "add" };
  await handler.handleBackupInteraction(verb);
  assert.match(JSON.stringify(calls[0].update), /configBackups/, "/add backup deriva actiunea add din commandName");
  assert.deepEqual(invalidated, ["guild-1"]);
  assert.match(String(replies[0]), /prod-backup/);
});
