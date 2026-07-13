import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
import test from "node:test";
import assert from "node:assert/strict";
import { load as cheerioLoad } from "cheerio";

const {
  createYouTubeSource,
  parseLengthSeconds,
  videoPassesYouTubeFilters
} = require("../../features/youtube/youtubeSource") as typeof import("../../features/youtube/youtubeSource.js");

const channelId = "UC1234567890123456789012";
const feedXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>yt:video:abcdefghijk</id>
    <yt:videoId>abcdefghijk</yt:videoId>
    <yt:channelId>${channelId}</yt:channelId>
    <title>Videoclip nou</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=abcdefghijk"/>
    <published>2026-06-24T06:00:00+00:00</published>
  </entry>
</feed>`;

test("YouTube source rezolva @handle si normalizeaza identitatea canalului", async () => {
  const requested: string[] = [];
  const source = createYouTubeSource({
    httpReq: async (_method, url) => {
      requested.push(url);
      return {
        data: `<html><head><meta itemprop="channelId" content="${channelId}"><meta property="og:title" content="Canal Test"></head></html>`
      };
    },
    safeCheerioLoad: html => cheerioLoad(String(html))
  });
  const resolved = await source.resolveYouTubeChannel("@canal-test");
  assert.equal(requested[0], "https://www.youtube.com/@canal-test");
  assert.deepEqual(resolved, {
    channelId,
    channelName: "Canal Test",
    channelUrl: `https://www.youtube.com/channel/${channelId}`
  });
});

test("YouTube source parseaza feed-ul oficial si construieste thumbnail stabil", async () => {
  const source = createYouTubeSource({
    httpReq: async () => ({ data: feedXml }),
    safeCheerioLoad: html => cheerioLoad(String(html))
  });
  const videos = await source.fetchYouTubeFeed({
    channelId,
    channelName: "Canal Test",
    channelUrl: `https://www.youtube.com/channel/${channelId}`
  });
  assert.equal(videos.length, 1);
  assert.equal(videos[0].videoId, "abcdefghijk");
  assert.equal(videos[0].title, "Videoclip nou");
  assert.equal(videos[0].thumbnail, "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg");
});

test("YouTube metadata detecteaza durata, Shorts, live si premiere", async () => {
  const pages = [
    `{"lengthSeconds":"45","isShort":true}`,
    `{"lengthSeconds":"3600","isLiveContent":true}`,
    `{"lengthSeconds":"600","isPremiere":true,"isLiveContent":true}`
  ];
  const source = createYouTubeSource({
    httpReq: async () => ({ data: pages.shift() || "" }),
    safeCheerioLoad: html => cheerioLoad(String(html))
  });
  const video = {
    videoId: "abcdefghijk",
    channelId,
    channelName: "Canal Test",
    title: "Video",
    link: "https://www.youtube.com/watch?v=abcdefghijk",
    publishedAt: "",
    thumbnail: ""
  };
  assert.deepEqual(await source.fetchYouTubeVideoMetadata(video), {
    durationSeconds: 45,
    isShort: true,
    isLive: false,
    isPremiere: false
  });
  assert.equal((await source.fetchYouTubeVideoMetadata(video)).isLive, true);
  const premiere = await source.fetchYouTubeVideoMetadata(video);
  assert.equal(premiere.isPremiere, true);
  assert.equal(premiere.isLive, false);
});

test("Filtrele YouTube aplica Shorts, live, premiere si durata minima", () => {
  assert.equal(parseLengthSeconds(`{"lengthSeconds":"61"}`), 61);
  assert.equal(videoPassesYouTubeFilters(
    { durationSeconds: 60, isShort: true, isLive: false, isPremiere: false },
    { excludeShorts: true }
  ), false);
  assert.equal(videoPassesYouTubeFilters(
    { durationSeconds: 120, isShort: false, isLive: true, isPremiere: false },
    { excludeLives: true }
  ), false);
  assert.equal(videoPassesYouTubeFilters(
    { durationSeconds: 120, isShort: false, isLive: false, isPremiere: true },
    { excludePremieres: true }
  ), false);
  assert.equal(videoPassesYouTubeFilters(
    { durationSeconds: 60, isShort: false, isLive: false, isPremiere: false },
    { excludeShorts: false, excludeLives: false, excludePremieres: false, minDurationSeconds: 61 }
  ), false);
});
