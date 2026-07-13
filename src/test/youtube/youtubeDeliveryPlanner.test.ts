import test from "node:test";
import assert from "node:assert/strict";

import type { YouTubeChannelSubscription, YouTubeVideo, YouTubeVideoMetadata } from "../../types.js";
import {
  buildYouTubeEmbed,
  packYouTubeDeliveries,
  sortedVideos,
  type PreparedVideo
} from "../../features/youtube/youtubeDeliveryPlanner.js";
import { YOUTUBE_BATCH_SIZE } from "../../features/youtube/youtubeDeliveryPolicy.js";

function makeChannel(overrides: Partial<YouTubeChannelSubscription> = {}): YouTubeChannelSubscription {
  return {
    channelId: "UC123",
    channelName: "Canal Test",
    channelUrl: "https://youtube.com/@canaltest",
    subscribedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function makeVideo(overrides: Partial<YouTubeVideo> = {}): YouTubeVideo {
  return {
    videoId: "vid-1",
    channelId: "UC123",
    channelName: "Canal Test",
    title: "Titlu video",
    link: "https://youtu.be/vid-1",
    publishedAt: "2026-07-01T10:00:00.000Z",
    thumbnail: "https://img.youtube.com/vi/vid-1/hqdefault.jpg",
    ...overrides
  };
}

function makeMetadata(overrides: Partial<YouTubeVideoMetadata> = {}): YouTubeVideoMetadata {
  return {
    durationSeconds: 125,
    isShort: false,
    isLive: false,
    isPremiere: false,
    ...overrides
  };
}

function makePrepared(overrides: {
  channel?: Partial<YouTubeChannelSubscription>;
  video?: Partial<YouTubeVideo>;
  metadata?: Partial<YouTubeVideoMetadata>;
} = {}): PreparedVideo {
  return {
    channel: makeChannel(overrides.channel),
    video: makeVideo(overrides.video),
    metadata: makeMetadata(overrides.metadata)
  };
}

test("sortedVideos ordoneaza cronologic crescator fara sa mute input-ul", () => {
  const newest = makeVideo({ videoId: "c", publishedAt: "2026-07-01T12:00:00.000Z" });
  const oldest = makeVideo({ videoId: "a", publishedAt: "2026-07-01T08:00:00.000Z" });
  const middle = makeVideo({ videoId: "b", publishedAt: "2026-07-01T10:00:00.000Z" });
  const input = [newest, oldest, middle];

  const result = sortedVideos(input);

  assert.deepEqual(result.map(video => video.videoId), ["a", "b", "c"]);
  assert.deepEqual(input.map(video => video.videoId), ["c", "a", "b"]);
});

test("sortedVideos trateaza datele neparsabile ca cele mai vechi", () => {
  const broken = makeVideo({ videoId: "broken", publishedAt: "nu-e-data" });
  const valid = makeVideo({ videoId: "valid", publishedAt: "2026-07-01T10:00:00.000Z" });

  const result = sortedVideos([valid, broken]);

  assert.deepEqual(result.map(video => video.videoId), ["broken", "valid"]);
});

test("buildYouTubeEmbed formateaza durata in minute si secunde", () => {
  const embed = buildYouTubeEmbed(makePrepared({ metadata: { durationSeconds: 125 } })) as {
    title: string;
    url: string;
    description: string;
    thumbnail: { url: string };
    fields: Array<{ name: string; value: string; inline: boolean }>;
    timestamp: string;
  };

  assert.equal(embed.title, "Titlu video");
  assert.equal(embed.url, "https://youtu.be/vid-1");
  assert.equal(embed.description, "Videoclip nou de la **Canal Test**");
  assert.equal(embed.thumbnail.url, "https://img.youtube.com/vi/vid-1/hqdefault.jpg");
  assert.equal(embed.fields[0]?.value, "2m 5s");
  assert.equal(embed.fields[1]?.value, "[Canal Test](https://youtube.com/@canaltest)");
  assert.equal(embed.timestamp, "2026-07-01T10:00:00.000Z");
});

test("buildYouTubeEmbed marcheaza durata necunoscuta si completeaza timestamp lipsa", () => {
  const before = Date.now();
  const embed = buildYouTubeEmbed(
    makePrepared({ metadata: { durationSeconds: null }, video: { publishedAt: "" } })
  ) as { fields: Array<{ value: string }>; timestamp: string };
  const after = Date.now();

  assert.equal(embed.fields[0]?.value, "necunoscuta");
  const stamp = Date.parse(embed.timestamp);
  assert.ok(stamp >= before && stamp <= after);
});

test("packYouTubeDeliveries imparte loturile la limita de marime", () => {
  const items = Array.from({ length: YOUTUBE_BATCH_SIZE + 2 }, (_, index) =>
    makePrepared({ video: { videoId: `vid-${index}` } })
  );

  const batches = packYouTubeDeliveries(items, null);

  assert.equal(batches.length, 2);
  assert.equal(batches[0]?.length, YOUTUBE_BATCH_SIZE);
  assert.equal(batches[1]?.length, 2);
  assert.deepEqual(
    batches.flat().map(item => item.video.videoId),
    items.map(item => item.video.videoId)
  );
});

test("packYouTubeDeliveries imparte loturile la bugetul de caractere pentru embed-uri", () => {
  const hugeTitle = "T".repeat(3000);
  const items = [
    makePrepared({ video: { videoId: "big-1", title: hugeTitle } }),
    makePrepared({ video: { videoId: "big-2", title: hugeTitle } })
  ];

  const batches = packYouTubeDeliveries(items, "{url}");

  assert.equal(batches.length, 2);
  assert.deepEqual(batches.map(batch => batch.map(item => item.video.videoId)), [["big-1"], ["big-2"]]);
});

test("packYouTubeDeliveries imparte loturile la bugetul de caractere pentru continut", () => {
  const longTemplate = "x".repeat(1000);
  const items = [
    makePrepared({ video: { videoId: "c-1" } }),
    makePrepared({ video: { videoId: "c-2" } }),
    makePrepared({ video: { videoId: "c-3" } })
  ];

  const batches = packYouTubeDeliveries(items, longTemplate);

  assert.equal(batches.length, 3);
  assert.ok(batches.every(batch => batch.length === 1));
});

test("packYouTubeDeliveries intoarce lista goala pentru input gol", () => {
  assert.deepEqual(packYouTubeDeliveries([], null), []);
});
