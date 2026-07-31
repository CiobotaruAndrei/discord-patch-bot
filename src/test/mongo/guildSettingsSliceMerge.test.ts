import test from "node:test";
import assert from "node:assert/strict";

import attachGuildSettings from "../../infra/mongo/guildSettings.js";
import { createGuildSettingsEventBus } from "../../infra/mongo/guildSettingsEventBus.js";
import { SECURITY_FIELDS } from "../../shared/guildSecurityFields.js";
import { YOUTUBE_FIELDS } from "../../shared/guildYoutubeFields.js";
import type { GuildSettings } from "../../features/guild-config/guildSettingsTypes.js";

interface SliceWrite {
  filter: Record<string, unknown>;
  update: Record<string, unknown>;
  options?: Record<string, unknown>;
}

function sliceModel(
  documents: Record<string, Record<string, unknown>>,
  writes: SliceWrite[] = [],
  failWrites = false
) {
  return {
    findById(id: string) {
      return { lean: async () => documents[id] ?? null };
    },
    async updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>) {
      if (failWrites) throw new Error("mongo indisponibil");
      writes.push({ filter, update, options });
      return { acknowledged: true };
    }
  };
}

function guildModel(documents: Record<string, Record<string, unknown>>, reads: string[] = []) {
  return {
    findById(id: string) {
      reads.push(id);
      return { lean: async () => (documents[id] ?? null) as (GuildSettings & Record<string, unknown>) | null };
    }
  };
}

type Runtime = { getGuildSettings: (guildId: string) => Promise<GuildSettings | null>; invalidateGuildCache: (guildId: string) => void };

function build(context: Omit<Parameters<typeof attachGuildSettings.buildFrom>[0], "env" | "guildSettingsBus">): Runtime {
  return attachGuildSettings.buildFrom({
    ...context,
    guildSettingsBus: createGuildSettingsEventBus(),
    env: { GUILD_CACHE_TTL_MS: 60_000, GUILD_CACHE_MAX_SIZE: 100 }
  });
}

test("felia dedicata invinge documentul vechi pentru campurile ei", async () => {
  const runtime = build({
    GuildModel: guildModel({ g1: { _id: "g1", threatProtectionEnabled: false, purgeAmount: 10, notificationChannelId: "canal" } }),
    guildSlices: [{ domain: "security", fields: SECURITY_FIELDS, model: sliceModel({ g1: { _id: "g1", threatProtectionEnabled: true, purgeAmount: 50 } }) }]
  });

  const settings = await runtime.getGuildSettings("g1");

  assert.equal(settings?.threatProtectionEnabled, true);
  assert.equal(settings?.purgeAmount, 50);
  assert.equal(settings?.notificationChannelId, "canal");
});

test("un camp absent din copia dedicata e completat din documentul vechi", async () => {
  const runtime = build({
    GuildModel: guildModel({ g2: { _id: "g2", threatProtectionEnabled: true, warningChannelId: "avertismente" } }),
    guildSlices: [{ domain: "security", fields: SECURITY_FIELDS, model: sliceModel({ g2: { _id: "g2", threatProtectionEnabled: false } }) }]
  });

  const settings = await runtime.getGuildSettings("g2");

  assert.equal(settings?.threatProtectionEnabled, false);
  assert.equal(settings?.warningChannelId, "avertismente");
});

test("copia dedicata lipsa e raportata si refacuta din documentul vechi", async () => {
  const writes: SliceWrite[] = [];
  const missing: Array<[string, string]> = [];
  const runtime = build({
    GuildModel: guildModel({ g3: { _id: "g3", threatProtectionEnabled: true, purgeAmount: 25 } }),
    guildSlices: [{ domain: "security", fields: SECURITY_FIELDS, model: sliceModel({}, writes) }],
    onSliceCopyMissing: (domain, guildId) => missing.push([domain, guildId])
  });

  const settings = await runtime.getGuildSettings("g3");

  assert.equal(settings?.threatProtectionEnabled, true);
  assert.deepEqual(missing, [["security", "g3"]]);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].filter, { _id: "g3" });
  assert.deepEqual(writes[0].update, { $set: { threatProtectionEnabled: true, purgeAmount: 25 } });
  assert.equal(writes[0].options?.upsert, true);
});

test("un guild fara nimic in domeniu nu produce o copie dedicata goala", async () => {
  const writes: SliceWrite[] = [];
  const missing: string[] = [];
  const runtime = build({
    GuildModel: guildModel({ g4: { _id: "g4", notificationChannelId: "canal" } }),
    guildSlices: [{ domain: "security", fields: SECURITY_FIELDS, model: sliceModel({}, writes) }],
    onSliceCopyMissing: (_domain, guildId) => missing.push(guildId)
  });

  await runtime.getGuildSettings("g4");

  assert.deepEqual(writes, []);
  assert.deepEqual(missing, []);
});

test("o reparare esuata e raportata, iar citirea intoarce datele vechi", async () => {
  const failures: Array<[string, string]> = [];
  const runtime = build({
    GuildModel: guildModel({ g5: { _id: "g5", threatProtectionEnabled: true } }),
    guildSlices: [{ domain: "security", fields: SECURITY_FIELDS, model: sliceModel({}, [], true) }],
    onSliceRepairFailed: (domain, guildId) => failures.push([domain, guildId])
  });

  const settings = await runtime.getGuildSettings("g5");

  assert.equal(settings?.threatProtectionEnabled, true);
  assert.deepEqual(failures, [["security", "g5"]]);
});

test("fiecare domeniu isi imbina doar propriile campuri", async () => {
  const runtime = build({
    GuildModel: guildModel({ g6: { _id: "g6", threatProtectionEnabled: false, youtubeNotificationsEnabled: false } }),
    guildSlices: [
      { domain: "security", fields: SECURITY_FIELDS, model: sliceModel({ g6: { _id: "g6", threatProtectionEnabled: true, youtubeNotificationsEnabled: true } }) },
      { domain: "youtube", fields: YOUTUBE_FIELDS, model: sliceModel({ g6: { _id: "g6", youtubeNotificationsEnabled: true, threatProtectionEnabled: false } }) }
    ]
  });

  const settings = await runtime.getGuildSettings("g6");

  assert.equal(settings?.threatProtectionEnabled, true);
  assert.equal(settings?.youtubeNotificationsEnabled, true);
});

test("un guild care exista doar in colectiile dedicate ramane citibil", async () => {
  const runtime = build({
    GuildModel: guildModel({}),
    guildSlices: [{ domain: "security", fields: SECURITY_FIELDS, model: sliceModel({ g7: { _id: "g7", threatProtectionEnabled: true } }) }]
  });

  const settings = await runtime.getGuildSettings("g7");

  assert.equal(settings?._id, "g7");
  assert.equal(settings?.threatProtectionEnabled, true);
});

test("citirea imbinata trece prin acelasi cache: a doua cerere nu mai atinge Mongo", async () => {
  const reads: string[] = [];
  const runtime = build({
    GuildModel: guildModel({ g8: { _id: "g8", threatProtectionEnabled: true } }, reads),
    guildSlices: [{ domain: "security", fields: SECURITY_FIELDS, model: sliceModel({ g8: { _id: "g8", threatProtectionEnabled: false } }) }]
  });

  await runtime.getGuildSettings("g8");
  await runtime.getGuildSettings("g8");

  assert.deepEqual(reads, ["g8"]);
  runtime.invalidateGuildCache("g8");
  await runtime.getGuildSettings("g8");
  assert.deepEqual(reads, ["g8", "g8"]);
});

test("fara felii configurate citirea ramane exact pe documentul vechi", async () => {
  const reads: string[] = [];
  const runtime = build({ GuildModel: guildModel({ g9: { _id: "g9", threatProtectionEnabled: true } }, reads) });

  const settings = await runtime.getGuildSettings("g9");

  assert.equal(settings?.threatProtectionEnabled, true);
  assert.deepEqual(reads, ["g9"]);
});
