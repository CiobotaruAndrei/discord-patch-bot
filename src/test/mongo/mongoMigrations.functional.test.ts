import test from "node:test";
import { ALL_MIGRATIONS as REGISTRY_MIGRATIONS } from "../../infra/mongo/migrations/registry.js";
import assert from "node:assert/strict";
import attachMigrations from "../../infra/mongo/migrations.js";

interface GuildDoc {
  _id: string;
  enabledStores?: string[];
  maxAbsolutePrice?: number;
  enabledGames?: string[];
  seenDiscounts?: string[];
  seen?: Record<string, string[]>;
  botAuditLog?: Array<Record<string, unknown>>;
  serverAuditLog?: Array<Record<string, unknown>>;
  configBackups?: Array<Record<string, unknown>>;
  suggestedCommands?: Array<Record<string, unknown>>;
  youtubeErrors?: Array<Record<string, unknown>>;
  notificationDeadLetter?: Array<Record<string, unknown>>;
  moderationWarnBanLimit?: number;
  youtubeNotificationsEnabled?: boolean;
  threatProtectionEnabled?: boolean;
  moderationTimeouts?: Array<Record<string, unknown>>;
}

type MigrationStateDoc = {
  _id: string;
  lastApplied?: number;
  lastAppliedAt?: Date;
};

interface UpdateManyCall {
  collection: string;
  filter: unknown;
  update: unknown;
}

interface FakeMigrationOverrides {
  acquireDbLock?: () => Promise<string | null>;
  initialMigrationState?: MigrationStateDoc | null;
}

type MigrationContext = Parameters<typeof attachMigrations>[0];
type MigrationCollection = ReturnType<MigrationContext["mongoose"]["connection"]["collection"]>;

function fakeCollection(impl: object): MigrationCollection {
  return {
    async updateMany() { return {}; },
    async updateOne() { return {}; },
    async findOne() { return null; },
    async bulkWrite() { return {}; },
    async *find() {},
    ...impl
  };
}

function createFakeMigrationContext(overrides: FakeMigrationOverrides = {}) {
  const updateManyCalls: UpdateManyCall[] = [];
  const releaseCalls: Array<{ name: string; token: string }> = [];
  const guilds: GuildDoc[] = [{
    _id: "guild-1",
    moderationWarnBanLimit: 3,
    youtubeNotificationsEnabled: true,
    threatProtectionEnabled: true,
    moderationTimeouts: [{ userId: "u9", appliedAt: new Date("2025-05-01T00:00:00.000Z") }],
    seenDiscounts: Array.from({ length: 520 }, (_, index) => `deal-${index}`),
    seen: { cs2: ["u-1", "u-2"], dota: ["u-3"] },
    botAuditLog: [{ userId: "u1", command: "/set mode", result: "Access granted.", serverId: "guild-1", at: new Date("2025-01-01T00:00:00.000Z") }],
    serverAuditLog: [{ userId: "u1", action: "backup_add", details: "Saved backup prod", serverId: "guild-1", at: new Date("2025-02-01T00:00:00.000Z") }],
    configBackups: [
      { name: "prod", createdBy: "u1", createdAt: new Date("2025-03-01T00:00:00.000Z"), snapshot: { subscribed: true } },
      { createdBy: "ghost" }
    ],
    suggestedCommands: [
      { commandName: "calendar", description: "arata calendarul", createdBy: "u1", createdAt: new Date("2025-04-01T00:00:00.000Z") },
      { description: "fara nume" }
    ],
    youtubeErrors: [
      { channelId: "UCabc", channelName: "Canal", message: "feed indisponibil", at: new Date("2025-05-01T00:00:00.000Z") }
    ],
    notificationDeadLetter: [
      { kind: "update", itemId: "u-1", title: "patch", channelId: "c1", dedupeKey: "dk1", reason: "max-attempts", attempts: 5, failedAt: new Date("2025-06-01T00:00:00.000Z") },
      { kind: "invalid", itemId: "x" }
    ]
  }];
  let migrationState: MigrationStateDoc | null = overrides.initialMigrationState ?? null;

  const guildCollection = {
    async updateMany(filter: unknown, update: unknown) {
      updateManyCalls.push({ collection: "guilds", filter, update });
      if (Array.isArray(update)) {
        for (const stage of update) {
          const setStage = (stage as { $set?: Record<string, unknown> }).$set;
          if (!setStage || !setStage.seenDiscounts) continue;
          const sliceOp = (setStage.seenDiscounts as { $slice?: unknown[] }).$slice;
          if (!Array.isArray(sliceOp)) continue;
          const sliceCount = sliceOp[1] as number;
          for (const guild of guilds) {
            if (Array.isArray(guild.seenDiscounts) && guild.seenDiscounts.length > 500) {
              guild.seenDiscounts = guild.seenDiscounts.slice(sliceCount);
            }
          }
        }
      }
      return { modifiedCount: 1 };
    },
    find(filter?: { seen?: unknown; seenDiscounts?: unknown; configBackups?: unknown; suggestedCommands?: unknown; youtubeErrors?: unknown; notificationDeadLetter?: unknown; $or?: unknown }) {
      if (filter && "notificationDeadLetter" in filter) {
        const matching = guilds.filter(guild => Array.isArray(guild.notificationDeadLetter));
        return {
          async toArray() { return matching.map(guild => ({ _id: guild._id, notificationDeadLetter: guild.notificationDeadLetter })); },
          async *[Symbol.asyncIterator]() {
            for (const guild of matching) yield { _id: guild._id, notificationDeadLetter: guild.notificationDeadLetter };
          }
        };
      }
      if (filter && "youtubeErrors" in filter) {
        const matching = guilds.filter(guild => Array.isArray(guild.youtubeErrors));
        return {
          async toArray() { return matching.map(guild => ({ _id: guild._id, youtubeErrors: guild.youtubeErrors })); },
          async *[Symbol.asyncIterator]() {
            for (const guild of matching) yield { _id: guild._id, youtubeErrors: guild.youtubeErrors };
          }
        };
      }
      if (filter && "suggestedCommands" in filter) {
        const matching = guilds.filter(guild => Array.isArray(guild.suggestedCommands));
        return {
          async toArray() { return matching.map(guild => ({ _id: guild._id, suggestedCommands: guild.suggestedCommands })); },
          async *[Symbol.asyncIterator]() {
            for (const guild of matching) yield { _id: guild._id, suggestedCommands: guild.suggestedCommands };
          }
        };
      }
      if (filter && "configBackups" in filter) {
        const matching = guilds.filter(guild => Array.isArray(guild.configBackups));
        return {
          async toArray() { return matching.map(guild => ({ _id: guild._id, configBackups: guild.configBackups })); },
          async *[Symbol.asyncIterator]() {
            for (const guild of matching) yield { _id: guild._id, configBackups: guild.configBackups };
          }
        };
      }
      if (filter && "$or" in filter) {
        const clauses = Array.isArray(filter.$or) ? (filter.$or as Array<Record<string, unknown>>) : [];
        const clauseFields = clauses.flatMap(clause => Object.keys(clause));
        if (clauseFields.some(field => field.startsWith("youtube"))) {
          const matching = guilds.filter(guild => Array.isArray(guild.youtubeErrors) || guild.youtubeNotificationsEnabled !== undefined);
          return {
            async toArray() { return matching.map(guild => ({ _id: guild._id, youtubeNotificationsEnabled: guild.youtubeNotificationsEnabled })); },
            async *[Symbol.asyncIterator]() {
              for (const guild of matching) yield { _id: guild._id, youtubeNotificationsEnabled: guild.youtubeNotificationsEnabled };
            }
          };
        }
        if (clauseFields.some(field => field.startsWith("threatProtection") || field.startsWith("newAccountAlert"))) {
          const matching = guilds.filter(guild => guild.threatProtectionEnabled !== undefined);
          return {
            async toArray() { return matching.map(guild => ({ _id: guild._id, threatProtectionEnabled: guild.threatProtectionEnabled })); },
            async *[Symbol.asyncIterator]() {
              for (const guild of matching) yield { _id: guild._id, threatProtectionEnabled: guild.threatProtectionEnabled };
            }
          };
        }
        if (clauseFields.some(field => field.startsWith("moderation"))) {
          const matching = guilds.filter(guild => guild.moderationWarnBanLimit !== undefined || Array.isArray(guild.moderationTimeouts));
          return {
            async toArray() {
              return matching.map(guild => ({ _id: guild._id, moderationWarnBanLimit: guild.moderationWarnBanLimit, moderationTimeouts: guild.moderationTimeouts }));
            },
            async *[Symbol.asyncIterator]() {
              for (const guild of matching) {
                yield { _id: guild._id, moderationWarnBanLimit: guild.moderationWarnBanLimit, moderationTimeouts: guild.moderationTimeouts };
              }
            }
          };
        }
        const matching = guilds.filter(guild => Array.isArray(guild.botAuditLog) || Array.isArray(guild.serverAuditLog));
        return {
          async toArray() { return matching.map(guild => ({ _id: guild._id, botAuditLog: guild.botAuditLog, serverAuditLog: guild.serverAuditLog })); },
          async *[Symbol.asyncIterator]() {
            for (const guild of matching) yield { _id: guild._id, botAuditLog: guild.botAuditLog, serverAuditLog: guild.serverAuditLog };
          }
        };
      }
      if (filter && "seen" in filter) {
        const matching = guilds.filter(guild => guild.seen && Object.keys(guild.seen).length > 0);
        return {
          async toArray() { return matching.map(guild => ({ _id: guild._id, seen: guild.seen })); },
          async *[Symbol.asyncIterator]() {
            for (const guild of matching) yield { _id: guild._id, seen: guild.seen };
          }
        };
      }
      const matching = guilds.filter(guild => Array.isArray(guild.seenDiscounts) && guild.seenDiscounts.length > 0);
      return {
        async toArray() {
          return matching.map(guild => ({ _id: guild._id, seenDiscounts: guild.seenDiscounts }));
        },
        async *[Symbol.asyncIterator]() {
          for (const guild of matching) yield { _id: guild._id, seenDiscounts: guild.seenDiscounts };
        }
      };
    },
    async updateOne(filter: { _id?: string }, update: { $set?: Partial<GuildDoc>; $unset?: Record<string, string> }) {
      const doc = guilds.find(guild => guild._id === filter._id);
      if (doc && update.$set) Object.assign(doc, update.$set);
      if (doc && update.$unset) {
        for (const key of Object.keys(update.$unset)) Reflect.deleteProperty(doc, key);
      }
      return { modifiedCount: doc ? 1 : 0 };
    }
  };

  const systemCollection = {
    async findOne(filter: { _id: string }) {
      return migrationState && migrationState._id === filter._id ? migrationState : null;
    },
    async updateOne(filter: { _id: string }, update: { $set?: Partial<MigrationStateDoc> }) {
      migrationState = { _id: filter._id, ...migrationState, ...update.$set };
      return { upsertedCount: 1 };
    }
  };

  const seenDiscountBulkOps: unknown[] = [];
  const guildSeenDiscountCollection = {
    async bulkWrite(ops: unknown[]) {
      seenDiscountBulkOps.push(...ops);
      return { upsertedCount: ops.length };
    }
  };
  const seenUpdateBulkOps: unknown[] = [];
  const guildSeenUpdateCollection = {
    async bulkWrite(ops: unknown[]) {
      seenUpdateBulkOps.push(...ops);
      return { upsertedCount: ops.length };
    }
  };
  const auditBulkOps: unknown[] = [];
  const guildAuditLogCollection = {
    async bulkWrite(ops: unknown[]) {
      auditBulkOps.push(...ops);
      return { upsertedCount: ops.length };
    }
  };
  const backupBulkOps: unknown[] = [];
  const guildConfigBackupCollection = {
    async bulkWrite(ops: unknown[]) {
      backupBulkOps.push(...ops);
      return { upsertedCount: ops.length };
    }
  };
  const suggestedBulkOps: unknown[] = [];
  const guildSuggestedCommandCollection = {
    async bulkWrite(ops: unknown[]) {
      suggestedBulkOps.push(...ops);
      return { upsertedCount: ops.length };
    }
  };
  const youtubeErrorBulkOps: unknown[] = [];
  const guildYoutubeErrorCollection = {
    async bulkWrite(ops: unknown[]) {
      youtubeErrorBulkOps.push(...ops);
      return { upsertedCount: ops.length };
    }
  };
  const youtubeStateUpdates: Array<{ filter: Record<string, unknown>; update: Record<string, unknown> }> = [];
  const guildYoutubeStateCollection = {
    async updateOne(filter: Record<string, unknown>, update: Record<string, unknown>) {
      youtubeStateUpdates.push({ filter, update });
      return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
    }
  };
  const moderationUpdates: Array<{ filter: Record<string, unknown>; update: Record<string, unknown> }> = [];
  const guildModerationCollection = {
    async updateOne(filter: Record<string, unknown>, update: Record<string, unknown>) {
      moderationUpdates.push({ filter, update });
      return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
    }
  };
  const playerCountWatchUpdates: Array<{ filter: Record<string, unknown>; update: Record<string, unknown> }> = [];
  const guildPlayerCountWatchCollection = {
    async updateOne(filter: Record<string, unknown>, update: Record<string, unknown>) {
      playerCountWatchUpdates.push({ filter, update });
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    }
  };
  const securityUpdates: Array<{ filter: Record<string, unknown>; update: Record<string, unknown> }> = [];
  const guildSecurityCollection = {
    async updateOne(filter: Record<string, unknown>, update: Record<string, unknown>) {
      securityUpdates.push({ filter, update });
      return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
    }
  };
  const deadLetterBulkOps: unknown[] = [];
  const guildDeadLetterCollection = {
    async bulkWrite(ops: unknown[]) {
      deadLetterBulkOps.push(...ops);
      return { upsertedCount: ops.length };
    }
  };

  const connection = {
    db: {},
    collection(name: string): MigrationCollection {
      if (name === "guilds") return fakeCollection(guildCollection);
      if (name === "system") return fakeCollection(systemCollection);
      if (name === "guildSeenDiscounts") return fakeCollection(guildSeenDiscountCollection);
      if (name === "guildSeenUpdates") return fakeCollection(guildSeenUpdateCollection);
      if (name === "guildAuditLogs") return fakeCollection(guildAuditLogCollection);
      if (name === "guildConfigBackups") return fakeCollection(guildConfigBackupCollection);
      if (name === "guildSuggestedCommands") return fakeCollection(guildSuggestedCommandCollection);
      if (name === "guildYoutubeErrors") return fakeCollection(guildYoutubeErrorCollection);
      if (name === "guildDeadLetters") return fakeCollection(guildDeadLetterCollection);
      if (name === "guildModeration") return fakeCollection(guildModerationCollection);
      if (name === "guildYoutubeState") return fakeCollection(guildYoutubeStateCollection);
      if (name === "guildSecurity") return fakeCollection(guildSecurityCollection);
      if (name === "guildPlayerCountWatch") return fakeCollection(guildPlayerCountWatchCollection);
      if (name === "notificationOutbox") return fakeCollection([]);
      throw new Error(`Unexpected collection ${name}`);
    }
  };

  const context: MigrationContext = {
    mongoose: { connection },
    acquireDbLock: overrides.acquireDbLock || (async () => "migration-lock-token"),
    releaseDbLock: async (name: string, token: string) => {
      releaseCalls.push({ name, token });
    }
  };

  attachMigrations(context);
  const { runMigrations, ALL_MIGRATIONS } = context;
  if (!runMigrations || !ALL_MIGRATIONS) {
    throw new Error("attachMigrations trebuie sa ataseze runMigrations + ALL_MIGRATIONS");
  }
  const runtime = Object.assign(context, { runMigrations, ALL_MIGRATIONS });
  return { context: runtime, guilds, get migrationState() { return migrationState; }, updateManyCalls, releaseCalls, seenDiscountBulkOps, seenUpdateBulkOps, auditBulkOps, backupBulkOps, suggestedBulkOps, youtubeErrorBulkOps, deadLetterBulkOps, moderationUpdates, youtubeStateUpdates, securityUpdates, playerCountWatchUpdates };
}

const ALL_MIGRATION_IDS = REGISTRY_MIGRATIONS.map(migration => migration.id);
const LAST_MIGRATION_ID = ALL_MIGRATION_IDS[ALL_MIGRATION_IDS.length - 1];

test("Mongo migrations apply pending migrations and release the lock", async () => {
  const fixture = createFakeMigrationContext();
  const logs: Array<{ level: string; context: string; message: string }> = [];

  const result = await fixture.context.runMigrations((level: string, context: string, message: string) => {
    logs.push({ level, context, message });
  });

  assert.deepEqual(result.applied, ALL_MIGRATION_IDS, "se aplica exact migrarile din registru, in ordinea lor");
  assert.equal(result.skipped, 0);
  assert.equal(
    fixture.updateManyCalls.length,
    9,
    "m1-m4 + m7 folosesc updateMany, m5 si m6 folosesc find + bulkWrite, m16 mai face cate un updateMany de $unset pentru fiecare dintre cele trei domenii, iar m17 unul pentru starea de player-count"
  );
  const m4Call = fixture.updateManyCalls[3];
  assert.deepEqual(m4Call.filter, { "seenDiscounts.500": { $exists: true } });
  assert.ok(Array.isArray(m4Call.update), "m4 trebuie sa foloseasca aggregation pipeline (array)");
  assert.deepEqual(
    (m4Call.update as Array<{ $set: { seenDiscounts: { $slice: unknown[] } } }>)[0].$set.seenDiscounts.$slice,
    ["$seenDiscounts", -300]
  );
  assert.equal(fixture.guilds[0].seenDiscounts?.length, 300);
  assert.equal(fixture.guilds[0].seenDiscounts?.[0], "deal-220");
  assert.equal(fixture.seenDiscountBulkOps.length, 300, "m5 backfilleaza cele 300 hash-uri ramase in colectia dedicata");
  const firstBackfill = fixture.seenDiscountBulkOps[0] as { updateOne: { filter: { guildId: string; dealHash: string }; upsert: boolean } };
  assert.deepEqual(firstBackfill.updateOne.filter, { guildId: "guild-1", dealHash: "deal-220" });
  assert.equal(firstBackfill.updateOne.upsert, true);
  assert.equal(fixture.seenUpdateBulkOps.length, 3, "m6 backfilleaza cele 3 perechi (gameKey, updateId) din map-ul seen");
  const firstSeenUpdate = fixture.seenUpdateBulkOps[0] as { updateOne: { filter: { guildId: string; gameKey: string; updateId: string }; upsert: boolean } };
  assert.deepEqual(firstSeenUpdate.updateOne.filter, { guildId: "guild-1", gameKey: "cs2", updateId: "u-1" });
  assert.equal(firstSeenUpdate.updateOne.upsert, true);
  const m7Call = fixture.updateManyCalls[4];
  assert.deepEqual(m7Call.filter, { $or: [{ seen: { $exists: true } }, { seenDiscounts: { $exists: true } }] });
  assert.deepEqual(m7Call.update, { $unset: { seen: "", seenDiscounts: "" } });
  assert.equal(fixture.auditBulkOps.length, 2, "m8 muta intrarea bot + intrarea server in colectia guildAuditLogs");
  const auditOps = fixture.auditBulkOps as Array<{ updateOne: { filter: { guildId: string; kind: string }; upsert: boolean } }>;
  assert.deepEqual(auditOps.map(op => op.updateOne.filter.kind).sort(), ["bot", "server"]);
  assert.equal(auditOps[0].updateOne.filter.guildId, "guild-1");
  assert.equal(auditOps[0].updateOne.upsert, true, "backfill-ul e idempotent (upsert pe continutul intrarii)");
  assert.equal(fixture.guilds[0].botAuditLog, undefined, "m8 curata campul botAuditLog de pe documentul guild");
  assert.equal(fixture.guilds[0].serverAuditLog, undefined, "m8 curata campul serverAuditLog de pe documentul guild");
  assert.equal(fixture.backupBulkOps.length, 1, "m9 muta backup-ul valid in colectia guildConfigBackups si sare peste intrarea fara nume");
  const backupOp = fixture.backupBulkOps[0] as { updateOne: { filter: { guildId: string; name: string }; update: { $setOnInsert: { snapshot: Record<string, unknown> } }; upsert: boolean } };
  assert.deepEqual(backupOp.updateOne.filter, { guildId: "guild-1", name: "prod" }, "backfill-ul foloseste cheia naturala (guildId, name), aceeasi cu indexul unic");
  assert.equal(backupOp.updateOne.upsert, true, "backfill-ul e idempotent (upsert pe cheia naturala)");
  assert.deepEqual(backupOp.updateOne.update.$setOnInsert.snapshot, { subscribed: true });
  assert.equal(fixture.guilds[0].configBackups, undefined, "m9 curata campul configBackups de pe documentul guild");
  assert.equal(fixture.suggestedBulkOps.length, 1, "m10 muta sugestia valida in colectia guildSuggestedCommands si sare peste intrarea fara nume");
  const suggestedOp = fixture.suggestedBulkOps[0] as { updateOne: { filter: { guildId: string; commandName: string }; update: { $setOnInsert: { description: string } }; upsert: boolean } };
  assert.deepEqual(suggestedOp.updateOne.filter, { guildId: "guild-1", commandName: "calendar" }, "backfill-ul foloseste cheia naturala (guildId, commandName), aceeasi cu indexul unic");
  assert.equal(suggestedOp.updateOne.upsert, true, "backfill-ul e idempotent (upsert pe cheia naturala)");
  assert.equal(suggestedOp.updateOne.update.$setOnInsert.description, "arata calendarul");
  assert.equal(fixture.guilds[0].suggestedCommands, undefined, "m10 curata campul suggestedCommands de pe documentul guild");
  assert.equal(fixture.youtubeErrorBulkOps.length, 1, "m11 muta eroarea YouTube in colectia guildYoutubeErrors");
  const youtubeErrorOp = fixture.youtubeErrorBulkOps[0] as { updateOne: { filter: { guildId: string; message: string }; upsert: boolean } };
  assert.equal(youtubeErrorOp.updateOne.filter.guildId, "guild-1");
  assert.equal(youtubeErrorOp.updateOne.filter.message, "feed indisponibil");
  assert.equal(youtubeErrorOp.updateOne.upsert, true, "backfill-ul e idempotent (upsert pe continutul intrarii)");
  assert.equal(fixture.guilds[0].youtubeErrors, undefined, "m11 curata campul youtubeErrors de pe documentul guild");
  assert.equal(fixture.deadLetterBulkOps.length, 1, "m12 muta intrarea dead-letter valida si sare peste intrarea cu kind invalid");
  const deadLetterOp = fixture.deadLetterBulkOps[0] as { updateOne: { filter: { guildId: string; kind: string; dedupeKey: string }; upsert: boolean } };
  assert.equal(deadLetterOp.updateOne.filter.guildId, "guild-1");
  assert.equal(deadLetterOp.updateOne.filter.kind, "update");
  assert.equal(deadLetterOp.updateOne.filter.dedupeKey, "dk1");
  assert.equal(deadLetterOp.updateOne.upsert, true, "backfill-ul e idempotent (upsert pe continutul intrarii)");
  assert.equal(fixture.guilds[0].notificationDeadLetter, undefined, "m12 curata campul notificationDeadLetter de pe documentul guild");
  assert.equal(fixture.migrationState?.lastApplied, LAST_MIGRATION_ID, "starea retine ultima migrare din registru");
  assert.equal(fixture.releaseCalls.length, 1);
  assert.deepEqual(fixture.releaseCalls[0], { name: "db_migrations", token: "migration-lock-token" });
  assert.ok(logs.some(log => log.context === "MIGRATE" && log.message.includes("#8")));
  assert.ok(logs.some(log => log.context === "MIGRATE" && log.message.includes("#9")));
  assert.ok(logs.some(log => log.context === "MIGRATE" && log.message.includes("#10")));
  assert.ok(logs.some(log => log.context === "MIGRATE" && log.message.includes("#11")));
  assert.ok(logs.some(log => log.context === "MIGRATE" && log.message.includes("#12")));
  assert.equal(fixture.moderationUpdates.length, 1, "m14 muta felia de moderare in colectia dedicata");
  assert.equal(
    fixture.youtubeStateUpdates.length,
    2,
    "m15 copiaza felia YouTube, iar m16 o completeaza inainte sa scoata campurile vechi - moderarea nu mai apare a doua oara fiindca m14 golise deja documentul"
  );
  assert.equal(fixture.guilds[0].moderationWarnBanLimit, undefined, "m14 scoate campurile de moderare de pe documentul guild");
  assert.equal(
    fixture.securityUpdates.length,
    1,
    "m16 completeaza si felia de securitate, care nu avusese o migrare proprie de mutare"
  );
  const sliceUnsets = fixture.updateManyCalls.slice(5, 8);
  assert.deepEqual(
    sliceUnsets.map(call => Object.keys((call.update as { $unset: Record<string, string> }).$unset).length),
    [4, 12, 8],
    "m16 scoate din documentul guild exact campurile celor trei domenii: moderare, securitate, YouTube"
  );
  const watchUnset = fixture.updateManyCalls[8];
  assert.deepEqual(
    watchUnset.update,
    { $unset: { playerCountWatchState: "" } },
    "m17 scoate starea de player-count din documentul guild, dupa ce a mutat-o in colectia dedicata"
  );
  assert.ok(
    sliceUnsets.every(call => Object.prototype.hasOwnProperty.call(call.filter, "$or")),
    "stergerea atinge doar guild-urile care mai au campuri de mutat"
  );
});

test("alta instanta tine lock-ul dar schema e deja sincronizata -> asteapta, continua boot-ul fara throw", async () => {
  const fixture = createFakeMigrationContext({
    acquireDbLock: async () => null,
    initialMigrationState: { _id: "migrationState", lastApplied: LAST_MIGRATION_ID }
  });
  let slept = 0;

  const result = await fixture.context.runMigrations(() => null, {
    sleep: async () => { slept++; },
    waitTimeoutMs: 10_000,
    pollIntervalMs: 100
  });

  assert.deepEqual(result.applied, []);
  assert.equal(result.skipped, fixture.context.ALL_MIGRATIONS.length);
  assert.equal(result.waited, true, "marcheaza ca a asteptat sincronizarea altei instante");
  assert.equal(slept, 0, `schema deja la zi (lastApplied=${LAST_MIGRATION_ID}) -> intoarce la prima verificare, fara sa doarma`);
  assert.equal(fixture.releaseCalls.length, 0, "nu a tinut niciun lock");
});

test("alta instanta tine lock-ul si nu termina in timeout -> fail-fast (throw)", async () => {
  const fixture = createFakeMigrationContext({
    acquireDbLock: async () => null,
    initialMigrationState: { _id: "migrationState", lastApplied: 3 }
  });
  let clock = 0;

  await assert.rejects(
    fixture.context.runMigrations(() => null, {
      now: () => clock,
      sleep: async (ms: number) => { clock += ms; },
      waitTimeoutMs: 1_000,
      pollIntervalMs: 100
    }),
    new RegExp(`Timeout.*migrarile.*lastApplied=3 < ${LAST_MIGRATION_ID}.*fail-fast`, "s"),
    `schema ramane sub target (3 < ${LAST_MIGRATION_ID}) pana la timeout -> arunca pentru ca boot-ul sa se opreasca`
  );
  assert.equal(fixture.releaseCalls.length, 0);
});
