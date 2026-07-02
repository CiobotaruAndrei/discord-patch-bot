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
  booleans?: Record<string, boolean>;
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
      getBoolean: name => options.booleans?.[name] ?? null,
      getChannel: () => options.channelId ? { id: options.channelId } : null
    }
  };
}

type FindOneAndUpdateImpl = (filter: object, update: object, options?: object) => Promise<{ youtubeChannels?: Array<{ channelId: string }>; youtubeChannelRoutes?: Array<{ channelId: string; discordChannelIds: string[] }>; youtubeTitleIncludeWords?: string[] } | null>;
type HarnessOverrides = {
  findOneAndUpdate?: FindOneAndUpdateImpl;
  checkChannelPermissions?: () => Promise<{ viewChannel: boolean; sendMessages: boolean; embedLinks: boolean; readMessageHistory: boolean } | null>;
  removeSeenChannel?: (guildId: string, channelId: string) => Promise<void>;
};

function createHarness(settingsOverrides: object = {}, preparedCount = 3, outboxEnabled = false, skippedCount = 0, overrides: HarnessOverrides = {}) {
  const findOneAndUpdateOverride = overrides.findOneAndUpdate;
  const replies: unknown[] = [];
  const writes: Array<{ filter: object; update: object; options?: object }> = [];
  const seeded: string[][] = [];
  const removed: string[] = [];
  const invalidated: string[] = [];
  const manualShows: string[] = [];
  const manualDeliveries: number[] = [];
  const manualBypassOutbox: boolean[] = [];
  const manualClaimed: boolean[] = [];
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
      },
      findOneAndUpdate: async (filter, update, options) => {
        writes.push({ filter, update, options });
        if (findOneAndUpdateOverride) return findOneAndUpdateOverride(filter, update, options);
        const stage = (Array.isArray(update) ? update[0] : {}) as { $set?: Record<string, unknown> };
        if (stage.$set && "youtubeChannels" in stage.$set) {
          return { youtubeChannels: settings.youtubeChannels || [] };
        }
        if (stage.$set && "youtubeTitleIncludeWords" in stage.$set) {
          const word = (((((((stage.$set?.youtubeTitleIncludeWords as { $let?: { in?: { $cond?: unknown[] } } })?.$let)?.in)?.$cond)?.[2]) as { $concatArrays?: unknown[] })?.$concatArrays)?.[1] as string[] | undefined;
          const current = (settings as { youtubeTitleIncludeWords?: string[] }).youtubeTitleIncludeWords || [];
          const next = [...current];
          const newWord = word?.[0];
          if (newWord && !next.includes(newWord) && next.length < 10) next.push(newWord);
          return { youtubeTitleIncludeWords: next };
        }
        const literal = (((((((stage.$set?.youtubeChannelRoutes as { $let?: { in?: { $cond?: unknown[] } } })?.$let)?.in)?.$cond)?.[2]) as { $concatArrays?: unknown[] })?.$concatArrays)?.[1] as Array<{ channelId: string; discordChannelIds: string[] }> | undefined;
        const newRoute = literal?.[0];
        const currentRoutes = (settings as { youtubeChannelRoutes?: Array<{ channelId: string; discordChannelIds: string[] }> }).youtubeChannelRoutes || [];
        const routes = currentRoutes.map(route => ({ ...route, discordChannelIds: [...(route.discordChannelIds || [])] }));
        if (newRoute) {
          const existingRoute = routes.find(route => route.channelId === newRoute.channelId);
          const discordId = newRoute.discordChannelIds[0];
          if (existingRoute) {
            if (!existingRoute.discordChannelIds.includes(discordId) && existingRoute.discordChannelIds.length < 5) {
              existingRoute.discordChannelIds.push(discordId);
            }
          } else {
            routes.push(newRoute);
          }
        }
        return { youtubeChannelRoutes: routes };
      }
    },
    getGuildSettings: async () => settings,
    invalidateGuildCache: (guildId: string) => { invalidated.push(guildId); },
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
    removeSeenChannel: overrides.removeSeenChannel || (async (_guildId, channelId) => { removed.push(channelId); }),
    clearYouTubeErrors: async () => { cleared++; },
    prepareManualYouTubeVideos: async (_guild, selectedChannelId, force = false) => {
      manualShows.push(selectedChannelId);
      return {
        deliverable: Array.from({ length: preparedCount }, (_unused, index) => ({
          channel: { channelId: `UC${index}`, channelName: "x", channelUrl: "https://www.youtube.com/x", subscribedAt: new Date() },
          video: { videoId: `v${index}`, channelId: `UC${index}`, channelName: "x", title: "t", link: "https://www.youtube.com/watch?v=x", publishedAt: "2026-06-24T06:00:00.000Z", thumbnail: "" },
          metadata: { durationSeconds: 120, isShort: false, isLive: false, isPremiere: false }
        })),
        skipped: skippedCount,
        claimed: !force
      };
    },
    deliverManualYouTubeVideos: async (_client, _guild, batch, bypassOutbox = true) => {
      manualDeliveries.push(batch.items.length);
      manualBypassOutbox.push(bypassOutbox);
      manualClaimed.push(batch.claimed);
      return { videos: batch.items.length, batches: 1, destinations: 1 };
    },
    checkChannelPermissions: overrides.checkChannelPermissions || (async () => ({
      viewChannel: true,
      sendMessages: true,
      embedLinks: true,
      readMessageHistory: true
    })),
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload) => { replies.push(payload); return {}; },
    formatUserError: (_error, fallback) => fallback,
    logger: () => undefined,
    MessageFlags: { Ephemeral: 64 },
    outboxEnabled
  } satisfies HandlerDeps;
  return {
    handler: installYouTube.createYouTubeInteractionHandler(deps),
    replies,
    writes,
    seeded,
    removed,
    invalidated,
    manualShows,
    manualDeliveries,
    manualClaimed,
    manualBypassOutbox,
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

test("/youtube subscribe: limita atinsa CONCURENT => baseline-ul seen abia scris e curatat (rollback, R[Arh] #6)", async () => {
  const fullChannels = Array.from({ length: 25 }, (_v, index) => ({ channelId: `UCalt${index}` }));
  const harness = createHarness({}, 3, false, 0, {
    findOneAndUpdate: async () => ({ youtubeChannels: fullChannels })
  });

  await harness.handler.handleYouTubeInteraction(makeInteraction({
    subcommand: "subscribe",
    strings: { canal: "@canal-test" }
  }));

  assert.equal(harness.seeded.length, 1, "baseline-ul seen a fost scris inainte de refuzul concurent");
  assert.deepEqual(harness.removed, ["UC1234567890123456789012"], "refuzul concurent curata baseline-ul seen abia scris (fara intrari orfane)");
  assert.match(String(harness.replies[0]), /o comanda concurenta/);
});

test("/youtube subscribe: salvarea abonarii arunca => baseline-ul seen e curatat si eroarea se propaga (R[Arh] #6)", async () => {
  const harness = createHarness({}, 3, false, 0, {
    findOneAndUpdate: async () => { throw new Error("mongo indisponibil la salvare"); }
  });

  await assert.rejects(
    () => harness.handler.handleYouTubeInteraction(makeInteraction({
      subcommand: "subscribe",
      strings: { canal: "@canal-test" }
    })),
    /mongo indisponibil/
  );

  assert.deepEqual(harness.removed, ["UC1234567890123456789012"], "esecul salvarii curata baseline-ul seen inainte sa propage eroarea");
});

test("/youtube subscribe: esecul rollback-ului nu mascheaza eroarea originala de salvare (best-effort + log)", async () => {
  const harness = createHarness({}, 3, false, 0, {
    findOneAndUpdate: async () => { throw new Error("mongo indisponibil la salvare"); },
    removeSeenChannel: async () => { throw new Error("si colectia seen e indisponibila"); }
  });

  await assert.rejects(
    () => harness.handler.handleYouTubeInteraction(makeInteraction({
      subcommand: "subscribe",
      strings: { canal: "@canal-test" }
    })),
    /mongo indisponibil la salvare/
  );
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
  assert.match(String(harness.replies[1]), /<#discord-1>: View Channel ON \| Send Messages ON/);
  assert.equal(harness.getCleared(), 1);
});

test("/youtube permissions verifica si canalele din rutele speciale, nu doar canalul principal", async () => {
  const harness = createHarness({
    youtubeNotificationChannelId: "discord-main",
    youtubeChannelRoutes: [
      { channelId: "UCaaa", discordChannelIds: ["route-1", "route-2"] },
      { channelId: "UCbbb", discordChannelIds: ["route-2"] }
    ]
  });
  await harness.handler.handleYouTubeInteraction(makeInteraction({ subcommand: "permissions" }));
  const reply = String(harness.replies[0]);
  for (const id of ["discord-main", "route-1", "route-2"]) {
    assert.match(reply, new RegExp(`<#${id}>`), `permisiunile pentru <#${id}> sunt raportate`);
  }
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
  assert.match(String(listed.replies[0]), /patch notes/);
  assert.match(String(listed.replies[0]), /update/);
});

test("/youtube add title-filter refuza la limita atinsa concurent (atomic) (R[Medium-Low] #3)", async () => {
  const harness = createHarness({ youtubeTitleIncludeWords: ["a", "b", "c"] }, 3, false, 0, {
    findOneAndUpdate: async () => ({ youtubeTitleIncludeWords: Array.from({ length: 10 }, (_unused, index) => `w${index}`) })
  });
  await harness.handler.handleYouTubeInteraction(makeInteraction({ group: "add", subcommand: "title-filter", strings: { word: "Patch Notes" } }));
  assert.ok(Array.isArray(harness.writes[0].update), "title-filter add foloseste pipeline atomic");
  assert.match(String(harness.replies.at(-1)), /comanda concurenta/, "daca o comanda concurenta a umplut limita, raspunde eroare in loc sa depaseasca");
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

test("/youtube videos show livreaza primul lot imediat (durabil) si trimite restul prin outbox cand e activat", async () => {
  const channelId = "UC1234567890123456789012";
  const harness = createHarness({
    youtubeNotificationChannelId: "discord-main",
    youtubeChannels: [{
      channelId,
      channelName: "Canal Test",
      channelUrl: `https://www.youtube.com/channel/${channelId}`,
      subscribedAt: new Date()
    }]
  }, 7, true);
  await harness.handler.handleYouTubeInteraction(makeInteraction({
    group: "videos",
    subcommand: "show",
    strings: { canal: "toate" }
  }));
  assert.deepEqual(harness.manualDeliveries, [5, 2], "primul lot de 5 imediat (sincron), restul de 2 durabil");
  assert.deepEqual(harness.manualBypassOutbox, [true, false], "primul lot ocoleste outbox-ul (livrare directa imediata), restul trece prin outbox-ul durabil");
  assert.match(String(harness.replies[0]), /imediat primele 5/, "raporteaza primul lot livrat imediat");
  assert.match(String(harness.replies[0]), /outbox-ul durabil/, "promite durabilitate doar cand outbox-ul e activat");
});

test("/youtube videos show NU promite durabilitate cand outbox-ul e dezactivat (mesaj onest, livrare directa paced)", async () => {
  const channelId = "UC1234567890123456789012";
  const harness = createHarness({
    youtubeNotificationChannelId: "discord-main",
    youtubeChannels: [{
      channelId,
      channelName: "Canal Test",
      channelUrl: `https://www.youtube.com/channel/${channelId}`,
      subscribedAt: new Date()
    }]
  }, 7, false);
  await harness.handler.handleYouTubeInteraction(makeInteraction({
    group: "videos",
    subcommand: "show",
    strings: { canal: "toate" }
  }));
  assert.deepEqual(harness.manualBypassOutbox, [true, true], "cu outbox-ul dezactivat, restul se livreaza tot direct (paced), nu prin outbox");
  assert.match(String(harness.replies[0]), /NU sunt durabile/, "mesaj onest: nu promite durabilitate fara outbox");
  assert.match(String(harness.replies[0]), /NOTIFICATION_OUTBOX_ENABLED/, "indica de ce nu sunt durabile");
  assert.match(String(harness.replies[0]), /repeta:true/, "indica calea de recuperare la crash: reia cu repeta:true (videoclipurile claim-uite nu reapar la o rulare normala) (R15 #1)");
});

test("/youtube videos show posteaza doar videoclipurile cu destinatie si raporteaza cate au fost sarite (caz mixt: un canal cu ruta, altul fara)", async () => {
  const harness = createHarness({
    youtubeNotificationChannelId: null,
    youtubeChannelRoutes: [{ channelId: "UC0", discordChannelIds: ["route-x"] }],
    youtubeChannels: [
      { channelId: "UC0", channelName: "Cu ruta", channelUrl: "https://www.youtube.com/UC0", subscribedAt: new Date() },
      { channelId: "UC1", channelName: "Fara ruta", channelUrl: "https://www.youtube.com/UC1", subscribedAt: new Date() }
    ]
  }, 1, false, 2);
  await harness.handler.handleYouTubeInteraction(makeInteraction({
    group: "videos",
    subcommand: "show",
    strings: { canal: "toate" }
  }));
  assert.deepEqual(harness.manualDeliveries, [1], "se posteaza doar videoclipul cu destinatie (serviciul intoarce deliverable=1), nu si cele fara destinatie");
  assert.match(String(harness.replies[0]), /2 sarite/, "raporteaza `skipped`-ul intors de serviciu (2 fara destinatie)");
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
  }, 0, false, 3);
  await harness.handler.handleYouTubeInteraction(makeInteraction({
    group: "videos",
    subcommand: "show",
    strings: { canal: "toate" }
  }));
  assert.deepEqual(harness.manualDeliveries, [], "nu se programeaza nicio livrare cand nu exista destinatie (deliverable=0)");
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

test("/youtube subscribe salveaza atomic si refuza la limita atinsa concurent (R[Medium] #1)", async () => {
  const ok = createHarness({ youtubeChannels: [] });
  await ok.handler.handleYouTubeInteraction(makeInteraction({ subcommand: "subscribe", strings: { canal: "https://www.youtube.com/@x" } }));
  assert.ok(Array.isArray(ok.writes[0].update), "subscribe salveaza printr-un aggregation pipeline atomic, nu $push neprotejat");

  const full = createHarness({ youtubeChannels: [] }, 3, false, 0, {
    findOneAndUpdate: async () => ({ youtubeChannels: Array.from({ length: 25 }, (_unused, index) => ({ channelId: `UC${index}` })) })
  });
  await full.handler.handleYouTubeInteraction(makeInteraction({ subcommand: "subscribe", strings: { canal: "https://www.youtube.com/@x" } }));
  assert.match(String(full.replies.at(-1)), /limita/, "daca o comanda concurenta a umplut limita, subscribe raspunde eroare in loc sa adauge peste");
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

test("/youtube unsubscribe invalideaza cache-ul chiar daca curatarea seen esueaza (R[Low] #4)", async () => {
  const youtubeChannelId = "UC1234567890123456789012";
  const harness = createHarness({
    youtubeChannels: [{ channelId: youtubeChannelId, channelName: "Canal Test", channelUrl: `https://www.youtube.com/channel/${youtubeChannelId}`, subscribedAt: new Date() }]
  }, 3, false, 0, {
    removeSeenChannel: async () => { throw new Error("colectia seen indisponibila"); }
  });
  await harness.handler.handleYouTubeInteraction(makeInteraction({ subcommand: "unsubscribe", strings: { canal: youtubeChannelId } }));
  assert.deepEqual(harness.invalidated, ["guild-1"], "cache-ul a fost invalidat imediat dupa update-ul principal, inainte de cleanup-ul seen care a esuat");
  assert.match(String(harness.replies.at(-1)), /nu mai este urmarit/, "abonarea a fost scoasa, cleanup-ul seen e best-effort");
});
