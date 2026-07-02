import test from "node:test";
import assert from "node:assert/strict";

import type { YouTubeChannelSubscription } from "../types";
import {
  MAX_YOUTUBE_CHANNELS,
  addYouTubeChannelSubscription,
  addYouTubeRouteDestination,
  addYouTubeTitleWord,
  buildYouTubeChannelUpsertPipeline,
  buildYouTubeRouteAddPipeline,
  buildYouTubeTitleWordAddPipeline,
  removeYouTubeChannelSubscription,
  removeYouTubeRouteDestination,
  setYouTubeNotificationsEnabled
} from "../features/youtube/youtubeGuildConfigRepository";

type FoundDoc = {
  youtubeChannels?: Array<{ channelId: string }>;
  youtubeChannelRoutes?: Array<{ channelId: string; discordChannelIds: string[] }>;
  youtubeTitleIncludeWords?: string[];
} | null;

function makeModel(found: FoundDoc = null, modifiedCount = 1) {
  const updates: Array<{ filter: object; update: object; options?: object }> = [];
  const finds: Array<{ filter: object; update: object; options?: object }> = [];
  return {
    updates,
    finds,
    updateOne: async (filter: object, update: object, options?: object) => {
      updates.push({ filter, update, options });
      return { matchedCount: 1, modifiedCount };
    },
    findOneAndUpdate: async (filter: object, update: object, options?: object) => {
      finds.push({ filter, update, options });
      return found;
    }
  };
}

const subscription: YouTubeChannelSubscription = {
  channelId: "yt-1",
  channelName: "Canal",
  channelUrl: "https://youtube.com/yt-1",
  subscribedAt: new Date(),
  lastCheckedAt: new Date(),
  lastVideoId: "",
  lastError: { message: "", channelId: null, at: null }
};

test("pipeline-urile de upsert sunt atomice: refuza duplicatul si depasirea limitei in acelasi $cond", () => {
  const channelPipeline = JSON.stringify(buildYouTubeChannelUpsertPipeline(subscription, 25));
  assert.match(channelPipeline, /\$cond/);
  assert.match(channelPipeline, /\$size/, "limita se verifica in pipeline, nu pe un read separat");
  assert.match(channelPipeline, /\$concatArrays/);

  const wordPipeline = JSON.stringify(buildYouTubeTitleWordAddPipeline("patch", 20));
  assert.match(wordPipeline, /\$cond/);
  assert.match(wordPipeline, /\$size/);

  const routePipeline = JSON.stringify(buildYouTubeRouteAddPipeline("yt-1", "disc-1", 5));
  assert.match(routePipeline, /\$mergeObjects/, "destinatia se adauga in ruta existenta prin merge, nu prin inlocuire");
  assert.match(routePipeline, /\$size/);
});

test("addYouTubeChannelSubscription interpreteaza starea de DINAINTE: deja abonat / limita atinsa concurent", async () => {
  const fresh = makeModel({ youtubeChannels: [] });
  assert.deepEqual(await addYouTubeChannelSubscription(fresh, "guild-1", subscription), { alreadySubscribed: false, limitReached: false });
  assert.deepEqual(fresh.finds[0].options, { upsert: true }, "starea de dinainte (fara new:true) decide mesajul");

  const existing = makeModel({ youtubeChannels: [{ channelId: "yt-1" }] });
  assert.equal((await addYouTubeChannelSubscription(existing, "guild-1", subscription)).alreadySubscribed, true);

  const full = makeModel({ youtubeChannels: Array.from({ length: MAX_YOUTUBE_CHANNELS }, (_v, index) => ({ channelId: `alt-${index}` })) });
  assert.equal((await addYouTubeChannelSubscription(full, "guild-1", subscription)).limitReached, true);
});

test("addYouTubeRouteDestination si addYouTubeTitleWord confirma din documentul actualizat (new:true)", async () => {
  const savedRoute = makeModel({ youtubeChannelRoutes: [{ channelId: "yt-1", discordChannelIds: ["disc-1"] }] });
  assert.deepEqual(await addYouTubeRouteDestination(savedRoute, "guild-1", "yt-1", "disc-1"), { saved: true });
  assert.deepEqual(savedRoute.finds[0].options, { upsert: true, new: true });

  const refusedRoute = makeModel({ youtubeChannelRoutes: [{ channelId: "yt-1", discordChannelIds: ["alta"] }] });
  assert.deepEqual(await addYouTubeRouteDestination(refusedRoute, "guild-1", "yt-1", "disc-1"), { saved: false });

  const savedWord = makeModel({ youtubeTitleIncludeWords: ["patch"] });
  assert.deepEqual(await addYouTubeTitleWord(savedWord, "guild-1", "patch"), { saved: true });
  const refusedWord = makeModel({ youtubeTitleIncludeWords: ["altceva"] });
  assert.deepEqual(await addYouTubeTitleWord(refusedWord, "guild-1", "patch"), { saved: false });
});

test("removeYouTubeChannelSubscription face $pull pe abonare + rute intr-un singur update si raporteaza daca a existat", async () => {
  const model = makeModel();
  assert.equal(await removeYouTubeChannelSubscription(model, "guild-1", "yt-1"), true);
  assert.deepEqual(model.updates[0].update, { $pull: { youtubeChannels: { channelId: "yt-1" }, youtubeChannelRoutes: { channelId: "yt-1" } } });

  const missing = makeModel(null, 0);
  assert.equal(await removeYouTubeChannelSubscription(missing, "guild-1", "yt-x"), false);
});

test("setYouTubeNotificationsEnabled(true) marcheaza si youtubeHasActivated; off nu il atinge", async () => {
  const model = makeModel();
  await setYouTubeNotificationsEnabled(model, "guild-1", true);
  await setYouTubeNotificationsEnabled(model, "guild-1", false);
  assert.deepEqual(model.updates[0].update, { $set: { youtubeNotificationsEnabled: true, youtubeHasActivated: true } });
  assert.deepEqual(model.updates[1].update, { $set: { youtubeNotificationsEnabled: false } });
});

test("removeYouTubeRouteDestination foloseste arrayFilters pe ruta corecta", async () => {
  const model = makeModel();
  await removeYouTubeRouteDestination(model, "guild-1", "yt-1", "disc-1");
  assert.deepEqual(model.updates[0].update, { $pull: { "youtubeChannelRoutes.$[route].discordChannelIds": "disc-1" } });
  assert.deepEqual(model.updates[0].options, { arrayFilters: [{ "route.channelId": "yt-1" }] });
});
