import test from "node:test";
import assert from "node:assert/strict";
import { createHarness, makeInteraction } from "../youtubeInteractionTestKit.js";

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
