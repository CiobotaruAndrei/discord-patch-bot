import test from "node:test";
import assert from "node:assert/strict";

import mongoose from "mongoose";
import attachMongoModels from "../../infra/mongo/models.js";
import type { MongoModelsContext } from "../../infra/mongo/models.js";
import { createModerationStore } from "../../features/moderation/moderationStore.js";
import { createModerationLifecycleRuntime } from "../../features/moderation/moderationLifecycleRuntime.js";
import moderationRepository from "../../features/moderation/moderationRepository.js";
import { m14_moveModerationStateIntoCollection } from "../../infra/mongo/migrations/m14_moveModerationStateIntoCollection.js";
import type { ModerationGuildModel } from "../../features/moderation/moderationRepository.js";

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/discord-patch-bot-itest";

type Cleanable = {
  deleteMany(filter: Record<string, unknown>): Promise<unknown>;
  create(doc: Record<string, unknown>): Promise<unknown>;
};

async function readDoc(model: ModerationGuildModel, guildId: string): Promise<Record<string, unknown> | null> {
  const found = model.findOne({ _id: guildId });
  if (found && typeof found === "object" && "lean" in found) {
    return await (found as { lean(): Promise<Record<string, unknown> | null> }).lean();
  }
  return await found;
}

interface BuiltModels {
  GuildModel: ModerationGuildModel & Cleanable;
  GuildModerationModel: ModerationGuildModel & Cleanable;
}

function asBuiltModels(target: Record<string, unknown>): Record<string, unknown> & BuiltModels {
  return target as Record<string, unknown> & BuiltModels;
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
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 2000, dbName: "discord-patch-bot-itest-moderation-truth" });
    connected = true;
  } catch {
    connected = false;
  }
})();

function expiredTimeout(userId: string): Record<string, unknown> {
  return {
    userId,
    username: userId,
    moderatorId: "mod",
    appliedAt: new Date(Date.now() - 120_000),
    expiresAt: new Date(Date.now() - 60_000),
    reason: "expirat"
  };
}

test("real Mongo: curatarea periodica prin model brut lasa sanctiunea expirata in colectia dedicata", async (t) => {
  await ready;
  if (!connected) { t.skip("MongoDB indisponibil"); return; }
  const { GuildModel, GuildModerationModel } = buildModels();
  const guildId = `mod-divergent-${Date.now()}`;
  await GuildModel.deleteMany({ _id: guildId });
  await GuildModerationModel.deleteMany({ _id: guildId });

  await GuildModel.create({ _id: guildId, moderationTimeouts: [expiredTimeout("u1")] });
  await GuildModerationModel.updateOne({ _id: guildId }, { $set: { moderationTimeouts: [expiredTimeout("u1")] } }, { upsert: true });

  const legacyLifecycle = createModerationLifecycleRuntime(GuildModel);
  await legacyLifecycle.cleanupExpired();

  const legacyDoc = await readDoc(GuildModel, guildId);
  assert.deepEqual(legacyDoc?.moderationTimeouts, [], "documentul vechi a fost curatat");
  const dedicated = await readDoc(GuildModerationModel, guildId);
  assert.equal(
    (dedicated?.moderationTimeouts as unknown[] | undefined)?.length,
    1,
    "exact divergenta raportata: colectia dedicata pastreaza sanctiunea expirata, deci ea reapare la urmatoarea citire"
  );

  await GuildModel.deleteMany({ _id: guildId });
  await GuildModerationModel.deleteMany({ _id: guildId });
});

test("real Mongo: curatarea prin fatada lasa aceeasi stare in ambele colectii", async (t) => {
  await ready;
  if (!connected) { t.skip("MongoDB indisponibil"); return; }
  const { GuildModel, GuildModerationModel } = buildModels();
  const guildId = `mod-single-${Date.now()}`;
  await GuildModel.deleteMany({ _id: guildId });
  await GuildModerationModel.deleteMany({ _id: guildId });

  await GuildModel.create({ _id: guildId, moderationTimeouts: [expiredTimeout("u1")] });
  await GuildModerationModel.updateOne({ _id: guildId }, { $set: { moderationTimeouts: [expiredTimeout("u1")] } }, { upsert: true });

  const store = createModerationStore(GuildModel, GuildModerationModel);
  const lifecycle = createModerationLifecycleRuntime(store);
  await lifecycle.cleanupExpired();

  const dedicated = await readDoc(GuildModerationModel, guildId);
  assert.deepEqual(dedicated?.moderationTimeouts, [], "colectia dedicata vede aceeasi curatare ca documentul vechi");
  const state = await moderationRepository.getModerationState(store, guildId);
  assert.deepEqual(state.moderationTimeouts ?? [], [], "o comanda care citeste dupa curatare nu mai vede sanctiunea expirata");

  await GuildModel.deleteMany({ _id: guildId });
  await GuildModerationModel.deleteMany({ _id: guildId });
});

test("real Mongo: stergerea sanctiunilor unui membru plecat trece si ea prin fatada", async (t) => {
  await ready;
  if (!connected) { t.skip("MongoDB indisponibil"); return; }
  const { GuildModel, GuildModerationModel } = buildModels();
  const guildId = `mod-leave-${Date.now()}`;
  await GuildModel.deleteMany({ _id: guildId });
  await GuildModerationModel.deleteMany({ _id: guildId });

  const active = {
    userId: "u2",
    username: "u2",
    moderatorId: "mod",
    appliedAt: new Date(),
    expiresAt: new Date(Date.now() + 3_600_000),
    reason: "activ"
  };
  await GuildModel.create({ _id: guildId, moderationMutes: [active] });
  await GuildModerationModel.updateOne({ _id: guildId }, { $set: { moderationMutes: [active] } }, { upsert: true });

  const store = createModerationStore(GuildModel, GuildModerationModel);
  const lifecycle = createModerationLifecycleRuntime(store);
  await lifecycle.handleGuildMemberRemove({ id: "u2", guild: { id: guildId } });

  const dedicated = await readDoc(GuildModerationModel, guildId);
  assert.deepEqual(dedicated?.moderationMutes, [], "plecarea membrului sterge sanctiunea din colectia dedicata, nu doar din documentul vechi");

  await GuildModel.deleteMany({ _id: guildId });
  await GuildModerationModel.deleteMany({ _id: guildId });
});

test("real Mongo: migrarea 14 muta starea si scoate campurile vechi din Guild", async (t) => {
  await ready;
  if (!connected) { t.skip("MongoDB indisponibil"); return; }
  const { GuildModel, GuildModerationModel } = buildModels();
  const guildId = `mod-migrate-${Date.now()}`;
  await GuildModel.deleteMany({ _id: guildId });
  await GuildModerationModel.deleteMany({ _id: guildId });
  await GuildModel.create({ _id: guildId, moderationWarnBanLimit: 3, moderationTimeouts: [expiredTimeout("u3")] });

  const db = mongoose.connection.db;
  assert.ok(db, "conexiunea are o baza de date");
  await m14_moveModerationStateIntoCollection.up(db);

  const moved = await readDoc(GuildModerationModel, guildId);
  assert.equal(moved?.moderationWarnBanLimit, 3, "starea a ajuns in colectia dedicata");
  assert.equal((moved?.moderationTimeouts as unknown[] | undefined)?.length, 1, "si listele au fost mutate");

  const legacy = await readDoc(GuildModel, guildId);
  assert.equal(legacy?.moderationWarnBanLimit, undefined, "campul vechi a fost scos din Guild");
  assert.equal(legacy?.moderationTimeouts, undefined, "documentul vechi nu mai are lista de sanctiuni");

  await GuildModel.deleteMany({ _id: guildId });
  await GuildModerationModel.deleteMany({ _id: guildId });
});

test("conexiunea de test se inchide", async () => {
  await ready;
  if (connected) await mongoose.disconnect();
});
