import test from "node:test";
import { createGuildSettingsEventBus } from "../../infra/mongo/guildSettingsEventBus.js";
import assert from "node:assert/strict";

import mongoose from "mongoose";
import attachMongoModels from "../../infra/mongo/models.js";
import type { MongoModelsContext } from "../../infra/mongo/models.js";
import { NOTIFICATION_KINDS, subscriptionFilterFor } from "../../shared/notificationKinds.js";
import { outboxSubscriptionFilter } from "../../features/notifications/outboxRuntimeFactory.js";

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/discord-patch-bot-itest";

interface WritableModel {
  create(doc: Record<string, unknown>): Promise<unknown>;
  countDocuments(filter: Record<string, unknown>): Promise<number>;
  deleteMany(filter: Record<string, unknown>): Promise<unknown>;
}

interface BuiltModels {
  NotificationOutboxModel: WritableModel;
  NotificationHistoryModel: WritableModel;
  NotificationDeadLetterReplayModel: WritableModel;
  GuildModel: WritableModel;
}

function asBuiltModels(target: Record<string, unknown>): Record<string, unknown> & BuiltModels {
  return target as Record<string, unknown> & BuiltModels;
}

let builtModels: BuiltModels | null = null;

function buildModels(): BuiltModels {
  if (builtModels) return builtModels;
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
  builtModels = asBuiltModels(target);
  return builtModels;
}

let connected = false;
const ready = (async () => {
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 2000, dbName: "discord-patch-bot-itest-kinds" });
    connected = true;
  } catch {
    connected = false;
  }
})();

test("real Mongo: fiecare kind din registru trece validarea schemei outbox", async (t) => {
  await ready;
  if (!connected) { t.skip("MongoDB indisponibil (porneste un Mongo si seteaza MONGO_URI)"); return; }
  const { NotificationOutboxModel } = buildModels();
  const guildId = `kinds-${Date.now()}`;
  await NotificationOutboxModel.deleteMany({ guildId });

  for (const kind of NOTIFICATION_KINDS) {
    await NotificationOutboxModel.create({
      guildId,
      channelId: "channel-1",
      kind,
      payload: { content: `job ${kind}` },
      dedupeKey: `${guildId}:${kind}`,
      history: [{ kind, gameKey: "cs2", title: "t", link: "l", itemId: "i" }]
    });
  }

  assert.equal(
    await NotificationOutboxModel.countDocuments({ guildId }),
    NOTIFICATION_KINDS.length,
    "un kind declarat in registru dar lipsa din enum-ul Mongo ar fi respins la scriere"
  );
  await NotificationOutboxModel.deleteMany({ guildId });
});

test("real Mongo: istoricul si replay-ul accepta acelasi set de kind-uri ca outbox-ul", async (t) => {
  await ready;
  if (!connected) { t.skip("MongoDB indisponibil (porneste un Mongo si seteaza MONGO_URI)"); return; }
  const { NotificationHistoryModel, NotificationDeadLetterReplayModel } = buildModels();
  const guildId = `kinds-history-${Date.now()}`;
  await NotificationHistoryModel.deleteMany({ guildId });
  await NotificationDeadLetterReplayModel.deleteMany({ guildId });

  for (const kind of NOTIFICATION_KINDS) {
    await NotificationHistoryModel.create({ guildId, channelId: "channel-1", kind, title: `t ${kind}` });
    await NotificationDeadLetterReplayModel.create({
      guildId,
      channelId: "channel-1",
      kind,
      reason: "channel-missing",
      payload: { content: "x" }
    });
  }

  assert.equal(await NotificationHistoryModel.countDocuments({ guildId }), NOTIFICATION_KINDS.length);
  assert.equal(await NotificationDeadLetterReplayModel.countDocuments({ guildId }), NOTIFICATION_KINDS.length);
  await NotificationHistoryModel.deleteMany({ guildId });
  await NotificationDeadLetterReplayModel.deleteMany({ guildId });
});

test("real Mongo: filtrul de abonament al unui job DLC cere canalul DLC, nu canalul de update-uri", async (t) => {
  await ready;
  if (!connected) { t.skip("MongoDB indisponibil (porneste un Mongo si seteaza MONGO_URI)"); return; }
  const { GuildModel } = buildModels();
  const guildId = `kinds-guild-${Date.now()}`;
  await GuildModel.deleteMany({ _id: guildId });
  await GuildModel.create({
    _id: guildId,
    subscribed: true,
    notificationChannelId: "updates-channel",
    dlcSubscribed: true,
    dlcChannelId: "dlc-channel"
  });

  const dlcJob = { guildId, channelId: "dlc-channel", kind: "dlc" as const, payload: {} };
  const wrongChannel = { guildId, channelId: "updates-channel", kind: "dlc" as const, payload: {} };

  assert.equal(await GuildModel.countDocuments(outboxSubscriptionFilter(dlcJob)), 1);
  assert.equal(
    await GuildModel.countDocuments(outboxSubscriptionFilter(wrongChannel)),
    0,
    "inainte, un job DLC cadea pe ramura update si ar fi trecut pe canalul de update-uri"
  );

  await GuildModel.deleteMany({ _id: guildId });
});

test("real Mongo: un guild care a oprit DLC nu mai trece filtrul, chiar daca update-urile sunt pornite", async (t) => {
  await ready;
  if (!connected) { t.skip("MongoDB indisponibil (porneste un Mongo si seteaza MONGO_URI)"); return; }
  const { GuildModel } = buildModels();
  const guildId = `kinds-guild-off-${Date.now()}`;
  await GuildModel.deleteMany({ _id: guildId });
  await GuildModel.create({
    _id: guildId,
    subscribed: true,
    notificationChannelId: "updates-channel",
    dlcSubscribed: false,
    dlcChannelId: "dlc-channel"
  });

  const filter = subscriptionFilterFor({ kind: "dlc", guildId, channelId: "dlc-channel" });
  assert.equal(await GuildModel.countDocuments(filter), 0);
  await GuildModel.deleteMany({ _id: guildId });
});

test("conexiunea de test se inchide", async () => {
  await ready;
  if (connected) await mongoose.disconnect();
});
