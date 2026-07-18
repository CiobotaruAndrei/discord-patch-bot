import test from "node:test";
import assert from "node:assert/strict";
import * as cheerio from "cheerio";

import { createDlcNotificationService } from "../../features/notifications/dlcNotificationService.js";
import type { DlcNotificationServiceDeps } from "../../features/notifications/dlcNotificationService.js";
import type { GameConfig, MongoWriteOutcome } from "../../types.js";
import type { NotificationDiscordClient } from "../../features/notifications/outboundChannel.js";
import type { FetchGameDlcsOutcome } from "../../features/command-handlers/dlcSourceService.js";

const GAMES: GameConfig[] = [
  { key: "cs2", name: "CS2", appId: "730" },
  { key: "dota", name: "Dota", appId: "570" }
];

const CLIENT: NotificationDiscordClient = { channels: { fetch: async () => undefined } };

interface SendCall { payload: Record<string, unknown>; }

function makeHarness(opts?: {
  claim?: (gameKey: string, dlcKey: string) => number;
  sendImpl?: () => Promise<unknown>;
  permanent?: (err: unknown) => boolean;
  dlcsByGame?: Record<string, FetchGameDlcsOutcome>;
}) {
  const sends: SendCall[] = [];
  const claims: string[] = [];
  const rollbacks: string[] = [];
  const seeded: Array<{ guildId: string; entries: Array<{ gameKey: string; dlcKey: string }> }> = [];
  const disabled: string[] = [];
  const fetched: Array<{ appId: string; currency: string }> = [];

  const channel = {
    id: "chan1",
    send: async (payload: Record<string, unknown>) => {
      if (opts?.sendImpl) return opts.sendImpl();
      sends.push({ payload });
      return undefined;
    }
  };

  const outcomes: Record<string, FetchGameDlcsOutcome> = opts?.dlcsByGame ?? {
    "730": { status: "ok", dlcs: [{ dlcKey: "111", name: "Prime", price: "$1" }] },
    "570": { status: "ok", dlcs: [{ dlcKey: "222", name: "Pass", price: "$2" }] }
  };

  const deps: DlcNotificationServiceDeps = {
    GuildModel: {
      find: () => ({ lean: async () => [{ _id: "g1", dlcChannelId: "chan1" }] })
    },
    logger: () => undefined,
    runConcurrent: async (items, _c, fn, o) => {
      let processed = 0;
      const errors: Array<{ error: unknown }> = [];
      for (const item of items) {
        try { await fn(item); processed++; } catch (err) { errors.push({ error: err }); o?.errorLogger?.(item, err); }
      }
      return { processed, errors };
    },
    resolveOutboundChannel: async () => ({ abort: false, channel }),
    claimSeenDlc: async (_g, _c, gameKey, dlcKey): Promise<MongoWriteOutcome> => {
      claims.push(`${gameKey}:${dlcKey}`);
      return { matchedCount: opts?.claim ? opts.claim(gameKey, dlcKey) : 1 };
    },
    rollbackSeenDlc: async (_g, gameKey, dlcKey): Promise<MongoWriteOutcome> => {
      rollbacks.push(`${gameKey}:${dlcKey}`);
      return { matchedCount: 1 };
    },
    seedSeenDlcs: async (guildId, entries) => { seeded.push({ guildId, entries }); },
    disableDlcForChannelError: async (guildId): Promise<MongoWriteOutcome> => { disabled.push(guildId); return { matchedCount: 1 }; },
    isPermanentDiscordError: opts?.permanent ?? (() => false),
    transientErrorMessage: (err) => String((err as { message?: unknown })?.message ?? err),
    fetchGameDlcs: async (_deps, appId, currency) => {
      fetched.push({ appId: String(appId), currency: String(currency) });
      return outcomes[String(appId)] ?? { status: "unavailable" };
    },
    dlcSource: { httpReq: async () => ({ data: "" }), safeCheerioLoad: (html: unknown) => cheerio.load(String(html)), logger: () => undefined },
    sleepIfPositive: async () => undefined,
    DEFAULT_CURRENCY: "ro",
    MAX_DLCS_PER_CYCLE: 10,
    DLC_FETCH_CONCURRENCY: 2,
    DISCORD_SEND_DELAY_MS: 0,
    GUILD_PROCESS_CONCURRENCY: 2
  };

  return { deps, sends, claims, rollbacks, seeded, disabled, fetched, channel };
}

test("checkForDlcs: preia DLC per joc cu moneda implicita si trimite embed-uri pentru DLC-urile noi (audit, #12)", async () => {
  const h = makeHarness();
  const service = createDlcNotificationService(h.deps);
  await service.checkForDlcs(CLIENT, GAMES);
  assert.deepEqual(h.fetched, [{ appId: "730", currency: "ro" }, { appId: "570", currency: "ro" }]);
  assert.deepEqual(h.claims.sort(), ["cs2:111", "dota:222"]);
  assert.equal(h.sends.length, 1);
  assert.equal((h.sends[0].payload.embeds as unknown[]).length, 2);
});

test("checkForDlcs: DLC-urile deja vazute (claim 0) nu sunt trimise (audit, #12)", async () => {
  const h = makeHarness({ claim: () => 0 });
  const service = createDlcNotificationService(h.deps);
  await service.checkForDlcs(CLIENT, GAMES);
  assert.equal(h.sends.length, 0);
});

test("checkForDlcs: esec permanent Discord la trimitere dezactiveaza canalul DLC (audit, #12)", async () => {
  const h = makeHarness({
    sendImpl: async () => { throw { code: 50001, message: "Missing Access" }; },
    permanent: (err) => (err as { code?: number }).code === 50001
  });
  const service = createDlcNotificationService(h.deps);
  await service.checkForDlcs(CLIENT, GAMES);
  assert.deepEqual(h.disabled, ["g1"]);
});

test("checkForDlcs: esec tranzitoriu la trimitere face rollback la revendicari pentru re-incercare (audit, #12)", async () => {
  const h = makeHarness({
    sendImpl: async () => { throw { message: "timeout" }; },
    permanent: () => false
  });
  const service = createDlcNotificationService(h.deps);
  await service.checkForDlcs(CLIENT, GAMES);
  assert.equal(h.disabled.length, 0);
  assert.deepEqual(h.rollbacks.sort(), ["cs2:111", "dota:222"]);
});

test("seedBaselineDlc: marcheaza tot catalogul curent ca vazut fara sa trimita notificari (audit, #12)", async () => {
  const h = makeHarness();
  const service = createDlcNotificationService(h.deps);
  await service.seedBaselineDlc("g1", GAMES);
  assert.equal(h.sends.length, 0);
  assert.equal(h.seeded.length, 1);
  assert.deepEqual(h.seeded[0].entries.sort((a, b) => a.gameKey.localeCompare(b.gameKey)), [
    { gameKey: "cs2", dlcKey: "111" },
    { gameKey: "dota", dlcKey: "222" }
  ]);
});

test("checkForDlcs: sursa DLC indisponibila pentru un joc => acel joc e sarit, restul continua (audit, #12)", async () => {
  const h = makeHarness({
    dlcsByGame: {
      "730": { status: "age-gate" },
      "570": { status: "ok", dlcs: [{ dlcKey: "222", name: "Pass", price: "$2" }] }
    }
  });
  const service = createDlcNotificationService(h.deps);
  await service.checkForDlcs(CLIENT, GAMES);
  assert.deepEqual(h.claims, ["dota:222"]);
  assert.equal(h.sends.length, 1);
});
