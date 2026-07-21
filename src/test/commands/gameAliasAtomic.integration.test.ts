import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { addGameAlias, removeGameAlias, buildAddGameAliasPipeline, type GameAliasGuildModelLike } from "../../features/guild-config/gameAliasRepository.js";
import { MAX_ALIASES_PER_GAME, MAX_TOTAL_GAME_ALIASES } from "../../features/guild-config/gameAliasService.js";

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/discord-patch-bot-itest";

interface AliasDoc { _id: string; gameAliases?: Record<string, string[]> }
const schema = new mongoose.Schema({ _id: String, gameAliases: mongoose.Schema.Types.Mixed }, { strict: false, versionKey: false });
const AliasModel = (mongoose.models.GameAliasItest as mongoose.Model<AliasDoc>) ?? mongoose.model<AliasDoc>("GameAliasItest", schema);
function aliasRepo(model: unknown): GameAliasGuildModelLike {
  return model as GameAliasGuildModelLike;
}
const repoModel = aliasRepo(AliasModel);

let connected = false;
const ready = (async () => {
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 2000, dbName: "discord-patch-bot-itest-gamealias" });
    connected = true;
  } catch {
    connected = false;
  }
})();

test("buildAddGameAliasPipeline: pipeline atomic cu conditii de plafon per-joc si total", () => {
  const pipeline = buildAddGameAliasPipeline("cs2", "counter");
  const stage = pipeline[0] as { $set: Record<string, unknown> };
  assert.ok("gameAliases.cs2" in stage.$set, "tinteste cheia dedicata, nu tot obiectul");
  const json = JSON.stringify(pipeline);
  assert.ok(json.includes(String(MAX_ALIASES_PER_GAME)), "contine plafonul per-joc");
  assert.ok(json.includes(String(MAX_TOTAL_GAME_ALIASES)), "contine plafonul total");
  assert.ok(json.includes("$objectToArray"), "calculeaza totalul din toate cheile atomic");
});

test("real Mongo: doua add-uri concurente pe acelasi joc la 24 nu depasesc 25 si nu pierd aliasuri (audit 154b #2)", async (t) => {
  await ready;
  if (!connected) { t.skip("MongoDB indisponibil (porneste un Mongo si seteaza MONGO_URI)"); return; }
  const id = `alias-samegame-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const existing = Array.from({ length: 24 }, (_unused, i) => `orig${i}`);
  try {
    await AliasModel.updateOne({ _id: id }, { $set: { gameAliases: { cs2: existing } } }, { upsert: true });
    const [r1, r2] = await Promise.all([
      addGameAlias(repoModel, id, "cs2", "concurent-x"),
      addGameAlias(repoModel, id, "cs2", "concurent-y")
    ]);
    const doc = await AliasModel.findById(id).lean();
    const aliases = doc?.gameAliases?.cs2 ?? [];
    assert.equal(aliases.length, 25, "plafonul per-joc de 25 respectat sub concurenta (nu 26)");
    for (const original of existing) assert.ok(aliases.includes(original), `aliasul original ${original} nu s-a pierdut (fara clobber)`);
    assert.equal([r1.saved, r2.saved].filter(Boolean).length, 1, "exact un add reuseste");
  } finally {
    await AliasModel.deleteOne({ _id: id });
  }
});

test("real Mongo: doua add-uri concurente pe jocuri diferite la total 199 nu depasesc 200 (audit 154b #2)", async (t) => {
  await ready;
  if (!connected) { t.skip("MongoDB indisponibil"); return; }
  const id = `alias-total-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const seed: Record<string, string[]> = {};
  let remaining = MAX_TOTAL_GAME_ALIASES - 1;
  let index = 0;
  while (remaining > 0) {
    const take = Math.min(MAX_ALIASES_PER_GAME, remaining);
    seed[`seed${index}`] = Array.from({ length: take }, (_unused, i) => `seed${index}_${i}`);
    remaining -= take;
    index++;
  }
  try {
    await AliasModel.updateOne({ _id: id }, { $set: { gameAliases: seed } }, { upsert: true });
    const [r1, r2] = await Promise.all([
      addGameAlias(repoModel, id, "newgamea", "alfa"),
      addGameAlias(repoModel, id, "newgameb", "beta")
    ]);
    const doc = await AliasModel.findById(id).lean();
    const total = Object.values(doc?.gameAliases ?? {}).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
    assert.equal(total, MAX_TOTAL_GAME_ALIASES, "plafonul total de 200 respectat sub concurenta (nu 201)");
    assert.equal([r1.saved, r2.saved].filter(Boolean).length, 1, "exact un add reuseste");
  } finally {
    await AliasModel.deleteOne({ _id: id });
  }
});

test("real Mongo: remove pe jocul A concurent cu add pe jocul B nu se suprascriu (audit 154b #2)", async (t) => {
  await ready;
  if (!connected) { t.skip("MongoDB indisponibil"); return; }
  const id = `alias-noclobber-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await AliasModel.updateOne({ _id: id }, { $set: { gameAliases: { gamea: ["x"], gameb: ["y"] } } }, { upsert: true });
    await Promise.all([
      removeGameAlias(repoModel, id, "gamea", "x"),
      addGameAlias(repoModel, id, "gameb", "z")
    ]);
    const doc = await AliasModel.findById(id).lean();
    assert.ok(!(doc?.gameAliases?.gamea ?? []).includes("x"), "gamea: aliasul e sters");
    assert.deepEqual((doc?.gameAliases?.gameb ?? []).slice().sort(), ["y", "z"], "gameb: add-ul e pastrat, fara clobber de la remove-ul pe gamea");
  } finally {
    await AliasModel.deleteOne({ _id: id });
  }
});

test.after(async () => {
  if (connected) await mongoose.disconnect();
});
