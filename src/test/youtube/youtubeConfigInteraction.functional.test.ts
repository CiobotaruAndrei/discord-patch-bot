import test from "node:test";
import assert from "node:assert/strict";
import { createHarness, makeInteraction } from "../youtubeInteractionTestKit.js";

test("/youtube notify channel valideaza permisiunile si /youtube notify on cere configuratie completa", async () => {
  const channelId = "UC1234567890123456789012";
  const harness = createHarness({
    youtubeChannels: [{
      channelId,
      channelName: "Canal Test",
      channelUrl: `https://www.youtube.com/channel/${channelId}`,
      subscribedAt: new Date()
    }],
    youtubeNotificationChannelId: "discord-1"
  });
  await harness.handler.handleYouTubeInteraction(makeInteraction({
    group: "notify",
    subcommand: "channel",
    channelId: "discord-1"
  }));
  await harness.handler.handleYouTubeInteraction(makeInteraction({
    group: "notify",
    subcommand: "on"
  }));
  assert.match(JSON.stringify(harness.writes[0].update), /youtubeNotificationChannelId/);
  assert.match(JSON.stringify(harness.writes[1].update), /youtubeNotificationsEnabled/);
  assert.match(JSON.stringify(harness.writes[1].update), /youtubeHasActivated/);
});

test("/youtube filter actualizeaza filtrele si status afiseaza configuratia", async () => {
  const harness = createHarness();
  await harness.handler.handleYouTubeInteraction(makeInteraction({
    group: "filter",
    subcommand: "shorts",
    strings: { state: "off" }
  }));
  await harness.handler.handleYouTubeInteraction(makeInteraction({
    group: "filter",
    subcommand: "min-duration",
    integers: { seconds: 61 }
  }));
  await harness.handler.handleYouTubeInteraction(makeInteraction({
    group: "filter",
    subcommand: "status"
  }));
  assert.match(JSON.stringify(harness.writes[0].update), /excludeShorts/);
  assert.match(JSON.stringify(harness.writes[1].update), /minDurationSeconds/);
  assert.match(String(harness.replies[2]), /durata minima/);
});

test("/youtube clear-errors curata jurnalul operational", async () => {
  const harness = createHarness();
  await harness.handler.handleYouTubeInteraction(makeInteraction({ subcommand: "clear-errors" }));
  assert.equal(harness.getCleared(), 1);
});

test("/youtube channel-route gestioneaza rute multiple si revenirea la canalul principal", async () => {
  const youtubeChannelId = "UC1234567890123456789012";
  const baseSettings = {
    youtubeChannels: [{
      channelId: youtubeChannelId,
      channelName: "Canal Test",
      channelUrl: `https://www.youtube.com/channel/${youtubeChannelId}`,
      subscribedAt: new Date()
    }]
  };
  const addHarness = createHarness(baseSettings);
  await addHarness.handler.handleYouTubeInteraction(makeInteraction({
    group: "add",
    subcommand: "channel-route",
    strings: { canal: youtubeChannelId },
    channelId: "123456789012345678"
  }));
  assert.match(JSON.stringify(addHarness.writes[0].update), /youtubeChannelRoutes/);

  const removeHarness = createHarness({
    ...baseSettings,
    youtubeChannelRoutes: [{
      channelId: youtubeChannelId,
      discordChannelIds: ["123456789012345678"]
    }]
  });
  await removeHarness.handler.handleYouTubeInteraction(makeInteraction({
    group: "remove",
    subcommand: "channel-route",
    strings: { canal: youtubeChannelId, discord: "toate" }
  }));
  assert.match(JSON.stringify(removeHarness.writes[0].update), /\$pull/);
  assert.match(String(removeHarness.replies[0]), /canalul principal/);
});

test("/youtube channel-route add refuza un nou canal Discord peste limita de fanout per canal YouTube", async () => {
  const youtubeChannelId = "UC1234567890123456789012";
  const harness = createHarness({
    youtubeChannels: [{
      channelId: youtubeChannelId,
      channelName: "Canal Test",
      channelUrl: `https://www.youtube.com/channel/${youtubeChannelId}`,
      subscribedAt: new Date()
    }],
    youtubeChannelRoutes: [{
      channelId: youtubeChannelId,
      discordChannelIds: ["100", "200", "300", "400", "500"]
    }]
  });
  await harness.handler.handleYouTubeInteraction(makeInteraction({
    group: "add",
    subcommand: "channel-route",
    strings: { canal: youtubeChannelId },
    channelId: "999999999999999999"
  }));
  assert.equal(harness.writes.length, 0, "nu se scrie nicio ruta noua peste limita de fanout");
  assert.match(String(harness.replies[0]), /limita/);
});

test("/youtube channel-route add accepta re-adaugarea unui canal deja existent (idempotent, nu numara dublu)", async () => {
  const youtubeChannelId = "UC1234567890123456789012";
  const harness = createHarness({
    youtubeChannels: [{
      channelId: youtubeChannelId,
      channelName: "Canal Test",
      channelUrl: `https://www.youtube.com/channel/${youtubeChannelId}`,
      subscribedAt: new Date()
    }],
    youtubeChannelRoutes: [{
      channelId: youtubeChannelId,
      discordChannelIds: ["100", "200", "300", "400", "500"]
    }]
  });
  await harness.handler.handleYouTubeInteraction(makeInteraction({
    group: "add",
    subcommand: "channel-route",
    strings: { canal: youtubeChannelId },
    channelId: "300"
  }));
  assert.equal(harness.writes.length, 1, "re-adaugarea unui canal deja prezent trece (addToSet idempotent)");
});

test("/youtube title-filter gestioneaza lista inclusiva fara duplicate", async () => {
  const harness = createHarness();
  await harness.handler.handleYouTubeInteraction(makeInteraction({
    group: "add",
    subcommand: "title-filter",
    strings: { word: "Patch Notes" }
  }));
  assert.ok(Array.isArray(harness.writes[0].update), "title-filter add salveaza printr-un pipeline atomic");
  assert.match(JSON.stringify(harness.writes[0].update), /patch notes/);
  assert.match(String(harness.replies[0]), /a fost adaugat/);

  const listed = createHarness({ youtubeTitleIncludeWords: ["patch notes", "update"] });
  await listed.handler.handleYouTubeInteraction(makeInteraction({
    group: "title-filter",
    subcommand: "list"
  }));
  assert.match(JSON.stringify(listed.replies[0]), /patch notes/);
  assert.match(JSON.stringify(listed.replies[0]), /update/);
});

test("/youtube add title-filter refuza la limita atinsa concurent (atomic) (R[Medium-Low] #3)", async () => {
  const harness = createHarness({ youtubeTitleIncludeWords: ["a", "b", "c"] }, 3, false, 0, {
    findOneAndUpdate: async () => ({ youtubeTitleIncludeWords: Array.from({ length: 10 }, (_unused, index) => `w${index}`) })
  });
  await harness.handler.handleYouTubeInteraction(makeInteraction({ group: "add", subcommand: "title-filter", strings: { word: "Patch Notes" } }));
  assert.ok(Array.isArray(harness.writes[0].update), "title-filter add foloseste pipeline atomic");
  assert.match(String(harness.replies.at(-1)), /comanda concurenta/, "daca o comanda concurenta a umplut limita, raspunde eroare in loc sa depaseasca");
});

test("/youtube channel-route add refuza fanout-ul atins concurent (atomic) (R[Medium] #2)", async () => {
  const youtubeChannelId = "UC1234567890123456789012";
  const baseChannel = { channelId: youtubeChannelId, channelName: "Canal Test", channelUrl: `https://www.youtube.com/channel/${youtubeChannelId}`, subscribedAt: new Date() };
  const harness = createHarness({
    youtubeChannels: [baseChannel],
    youtubeChannelRoutes: [{ channelId: youtubeChannelId, discordChannelIds: ["100", "200", "300", "400"] }]
  }, 3, false, 0, {
    findOneAndUpdate: async () => ({ youtubeChannelRoutes: [{ channelId: youtubeChannelId, discordChannelIds: ["100", "200", "300", "400", "500"] }] })
  });
  await harness.handler.handleYouTubeInteraction(makeInteraction({ group: "add", subcommand: "channel-route", strings: { canal: youtubeChannelId }, channelId: "999999999999999999" }));
  assert.ok(Array.isArray(harness.writes[0].update), "ruta se adauga printr-un pipeline atomic");
  assert.match(String(harness.replies.at(-1)), /limita/, "daca o comanda concurenta a umplut fanout-ul, raspunde eroare in loc sa depaseasca");
});

test("/youtube notify channel blocheaza configurarea fara View Channel (R[Medium] #3)", async () => {
  const harness = createHarness({}, 3, false, 0, {
    checkChannelPermissions: async () => ({ viewChannel: false, sendMessages: true, embedLinks: true, readMessageHistory: true })
  });
  await harness.handler.handleYouTubeInteraction(makeInteraction({ group: "notify", subcommand: "channel", channelId: "111111111111111111" }));
  assert.equal(harness.writes.length, 0, "fara View Channel nu se salveaza canalul");
  assert.match(String(harness.replies.at(-1)), /View Channel/, "mesajul listeaza permisiunea lipsa View Channel");
});

