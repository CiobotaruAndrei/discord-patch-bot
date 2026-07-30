import test from "node:test";
import assert from "node:assert/strict";

import mongoose from "mongoose";
import attachMongoModels from "../../infra/mongo/models.js";
import type { MongoModelsContext } from "../../infra/mongo/models.js";
import { createYoutubeStateStore, YOUTUBE_FIELDS } from "../../features/youtube/youtubeStateStore.js";
import { m15_moveYoutubeStateIntoCollection } from "../../infra/mongo/migrations/m15_moveYoutubeStateIntoCollection.js";
import type { YouTubeConfigGuildModel } from "../../features/youtube/youtubeGuildConfigRepository.js";
import type { YoutubeStateModel } from "../../features/youtube/youtubeStateStore.js";

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/discord-patch-bot-itest";

type Cleanable = {
  deleteMany(filter: Record<string, unknown>): Promise<unknown>;
  countDocuments(filter: Record<string, unknown>): Promise<number>;
  create(doc: Record<string, unknown>): Promise<unknown>;
  findOne(filter: Record<string, unknown>): { lean(): Promise<Record<string, unknown> | null> };
};

interface BuiltModels {
  GuildModel: YouTubeConfigGuildModel & Cleanable;
  GuildYoutubeStateModel: YoutubeStateModel & Cleanable;
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
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 2000, dbName: "discord-patch-bot-itest-youtube" });
    connected = true;
  } catch {
    connected = false;
  }
})();

test("schema dedicata acopera fiecare camp YouTube declarat", async (t) => {
  await ready;
  if (!connected) { t.skip("MongoDB indisponibil"); return; }
  const { GuildYoutubeStateModel } = buildModels();
  const paths = Object.keys(schemaPaths(GuildYoutubeStateModel));
  for (const field of YOUTUBE_FIELDS) {
    const covered = paths.includes(field) || paths.some(path => path.startsWith(`${field}.`));
    assert.ok(covered, `${field} lipseste din colectia dedicata, deci migrarea l-ar pierde`);
  }
});

test("real Mongo: o scriere YouTube ajunge in ambele colectii, raportata o singura data", async (t) => {
  await ready;
  if (!connected) { t.skip("MongoDB indisponibil"); return; }
  const { GuildModel, GuildYoutubeStateModel } = buildModels();
  const guildId = `yt-write-${Date.now()}`;
  await GuildModel.deleteMany({ _id: guildId });
  await GuildYoutubeStateModel.deleteMany({ _id: guildId });

  const mirrored: string[] = [];
  const store = createYoutubeStateStore(GuildModel, GuildYoutubeStateModel, id => mirrored.push(id));
  await store.updateOne({ _id: guildId }, { $set: { youtubeNotificationsEnabled: true, youtubeNotificationChannelId: "c1" } }, { upsert: true });

  assert.equal(await GuildYoutubeStateModel.countDocuments({ _id: guildId, youtubeNotificationsEnabled: true }), 1);
  const legacy = await GuildModel.findOne({ _id: guildId }).lean();
  assert.equal(legacy?.youtubeNotificationsEnabled, true, "documentul vechi ramane sursa de citire pana la finalul migrarii");
  assert.deepEqual(mirrored, [guildId], "oglindirea se raporteaza o singura data per guild");

  await store.updateOne({ _id: guildId }, { $set: { youtubeMessageTemplate: "sablon" } }, { upsert: true });
  assert.deepEqual(mirrored, [guildId], "a doua scriere nu mai raporteaza inceputul migrarii");

  await GuildModel.deleteMany({ _id: guildId });
  await GuildYoutubeStateModel.deleteMany({ _id: guildId });
});

test("real Mongo: findOneAndUpdate pe canale YouTube e oglindit, nu doar updateOne", async (t) => {
  await ready;
  if (!connected) { t.skip("MongoDB indisponibil"); return; }
  const { GuildModel, GuildYoutubeStateModel } = buildModels();
  const guildId = `yt-canale-${Date.now()}`;
  await GuildModel.deleteMany({ _id: guildId });
  await GuildYoutubeStateModel.deleteMany({ _id: guildId });

  const store = createYoutubeStateStore(GuildModel, GuildYoutubeStateModel);
  await store.findOneAndUpdate(
    { _id: guildId },
    { $addToSet: { youtubeChannels: { channelId: "UC123", channelName: "canal" } } },
    { upsert: true, new: true }
  );

  const dedicated = await GuildYoutubeStateModel.findOne({ _id: guildId }).lean();
  const channels = dedicated?.youtubeChannels;
  assert.ok(Array.isArray(channels) && channels.length === 1, "adaugarea unui canal trece si prin colectia dedicata");

  await GuildModel.deleteMany({ _id: guildId });
  await GuildYoutubeStateModel.deleteMany({ _id: guildId });
});

test("real Mongo: o scriere care nu atinge YouTube nu creeaza document dedicat", async (t) => {
  await ready;
  if (!connected) { t.skip("MongoDB indisponibil"); return; }
  const { GuildModel, GuildYoutubeStateModel } = buildModels();
  const guildId = `yt-skip-${Date.now()}`;
  await GuildModel.deleteMany({ _id: guildId });
  await GuildYoutubeStateModel.deleteMany({ _id: guildId });

  const store = createYoutubeStateStore(GuildModel, GuildYoutubeStateModel);
  await store.updateOne({ _id: guildId }, { $set: { timezone: "Europe/Bucharest" } }, { upsert: true });

  assert.equal(
    await GuildYoutubeStateModel.countDocuments({ _id: guildId }),
    0,
    "colectia YouTube nu se umple cu documente goale la orice scriere de configurare"
  );
  await GuildModel.deleteMany({ _id: guildId });
});

test("real Mongo: migrarea 15 copiaza starea YouTube in colectia dedicata", async (t) => {
  await ready;
  if (!connected) { t.skip("MongoDB indisponibil"); return; }
  const { GuildModel, GuildYoutubeStateModel } = buildModels();
  const guildId = `yt-migrate-${Date.now()}`;
  await GuildModel.deleteMany({ _id: guildId });
  await GuildYoutubeStateModel.deleteMany({ _id: guildId });
  await GuildModel.create({ _id: guildId, youtubeNotificationsEnabled: true, youtubeMessageTemplate: "vechi" });

  const db = mongoose.connection.db;
  assert.ok(db, "conexiunea are o baza de date");
  await m15_moveYoutubeStateIntoCollection.up(db);

  const moved = await GuildYoutubeStateModel.findOne({ _id: guildId }).lean();
  assert.equal(moved?.youtubeNotificationsEnabled, true, "starea a ajuns in colectia dedicata");
  assert.equal(moved?.youtubeMessageTemplate, "vechi", "si sablonul de mesaj");

  const legacy = await GuildModel.findOne({ _id: guildId }).lean();
  assert.equal(
    legacy?.youtubeNotificationsEnabled,
    true,
    "campurile vechi raman pe Guild: enumerarea din dispatch inca le citeste, deci nu pot fi scoase in acest pas"
  );

  await GuildModel.deleteMany({ _id: guildId });
  await GuildYoutubeStateModel.deleteMany({ _id: guildId });
});

test("conexiunea de test se inchide", async () => {
  await ready;
  if (connected) await mongoose.disconnect();
});
