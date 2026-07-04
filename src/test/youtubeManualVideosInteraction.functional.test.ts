import test from "node:test";
import assert from "node:assert/strict";
import { createHarness, makeInteraction } from "./youtubeInteractionTestKit";

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

