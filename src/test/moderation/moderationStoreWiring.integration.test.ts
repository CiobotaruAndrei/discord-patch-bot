import test from "node:test";
import { createGuildSettingsEventBus } from "../../infra/mongo/guildSettingsEventBus.js";
import assert from "node:assert/strict";

import mongoose from "mongoose";
import attachMongoModels from "../../infra/mongo/models.js";
import type { MongoModelsContext } from "../../infra/mongo/models.js";
import { createModerationStore, MODERATION_FIELDS } from "../../features/moderation/moderationStore.js";
import type { ModerationGuildModel } from "../../features/moderation/moderationRepository.js";

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/discord-patch-bot-itest";

interface BuiltModels {
  GuildModel: ModerationGuildModel & { deleteMany(filter: Record<string, unknown>): Promise<unknown>; create(doc: Record<string, unknown>): Promise<unknown> };
  GuildModerationModel: ModerationGuildModel & { deleteMany(filter: Record<string, unknown>): Promise<unknown>; countDocuments(filter: Record<string, unknown>): Promise<number> };
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
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 2000, dbName: "discord-patch-bot-itest-moderation" });
    connected = true;
  } catch {
    connected = false;
  }
})();

test("colectia dedicata de moderare exista si accepta campurile de moderare", async (t) => {
  await ready;
  if (!connected) { t.skip("MongoDB indisponibil"); return; }
  const { GuildModerationModel } = buildModels();
  const guildId = `mod-${Date.now()}`;
  await GuildModerationModel.deleteMany({ _id: guildId });
  await GuildModerationModel.updateOne(
    { _id: guildId },
    { $set: { moderationWarnBanLimit: 3, moderationWarnings: [{ userId: "u1", username: "u", moderatorId: "m", warnedAt: new Date() }] } },
    { upsert: true }
  );
  assert.equal(await GuildModerationModel.countDocuments({ _id: guildId }), 1);
  await GuildModerationModel.deleteMany({ _id: guildId });
});

test("real Mongo: prima citire migreaza starea din Guild in colectia dedicata", async (t) => {
  await ready;
  if (!connected) { t.skip("MongoDB indisponibil"); return; }
  const { GuildModel, GuildModerationModel } = buildModels();
  const guildId = `mod-backfill-${Date.now()}`;
  await GuildModel.deleteMany({ _id: guildId });
  await GuildModerationModel.deleteMany({ _id: guildId });
  await GuildModel.create({ _id: guildId, moderationWarnBanLimit: 5 });

  const backfilled: string[] = [];
  const store = createModerationStore(GuildModel, GuildModerationModel, id => backfilled.push(id));

  const legacy = await store.findOne({ _id: guildId });
  assert.equal((legacy as Record<string, unknown> | null)?.moderationWarnBanLimit, 5);
  assert.deepEqual(backfilled, [guildId], "starea veche se copiaza o singura data");
  assert.equal(await GuildModerationModel.countDocuments({ _id: guildId }), 1);

  const second = await store.findOne({ _id: guildId });
  assert.equal((second as Record<string, unknown> | null)?.moderationWarnBanLimit, 5);
  assert.deepEqual(backfilled, [guildId], "a doua citire vine deja din colectia dedicata");

  await GuildModel.deleteMany({ _id: guildId });
  await GuildModerationModel.deleteMany({ _id: guildId });
});

test("real Mongo: o scriere de moderare ajunge doar in colectia dedicata", async (t) => {
  await ready;
  if (!connected) { t.skip("MongoDB indisponibil"); return; }
  const { GuildModel, GuildModerationModel } = buildModels();
  const guildId = `mod-write-${Date.now()}`;
  await GuildModel.deleteMany({ _id: guildId });
  await GuildModerationModel.deleteMany({ _id: guildId });

  const store = createModerationStore(GuildModel, GuildModerationModel);
  await store.updateOne({ _id: guildId }, { $set: { moderationWarnBanLimit: 7 } }, { upsert: true });

  assert.equal(await GuildModerationModel.countDocuments({ _id: guildId, moderationWarnBanLimit: 7 }), 1);
  const guild = await GuildModel.findOne({ _id: guildId });
  const legacy = await (guild && typeof guild === "object" && "lean" in guild ? (guild as { lean: () => Promise<Record<string, unknown> | null> }).lean() : Promise.resolve(guild));
  assert.equal(
    legacy?.moderationWarnBanLimit,
    undefined,
    "colectia dedicata detine campul, iar migrarea 16 il scoate din documentul vechi; o scriere acolo l-ar reinvia"
  );

  await GuildModel.deleteMany({ _id: guildId });
  await GuildModerationModel.deleteMany({ _id: guildId });
});

test("toate campurile de moderare declarate exista in schema dedicata", async (t) => {
  await ready;
  if (!connected) { t.skip("MongoDB indisponibil"); return; }
  const { GuildModerationModel } = buildModels();
  const paths = Object.keys(schemaPaths(GuildModerationModel));
  for (const field of MODERATION_FIELDS) {
    assert.ok(paths.includes(field), `${field} lipseste din colectia dedicata, deci migrarea l-ar pierde`);
  }
});

test("conexiunea de test se inchide", async () => {
  await ready;
  if (connected) await mongoose.disconnect();
});
