import test from "node:test";
import assert from "node:assert/strict";

const installYouTube = require("../features/command-handlers/youtubeInteractionHandler") as typeof import("../features/command-handlers/youtubeInteractionHandler");
type HandlerDeps = Parameters<typeof installYouTube.createYouTubeInteractionHandler>[0];
type HandlerInteraction = Parameters<ReturnType<typeof installYouTube.createYouTubeInteractionHandler>["handleYouTubeInteraction"]>[0];

interface InteractionOptions {
  group?: string | null;
  subcommand: string;
  strings?: Record<string, string>;
  integers?: Record<string, number>;
  channelId?: string;
}

function makeInteraction(options: InteractionOptions): HandlerInteraction {
  return {
    commandName: "youtube",
    guild: { id: "guild-1" },
    client: { user: { id: "bot" }, channels: { fetch: async () => null } },
    isChatInputCommand: () => true,
    options: {
      getSubcommand: () => options.subcommand,
      getSubcommandGroup: () => options.group || null,
      getString: name => options.strings?.[name] ?? null,
      getInteger: name => options.integers?.[name] ?? null,
      getChannel: () => options.channelId ? { id: options.channelId } : null
    }
  };
}

function createHarness(settingsOverrides: object = {}, preparedCount = 3) {
  const replies: unknown[] = [];
  const writes: Array<{ filter: object; update: object; options?: object }> = [];
  const seeded: string[][] = [];
  const removed: string[] = [];
  const manualShows: string[] = [];
  const manualDeliveries: number[] = [];
  let cleared = 0;
  const settings = {
    _id: "guild-1",
    youtubeChannels: [],
    youtubeNotificationChannelId: null,
    youtubeNotificationsEnabled: false,
    youtubeFilters: {
      excludeShorts: true,
      excludeLives: true,
      excludePremieres: true,
      minDurationSeconds: 0
    },
    youtubeErrors: [],
    ...settingsOverrides
  };
  const deps = {
    GuildModel: {
      updateOne: async (filter, update, options) => {
        writes.push({ filter, update, options });
        return { matchedCount: 1, modifiedCount: 1 };
      }
    },
    getGuildSettings: async () => settings,
    invalidateGuildCache: () => undefined,
    resolveYouTubeChannel: async () => ({
      channelId: "UC1234567890123456789012",
      channelName: "Canal Test",
      channelUrl: "https://www.youtube.com/channel/UC1234567890123456789012"
    }),
    fetchYouTubeFeed: async () => [{
      videoId: "abcdefghijk",
      channelId: "UC1234567890123456789012",
      channelName: "Canal Test",
      title: "Video",
      link: "https://www.youtube.com/watch?v=abcdefghijk",
      publishedAt: "2026-06-24T06:00:00.000Z",
      thumbnail: ""
    }],
    seedSeenVideos: async (_guildId, _channelId, videos) => { seeded.push(videos.map(video => video.videoId)); },
    removeSeenChannel: async (_guildId, channelId) => { removed.push(channelId); },
    clearYouTubeErrors: async () => { cleared++; },
    showYouTubeVideos: async (_client, _guild, selectedChannelId) => {
      manualShows.push(selectedChannelId);
      return { videos: 3, batches: 1, destinations: 1 };
    },
    prepareManualYouTubeVideos: async (_guild, selectedChannelId) => {
      manualShows.push(selectedChannelId);
      return Array.from({ length: preparedCount }, (_unused, index) => ({
        channel: { channelId: `UC${index}`, channelName: "x", channelUrl: "https://www.youtube.com/x", subscribedAt: new Date() },
        video: { videoId: `v${index}`, channelId: `UC${index}`, channelName: "x", title: "t", link: "https://www.youtube.com/watch?v=x", publishedAt: "2026-06-24T06:00:00.000Z", thumbnail: "" },
        metadata: { durationSeconds: 120, isShort: false, isLive: false, isPremiere: false }
      }));
    },
    deliverManualYouTubeVideos: async (_client, _guild, prepared) => {
      manualDeliveries.push(prepared.length);
      return { videos: prepared.length, batches: 1, destinations: 1 };
    },
    checkChannelPermissions: async () => ({
      sendMessages: true,
      embedLinks: true,
      readMessageHistory: true
    }),
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload) => { replies.push(payload); return {}; },
    formatUserError: (_error, fallback) => fallback,
    logger: () => undefined,
    MessageFlags: { Ephemeral: 64 }
  } satisfies HandlerDeps;
  return {
    handler: installYouTube.createYouTubeInteractionHandler(deps),
    replies,
    writes,
    seeded,
    removed,
    manualShows,
    manualDeliveries,
    getCleared: () => cleared
  };
}

test("/youtube subscribe pastreaza nevazute videoclipurile recente si salveaza abonarea", async () => {
  const harness = createHarness();
  await harness.handler.handleYouTubeInteraction(makeInteraction({
    subcommand: "subscribe",
    strings: { canal: "@canal-test" }
  }));
  assert.deepEqual(harness.seeded, [[]]);
  assert.equal(harness.writes.length, 1);
  assert.match(JSON.stringify(harness.writes[0].update), /youtubeChannels/);
  assert.match(String(harness.replies[0]), /o luna/);
});

test("/youtube unsubscribe foloseste channel ID-ul din autocomplete si curata deduplicarea", async () => {
  const channelId = "UC1234567890123456789012";
  const harness = createHarness({
    youtubeChannels: [{
      channelId,
      channelName: "Canal Test",
      channelUrl: `https://www.youtube.com/channel/${channelId}`,
      subscribedAt: new Date()
    }]
  });
  await harness.handler.handleYouTubeInteraction(makeInteraction({
    subcommand: "unsubscribe",
    strings: { canal: channelId }
  }));
  assert.deepEqual(harness.removed, [channelId]);
  assert.match(JSON.stringify(harness.writes[0].update), /\$pull/);
});

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

test("/youtube errors, permissions si clear-errors expun mentenanta modulului", async () => {
  const harness = createHarness({
    youtubeNotificationChannelId: "discord-1",
    youtubeErrors: [{
      channelId: "UC1234567890123456789012",
      channelName: "Canal Test",
      message: "feed indisponibil",
      at: new Date("2026-06-24T06:00:00.000Z")
    }]
  });
  await harness.handler.handleYouTubeInteraction(makeInteraction({ subcommand: "errors" }));
  await harness.handler.handleYouTubeInteraction(makeInteraction({ subcommand: "permissions" }));
  await harness.handler.handleYouTubeInteraction(makeInteraction({ subcommand: "clear-errors" }));
  assert.match(JSON.stringify(harness.replies[0]), /feed indisponibil/);
  assert.match(String(harness.replies[1]), /Send Messages: ON/);
  assert.equal(harness.getCleared(), 1);
});

test("/youtube errors taie raspunsul sub limita Discord cand erorile sunt multe si lungi", async () => {
  const longMessage = "x".repeat(500);
  const harness = createHarness({
    youtubeErrors: Array.from({ length: 10 }, (_value, index) => ({
      channelId: `UC${index}`,
      channelName: `Canal ${index}`,
      message: longMessage,
      at: new Date("2026-06-24T06:00:00.000Z")
    }))
  });
  await harness.handler.handleYouTubeInteraction(makeInteraction({ subcommand: "errors" }));
  const reply = harness.replies[0];
  const content = typeof reply === "string" ? reply : String((reply as { content?: unknown }).content ?? "");
  assert.ok(content.length <= 2000, `raspunsul /youtube errors (${content.length}) trebuie sa ramana sub limita Discord`);
  assert.match(content, /si inca \d+/, "include nota de trunchiere");
});

test("/youtube message-template valideaza variabilele, salveaza si reseteaza sablonul", async () => {
  const harness = createHarness();
  await harness.handler.handleYouTubeInteraction(makeInteraction({
    group: "message-template",
    subcommand: "set",
    strings: { text: "Nou de la {channel}: {title} {url}" }
  }));
  await harness.handler.handleYouTubeInteraction(makeInteraction({
    group: "message-template",
    subcommand: "reset"
  }));
  assert.match(JSON.stringify(harness.writes[0].update), /youtubeMessageTemplate/);
  assert.match(JSON.stringify(harness.writes[1].update), /null/);

  const invalid = createHarness();
  await invalid.handler.handleYouTubeInteraction(makeInteraction({
    group: "message-template",
    subcommand: "set",
    strings: { text: "{unknown}" }
  }));
  assert.equal(invalid.writes.length, 0);
  assert.match(String(invalid.replies[0]), /nu este acceptata/);
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
    group: "channel-route",
    subcommand: "add",
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
    group: "channel-route",
    subcommand: "remove",
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
    group: "channel-route",
    subcommand: "add",
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
    group: "channel-route",
    subcommand: "add",
    strings: { canal: youtubeChannelId },
    channelId: "300"
  }));
  assert.equal(harness.writes.length, 1, "re-adaugarea unui canal deja prezent trece (addToSet idempotent)");
});

test("/youtube title-filter gestioneaza lista inclusiva fara duplicate", async () => {
  const harness = createHarness();
  await harness.handler.handleYouTubeInteraction(makeInteraction({
    group: "title-filter",
    subcommand: "add",
    strings: { word: "Patch Notes" }
  }));
  assert.match(JSON.stringify(harness.writes[0].update), /patch notes/);

  const listed = createHarness({ youtubeTitleIncludeWords: ["patch notes", "update"] });
  await listed.handler.handleYouTubeInteraction(makeInteraction({
    group: "title-filter",
    subcommand: "list"
  }));
  assert.match(String(listed.replies[0]), /patch notes/);
  assert.match(String(listed.replies[0]), /update/);
});

test("/youtube videos show porneste afisarea manuala pentru toate canalele", async () => {
  const channelId = "UC1234567890123456789012";
  const harness = createHarness({
    youtubeNotificationChannelId: "discord-main",
    youtubeChannels: [{
      channelId,
      channelName: "Canal Test",
      channelUrl: `https://www.youtube.com/channel/${channelId}`,
      subscribedAt: new Date()
    }]
  });
  await harness.handler.handleYouTubeInteraction(makeInteraction({
    group: "videos",
    subcommand: "show",
    strings: { canal: "toate" }
  }));
  assert.deepEqual(harness.manualShows, ["toate"], "pregatirea (rapida) a fost apelata");
  assert.match(String(harness.replies[0]), /am postat 3/, "raspunde cu cate videoclipuri a postat imediat");
  assert.deepEqual(harness.manualDeliveries, [3], "cele 3 videoclipuri (sub limita de lot) se livreaza imediat si durabil, nu in fundal");
});

test("/youtube videos show livreaza primul lot imediat (durabil) si trimite restul in fundal pentru selectii mari", async () => {
  const channelId = "UC1234567890123456789012";
  const harness = createHarness({
    youtubeNotificationChannelId: "discord-main",
    youtubeChannels: [{
      channelId,
      channelName: "Canal Test",
      channelUrl: `https://www.youtube.com/channel/${channelId}`,
      subscribedAt: new Date()
    }]
  }, 7);
  await harness.handler.handleYouTubeInteraction(makeInteraction({
    group: "videos",
    subcommand: "show",
    strings: { canal: "toate" }
  }));
  assert.deepEqual(harness.manualDeliveries, [5, 2], "primul lot de 5 imediat (sincron), restul de 2 in fundal");
  assert.match(String(harness.replies[0]), /imediat primele 5/, "raporteaza primul lot livrat imediat");
  assert.match(String(harness.replies[0]), /Restul de 2/, "raporteaza cate raman in fundal");
});

test("/youtube videos show fara canal de destinatie configurat nu programeaza nimic si cere /youtube notify channel", async () => {
  const channelId = "UC1234567890123456789012";
  const harness = createHarness({
    youtubeNotificationChannelId: null,
    youtubeChannelRoutes: [],
    youtubeChannels: [{
      channelId,
      channelName: "Canal Test",
      channelUrl: `https://www.youtube.com/channel/${channelId}`,
      subscribedAt: new Date()
    }]
  });
  await harness.handler.handleYouTubeInteraction(makeInteraction({
    group: "videos",
    subcommand: "show",
    strings: { canal: "toate" }
  }));
  assert.deepEqual(harness.manualDeliveries, [], "nu se programeaza nicio livrare cand nu exista destinatie");
  assert.match(String(harness.replies[0]), /niciun canal de destinatie/, "raspunde clar ca lipseste destinatia");
  assert.match(String(harness.replies[0]), /youtube notify channel/, "indruma spre configurarea canalului");
});

test("/youtube videos show fara videoclipuri recente nu programeaza nicio livrare in fundal", async () => {
  const channelId = "UC1234567890123456789012";
  const harness = createHarness({
    youtubeChannels: [{
      channelId,
      channelName: "Canal Test",
      channelUrl: `https://www.youtube.com/channel/${channelId}`,
      subscribedAt: new Date()
    }]
  }, 0);
  await harness.handler.handleYouTubeInteraction(makeInteraction({
    group: "videos",
    subcommand: "show",
    strings: { canal: "toate" }
  }));
  assert.deepEqual(harness.manualShows, ["toate"], "pregatirea a fost apelata");
  assert.match(String(harness.replies[0]), /nu exista videoclipuri/, "raspunde ca nu sunt videoclipuri recente");
  assert.deepEqual(harness.manualDeliveries, [], "nu se programeaza nicio livrare in fundal");
});
