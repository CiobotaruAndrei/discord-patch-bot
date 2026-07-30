import test from "node:test";
import assert from "node:assert/strict";
import type { GuildAuditLogRecord } from "../../features/admin-records/auditLogRepository.js";
import type { GuildConfigBackupRecord } from "../../features/admin-records/configBackupRepository.js";

import type { GuildSettings } from "../../features/guild-config/guildSettingsTypes.js";
import { isHandledCommandError } from "../../features/command-security/commandOutcome.js";

import installBackup from "../../features/command-handlers/backupInteractionHandler.js";
import type {
  BackupDiscordGuild,
  BackupDiscordResource,
  BackupDiscordResourceManager
} from "../../features/admin-records/backupResourceRestoreRuntime.js";
import { createOperationJournalTestModel } from "../operationJournalTestModel.js";

type MongoCall = {
  filter: Record<string, unknown>;
  update: Record<string, unknown> | Array<Record<string, unknown>>;
  options?: Record<string, unknown>;
};

function isRecord(value: object | null): value is Record<string, unknown> {
  return value !== null && !Array.isArray(value);
}

function makeResourceManager(kind: "channel" | "role", ids: string[]): BackupDiscordResourceManager {
  const cache = new Map<string, BackupDiscordResource>();
  for (const id of ids) {
    cache.set(id, { id, name: `existing-${id}`, delete: async () => { cache.delete(id); } });
  }
  let sequence = 0;
  return {
    cache,
    create: async options => {
      const id = `created-${kind}-${++sequence}`;
      const resource = { id, name: options.name, delete: async () => { cache.delete(id); } };
      cache.set(id, resource);
      return resource;
    }
  };
}

function makeDiscordGuild(channelIds: string[] = ["deals-channel"], roleIds: string[] = []): BackupDiscordGuild {
  return {
    id: "guild-1",
    channels: makeResourceManager("channel", channelIds),
    roles: makeResourceManager("role", roleIds)
  };
}

function makeInteraction(
  subcommand: string,
  values: { name?: string; confirm?: boolean } = {},
  guild: BackupDiscordGuild = makeDiscordGuild()
) {
  return {
    id: `interaction-${subcommand}`,
    commandName: "backup",
    guild,
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

function makeAuditModel(auditDocs: GuildAuditLogRecord[]) {
  return {
    create: async (doc: GuildAuditLogRecord) => { auditDocs.push(doc); return doc; },
    find: () => { const chain = { sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => [] }; return chain; }
  };
}

function makeBackupModel(initial: GuildConfigBackupRecord[] = []) {
  const docs: GuildConfigBackupRecord[] = [...initial];
  const model = {
    updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>) => {
      const existing = docs.find(doc => doc.guildId === filter.guildId && doc.name === filter.name);
      const set = (update.$set ?? {}) as Partial<GuildConfigBackupRecord>;
      if (existing) {
        Object.assign(existing, set);
        return { matchedCount: 1, modifiedCount: 1 };
      }
      if (options?.upsert === true) {
        docs.push({ guildId: String(filter.guildId), name: String(filter.name), ...set });
      }
      return { matchedCount: 0, modifiedCount: 0 };
    },
    deleteOne: async (filter: Record<string, unknown>) => {
      const index = docs.findIndex(doc => doc.guildId === filter.guildId && doc.name === filter.name);
      if (index < 0) return { deletedCount: 0 };
      docs.splice(index, 1);
      return { deletedCount: 1 };
    },
    deleteMany: async () => ({ deletedCount: 0 }),
    find: (filter: Record<string, unknown>) => {
      let sorted = docs.filter(doc => doc.guildId === filter.guildId);
      let skipped = 0;
      let limited = Number.POSITIVE_INFINITY;
      const chain = {
        sort: () => {
          sorted = [...sorted].sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
          return chain;
        },
        skip: (count: number) => { skipped = count; return chain; },
        limit: (count: number) => { limited = count; return chain; },
        lean: async () => sorted.slice(skipped, skipped + limited)
      };
      return chain;
    },
    findOne: (filter: Record<string, unknown>) => ({
      lean: async () => docs.find(doc => doc.guildId === filter.guildId && doc.name === filter.name) ?? null
    })
  };
  return { model, docs };
}

function makeHarness(settings: GuildSettings | null, initialBackups: GuildConfigBackupRecord[] = []) {
  const calls: MongoCall[] = [];
  const replies: unknown[] = [];
  const auditDocs: GuildAuditLogRecord[] = [];
  const { model: backupModel, docs: backupDocs } = makeBackupModel(initialBackups);
  const handler = installBackup.createBackupInteractionHandler({
    GuildModel: {
      updateOne: async (filter, update, options) => {
        calls.push({ filter, update, options });
        return { matchedCount: 1, modifiedCount: 1 };
      }
    },
    GuildAuditLogModel: makeAuditModel(auditDocs),
    GuildConfigBackupModel: backupModel,
    OperationJournalModel: createOperationJournalTestModel(),
    getGuildSettings: async () => settings,
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload) => { replies.push(payload); return payload; },
    formatUserError: (_err, fallback) => fallback,
    logger: () => undefined,
    MessageFlags: { Ephemeral: 64 }
  });
  return { handler, calls, replies, auditDocs, backupDocs };
}

const PROD_BACKUP: GuildConfigBackupRecord = {
  guildId: "guild-1",
  name: "prod",
  createdBy: "user-1",
  createdAt: new Date(),
  snapshot: { subscribed: true, discountChannelId: "deals-channel" }
};

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
  const { handler, calls, replies, backupDocs } = makeHarness({ _id: "guild-1" }, [PROD_BACKUP]);

  await handler.handleBackupInteraction(makeInteraction("load", { name: "prod", confirm: false }));

  assert.equal(calls.length, 0);
  assert.equal(backupDocs.length, 1, "backup-ul ramane neatins");
  assert.match(String(replies[0]), /confirm:true/);
});

test("/backup add salveaza backup-ul in colectia guildConfigBackups si auditul serverului", async () => {
  const { handler, calls, replies, auditDocs, backupDocs } = makeHarness({
    _id: "guild-1",
    subscribed: true,
    notificationChannelId: "updates-channel"
  });

  await handler.handleBackupInteraction(makeInteraction("add", { name: "Prod Backup" }));

  assert.equal(calls.length, 0, "salvarea nu mai scrie pe documentul guild");
  assert.equal(backupDocs.length, 1, "backup-ul e un document in colectia dedicata");
  assert.equal(backupDocs[0].guildId, "guild-1");
  assert.equal(backupDocs[0].name, "prod-backup");
  assert.equal((backupDocs[0].snapshot ?? {}).subscribed, true);
  assert.equal(auditDocs.length, 1, "auditul server-log e un document in colectia guildAuditLogs");
  assert.equal(auditDocs[0].kind, "server");
  assert.match(String(auditDocs[0].action), /backup_add/);
  assert.match(String(replies[0]), /prod-backup/);
});

test("/backup load cu confirmare restaureaza snapshot-ul pe guild si scrie server-log in colectia guildAuditLogs (R5 #7 + #6 audit split)", async () => {
  const { handler, calls, replies, auditDocs } = makeHarness({ _id: "guild-1", subscribed: false }, [PROD_BACKUP]);

  await handler.handleBackupInteraction(makeInteraction("load", { name: "prod", confirm: true }));

  assert.equal(calls.length, 1, "restore-ul = un singur updateOne pe documentul guild");
  const restore = calls[0].update as { $set?: Record<string, unknown>; $unset?: Record<string, string>; $push?: Record<string, unknown> };
  assert.deepEqual(restore.$set, { subscribed: true, discountChannelId: "deals-channel" });
  assert.equal(restore.$unset?.youtubeChannelRoutes, "", "restore-ul curata si cheile absente din snapshot");
  assert.equal(restore.$push, undefined, "auditul nu mai e $push pe documentul guild");
  assert.match(String(auditDocs[0].action), /backup_load/);
  assert.match(String(replies[0]), /incarcat/);
});

test("/backup load: daca scrierea de restore esueaza, NIMIC nu e restaurat si comanda raporteaza eroare (R5 #7)", async () => {
  const replies: unknown[] = [];
  let writes = 0;
  const auditDocs: GuildAuditLogRecord[] = [];
  const { model: backupModel } = makeBackupModel([PROD_BACKUP]);
  const handler = installBackup.createBackupInteractionHandler({
    GuildModel: {
      updateOne: async () => {
        writes++;
        throw new Error("mongo down");
      }
    },
    GuildAuditLogModel: makeAuditModel(auditDocs),
    GuildConfigBackupModel: backupModel,
    OperationJournalModel: createOperationJournalTestModel(),
    getGuildSettings: async () => ({ _id: "guild-1" }),
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload) => { replies.push(payload); return payload; },
    formatUserError: (_err, fallback) => fallback,
    logger: () => undefined,
    MessageFlags: { Ephemeral: 64 }
  });

  const result = await handler.handleBackupInteraction(makeInteraction("load", { name: "prod", confirm: true }));

  assert.equal(writes, 1, "o singura scriere pe guild incercata");
  assert.equal(auditDocs.length, 0, "daca scrierea principala esueaza, nu se scrie audit pentru o restaurare care nu a avut loc");
  assert.match(JSON.stringify(replies.at(-1)), /Eroare/, "userul afla ca operatia a esuat integral, nu primeste un succes partial");
  assert.equal(isHandledCommandError(result), true, "esecul scrierii de restore e o eroare de comanda reala");
});

test("/backup preview foloseste planul real fara sa creeze resurse Discord", async () => {
  const guild = makeDiscordGuild([], []);
  const { handler, replies } = makeHarness({ _id: "guild-1" }, [{
    ...PROD_BACKUP,
    snapshot: {
      discountChannelId: "deleted-channel",
      discountRoleId: "deleted-role",
      youtubeChannelRoutes: [{ channelId: "youtube-source", discordChannelIds: ["deleted-channel"] }]
    }
  }]);

  await handler.handleBackupInteraction(makeInteraction("preview", { name: "prod" }, guild));

  assert.equal([...guild.channels.cache.values()].length, 0);
  assert.equal([...guild.roles.cache.values()].length, 0);
  assert.match(JSON.stringify(replies.at(-1)), /DE CREAT/);
  assert.match(JSON.stringify(replies.at(-1)), /youtubeChannelRoutes\[0\]\.discordChannelIds\[0\]/);
});

test("/backup load creeaza o singura resursa pentru ID-ul partajat si remapeaza top-level plus rutele YouTube", async () => {
  const guild = makeDiscordGuild([], []);
  const backup: GuildConfigBackupRecord = {
    ...PROD_BACKUP,
    snapshot: {
      discountChannelId: "deleted-channel",
      discountRoleId: "deleted-role",
      youtubeChannelRoutes: [{ channelId: "youtube-source", discordChannelIds: ["deleted-channel", "deleted-channel"] }]
    }
  };
  const { handler, calls, replies } = makeHarness({ _id: "guild-1" }, [backup]);

  await handler.handleBackupInteraction(makeInteraction("load", { name: "prod", confirm: true }, guild));

  const channels = [...guild.channels.cache.values()];
  const roles = [...guild.roles.cache.values()];
  assert.equal(channels.length, 1, "ID-ul comun este creat o singura data");
  assert.equal(roles.length, 1);
  const update = calls[0].update;
  const set = "$set" in update ? update.$set : undefined;
  assert.ok(set && typeof set === "object" && isRecord(set));
  assert.equal(set.discountChannelId, channels[0].id);
  const routes = set.youtubeChannelRoutes;
  assert.ok(Array.isArray(routes));
  const route = routes[0];
  assert.ok(route && typeof route === "object" && "discordChannelIds" in route);
  assert.deepEqual(route.discordChannelIds, [channels[0].id, channels[0].id]);
  assert.match(JSON.stringify(replies.at(-1)), /Resurse Discord create: 2/);
});

test("/backup delete sterge documentul din colectia guildConfigBackups si scrie server-log (R5 #7 + #6 audit split)", async () => {
  const { handler, calls, replies, auditDocs, backupDocs } = makeHarness({ _id: "guild-1" }, [PROD_BACKUP]);

  await handler.handleBackupInteraction(makeInteraction("delete", { name: "prod", confirm: true }));

  assert.equal(calls.length, 0, "delete-ul nu atinge documentul guild");
  assert.equal(backupDocs.length, 0, "documentul de backup e sters din colectia dedicata");
  assert.match(String(auditDocs[0].action), /backup_delete/);
  assert.match(String(replies[0]), /sters/);
});

test("/backup delete pentru un backup inexistent raspunde 'Nu exista' pe baza deletedCount, fara audit fantoma", async () => {
  const { handler, replies, auditDocs } = makeHarness({ _id: "guild-1" });

  await handler.handleBackupInteraction(makeInteraction("delete", { name: "lipsa", confirm: true }));

  assert.match(JSON.stringify(replies.at(-1)), /Nu exista/);
  assert.equal(auditDocs.length, 0, "fara audit fantoma pentru un delete care nu a sters nimic");
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

test("/add backup (verb in fata) ruteaza la handleAdd si scrie in colectia guildConfigBackups", async () => {
  const { handler, replies, auditDocs, backupDocs } = makeHarness({
    _id: "guild-1",
    subscribed: true,
    notificationChannelId: "updates-channel"
  });
  const verb = { ...makeInteraction("backup", { name: "Prod Backup" }), commandName: "add" };
  await handler.handleBackupInteraction(verb);
  assert.equal(backupDocs.length, 1, "/add backup deriva actiunea add din commandName si salveaza in colectia dedicata");
  assert.equal(backupDocs[0].name, "prod-backup");
  assert.equal(auditDocs.length, 1, "auditul server-log e un document in colectia guildAuditLogs");
  assert.equal(auditDocs[0].kind, "server");
  assert.match(String(auditDocs[0].action), /backup_add/);
  assert.match(String(replies[0]), /prod-backup/);
});
