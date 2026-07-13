import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_YOUTUBE_MESSAGE_TEMPLATE,
  MAX_YOUTUBE_ROUTE_DESTINATIONS,
  isRecentYouTubeVideo,
  normalizeYouTubeTitleWord,
  parseDiscordChannelReference,
  renderYouTubeMessageTemplate,
  validateYouTubeMessageTemplate,
  videoPassesYouTubeTitleFilter,
  youtubeDestinationIds
} from "../../features/youtube/youtubeDeliveryPolicy.js";

const channel = {
  channelId: "UC123",
  channelName: "Creator",
  channelUrl: "https://www.youtube.com/channel/UC123",
  subscribedAt: new Date()
};

const video = {
  videoId: "abcdefghijk",
  channelId: channel.channelId,
  channelName: channel.channelName,
  title: "Patch Notes 2.0",
  link: "https://www.youtube.com/watch?v=abcdefghijk",
  publishedAt: "2026-06-24T06:00:00.000Z",
  thumbnail: ""
};

test("politica YouTube valideaza si reda numai variabilele de sablon acceptate", () => {
  assert.equal(
    renderYouTubeMessageTemplate("{channel}: {title} {url}", channel, video),
    "Creator: Patch Notes 2.0 https://www.youtube.com/watch?v=abcdefghijk"
  );
  assert.match(renderYouTubeMessageTemplate(null, channel, video), /Videoclip nou de la Creator/);
  assert.equal(validateYouTubeMessageTemplate(DEFAULT_YOUTUBE_MESSAGE_TEMPLATE), DEFAULT_YOUTUBE_MESSAGE_TEMPLATE);
  assert.throws(() => validateYouTubeMessageTemplate("{role}"), /nu este acceptata/);
});

test("politica YouTube aplica filtrul inclusiv fara sensibilitate la litere", () => {
  assert.equal(normalizeYouTubeTitleWord("  PATCH   Notes "), "patch notes");
  assert.equal(videoPassesYouTubeTitleFilter(video, ["patch notes"]), true);
  assert.equal(videoPassesYouTubeTitleFilter(video, ["trailer"]), false);
  assert.equal(videoPassesYouTubeTitleFilter(video, []), true);
});

test("politica YouTube limiteaza continutul la ultima luna", () => {
  const now = new Date("2026-06-25T06:00:00.000Z");
  assert.equal(isRecentYouTubeVideo(video, now), true);
  assert.equal(isRecentYouTubeVideo({ ...video, publishedAt: "2026-04-01T06:00:00.000Z" }, now), false);
});

test("politica YouTube prefera rutele speciale si valideaza referintele Discord", () => {
  assert.deepEqual(youtubeDestinationIds({
    _id: "g1",
    youtubeNotificationChannelId: "main",
    youtubeChannelRoutes: [{ channelId: "UC123", discordChannelIds: ["route", "route"] }]
  }, "UC123"), ["route"]);
  assert.deepEqual(youtubeDestinationIds({
    _id: "g1",
    youtubeNotificationChannelId: "main"
  }, "UC123"), ["main"]);
  assert.equal(parseDiscordChannelReference("<#123456789012345678>"), "123456789012345678");
  assert.equal(parseDiscordChannelReference("invalid"), null);
});

test("politica YouTube limiteaza fanout-ul la livrare chiar daca datele vechi/corupte au mai multe rute decat limita", () => {
  const manyDestinations = Array.from({ length: 20 }, (_value, index) => `route-${index}`);
  const result = youtubeDestinationIds({
    _id: "g1",
    youtubeNotificationChannelId: "main",
    youtubeChannelRoutes: [{ channelId: "UC123", discordChannelIds: manyDestinations }]
  }, "UC123");
  assert.equal(result.length, MAX_YOUTUBE_ROUTE_DESTINATIONS, "livrarea foloseste cel mult limita, nu toate cele 20 din DB");
  assert.deepEqual(result, manyDestinations.slice(0, MAX_YOUTUBE_ROUTE_DESTINATIONS), "pastreaza primele destinatii, in ordine");
});
