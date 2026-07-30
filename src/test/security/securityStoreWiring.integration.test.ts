import test from "node:test";
import { createGuildSettingsEventBus } from "../../infra/mongo/guildSettingsEventBus.js";
import assert from "node:assert/strict";

import mongoose from "mongoose";
import attachMongoModels from "../../infra/mongo/models.js";
import type { MongoModelsContext } from "../../infra/mongo/models.js";
import { createSecurityStore, SECURITY_FIELDS } from "../../features/command-security/securityStore.js";
import type { GuildConfigWriteModelLike } from "../../features/guild-config/guildConfigRepository.js";
import type { SecurityStateModel } from "../../features/command-security/securityStore.js";

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/discord-patch-bot-itest";

type Cleanable = {
  deleteMany(filter: Record<string, unknown>): Promise<unknown>;
  countDocuments(filter: Record<string, unknown>): Promise<number>;
  findOne(filter: Record<string, unknown>): { lean(): Promise<Record<string, unknown> | null> };
};

interface BuiltModels {
  GuildModel: GuildConfigWriteModelLike & Cleanable & { create(doc: Record<string, unknown>): Promise<unknown> };
  GuildSecurityModel: SecurityStateModel & Cleanable;
}

function asBuiltModels(target: Record<string, unknown>): Record<string, unknown> & BuiltModels {
  return target as Record<string, unknown> & BuiltModels;
}

function schemaPaths(model: object): Record<string, unknown> {
  const schema = Reflect.get(model, "schema");
  const paths = schema && typeof schema === "object" ? Reflect.get(schema, "paths") : null;
  return paths && typeof paths === "object" ? paths as Record<string, unknown> : {};
}

let built: BuiltModels | null = null;

function buildModels(): BuiltModels {
  if (built) return built;
  const target: Record<string, unknown> = {
    mongoose,
    guildSettingsBus: createGuildSettingsEventBus(),
    SUPPORTED_CURRENCIES: { USD: {} },
    DEFAULT_CURRENCY: "USD",
    ONE_DAY_MS: 86_400_000,
    env: {
      GUILD_SEEN_DISCOUNT_TTL_DAYS: 60,
      NOTIFICATION_OUTBOX_SENT_TTL_HOURS: 24,
      NOTIFICATION_HISTORY_TTL_DAYS: 30,
      FEEDBACK_REPORT_TTL_DAYS: 90,
      NOTIFICATION_DEAD_LETTER_REPLAY_TTL_DAYS: 7
    }
  };
  Object.assign(target, attachMongoModels.buildFrom(target as MongoModelsContext));
  built = asBuiltModels(target);
  return built;
}

let connected = false;
const ready = (async () => {
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 2000, dbName: "discord-patch-bot-itest-security" });
    connected = true;
  } catch {
    connected = false;
  }
})();

test("toate campurile de securitate declarate exista in schema dedicata", async (t) => {
  await ready;
  if (!connected) { t.skip("MongoDB indisponibil"); return; }
  const { GuildSecurityModel } = buildModels();
  const paths = Object.keys(schemaPaths(GuildSecurityModel));
  for (const field of SECURITY_FIELDS) {
    assert.ok(paths.includes(field), `${field} lipseste din colectia dedicata, deci migrarea l-ar pierde`);
  }
});

test("real Mongo: o scriere de securitate ajunge in ambele colectii", async (t) => {
  await ready;
  if (!connected) { t.skip("MongoDB indisponibil"); return; }
  const { GuildModel, GuildSecurityModel } = buildModels();
  const guildId = `sec-write-${Date.now()}`;
  await GuildModel.deleteMany({ _id: guildId });
  await GuildSecurityModel.deleteMany({ _id: guildId });

  const mirrored: string[] = [];
  const store = createSecurityStore(GuildModel, GuildSecurityModel, id => mirrored.push(id));
  await store.updateOne({ _id: guildId }, { $set: { threatProtectionEnabled: true, threatAlertChannelId: "c1" } }, { upsert: true });

  assert.equal(await GuildSecurityModel.countDocuments({ _id: guildId, threatProtectionEnabled: true }), 1);
  const legacy = await GuildModel.findOne({ _id: guildId }).lean();
  assert.equal(legacy?.threatProtectionEnabled, true, "documentul vechi ramane sursa de citire pana la finalul migrarii");
  assert.deepEqual(mirrored, [guildId], "oglindirea se raporteaza o singura data per guild, nu la fiecare scriere");

  await store.updateOne({ _id: guildId }, { $set: { purgeAmount: 25 } }, { upsert: true });
  assert.deepEqual(mirrored, [guildId], "a doua scriere nu mai raporteaza inceputul migrarii");
  assert.equal(await GuildSecurityModel.countDocuments({ _id: guildId, purgeAmount: 25 }), 1);

  await GuildModel.deleteMany({ _id: guildId });
  await GuildSecurityModel.deleteMany({ _id: guildId });
});

test("real Mongo: o scriere care nu atinge securitatea nu creeaza document dedicat", async (t) => {
  await ready;
  if (!connected) { t.skip("MongoDB indisponibil"); return; }
  const { GuildModel, GuildSecurityModel } = buildModels();
  const guildId = `sec-skip-${Date.now()}`;
  await GuildModel.deleteMany({ _id: guildId });
  await GuildSecurityModel.deleteMany({ _id: guildId });

  const store = createSecurityStore(GuildModel, GuildSecurityModel);
  await store.updateOne({ _id: guildId }, { $set: { timezone: "Europe/Bucharest" } }, { upsert: true });

  assert.equal(
    await GuildSecurityModel.countDocuments({ _id: guildId }),
    0,
    "colectia de securitate nu se umple cu documente goale la orice scriere de configurare"
  );
  await GuildModel.deleteMany({ _id: guildId });
});

test("real Mongo: mutatiile de array pe campuri de securitate sunt oglindite", async (t) => {
  await ready;
  if (!connected) { t.skip("MongoDB indisponibil"); return; }
  const { GuildModel, GuildSecurityModel } = buildModels();
  const guildId = `sec-array-${Date.now()}`;
  await GuildModel.deleteMany({ _id: guildId });
  await GuildSecurityModel.deleteMany({ _id: guildId });

  const store = createSecurityStore(GuildModel, GuildSecurityModel);
  await store.updateOne({ _id: guildId }, { $addToSet: { lockedChannelIds: "chan-1" } }, { upsert: true });

  const dedicated = await GuildSecurityModel.findOne({ _id: guildId }).lean();
  assert.deepEqual(dedicated?.lockedChannelIds, ["chan-1"], "un $addToSet pe un camp de securitate ajunge si in colectia dedicata");

  await GuildModel.deleteMany({ _id: guildId });
  await GuildSecurityModel.deleteMany({ _id: guildId });
});

test("conexiunea de test se inchide", async () => {
  await ready;
  if (connected) await mongoose.disconnect();
});
