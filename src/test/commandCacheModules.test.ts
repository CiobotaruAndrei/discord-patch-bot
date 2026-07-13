import test from "node:test";
import assert from "node:assert/strict";
import type { RuntimeEnv } from "../types.js";
import { createRuntimeLimits, COLORS } from "../features/command-cache/runtimeLimits.js";
import { createUserCooldowns } from "../features/command-cache/userCooldowns.js";
import { createCommandCaches, evictLRU } from "../features/command-cache/commandCaches.js";
import { createChannelPermissionChecks, formatMissingChannelPerms } from "../features/command-cache/channelPermissionChecks.js";
import { createUserErrorFormatting } from "../features/command-cache/userErrorFormatting.js";

import attachCommandCache from "../features/command-cache/commandCache.js";

function makeEnv(overrides: Partial<RuntimeEnv> = {}): RuntimeEnv {
  const base = {
    CACHE_TTL_MS: 1000, ITEMS_PER_PAGE: 5, DLC_ITEMS_PER_PAGE: 5, COMMAND_OUTPUT_MAX_CHARS: 1900,
    DLC_CACHE_MAX_SIZE: 10, SINGLE_CACHE_MAX_SIZE: 10, DEALS_CURRENCY_CACHE_MAX_SIZE: 2,
    DEALS_HISTORY_LIMIT: 300, SEEN_PER_GAME_LIMIT: 10, PENDING_UPDATES_PER_GAME_LIMIT: 10,
    PENDING_DISCOUNTS_LIMIT: 50, PENDING_UPDATE_MAX_AGE_MS: 1, PENDING_DISCOUNT_GRACE_CYCLES: 3,
    PRICE_ALERT_REARM_ABSENT_CYCLES: 2, PENDING_UPDATE_MAX_ATTEMPTS: 5, PENDING_DISCOUNT_MAX_ATTEMPTS: 5,
    MAX_UPDATES_PER_CYCLE: 5, MAX_DEALS_PER_CYCLE: 8, DISCORD_SEND_DELAY_MS: 0,
    GUILD_PROCESS_CONCURRENCY: 1, MAX_FUZZY_SEARCH_INPUT: 100, USER_COMMAND_COOLDOWN_MS: 50,
    COLLECTOR_TIMEOUT_MS: 1000,
    ...overrides
  };
  return base as RuntimeEnv;
}

test("runtimeLimits: mapeaza limitele din env si expune COLORS/OP_UPDATE_OPTS inghetate", () => {
  const limits = createRuntimeLimits(makeEnv({ CACHE_TTL_MS: 777 }));
  assert.equal(limits.CACHE_TTL_MS, 777);
  assert.equal(limits.USER_COMMAND_COOLDOWN_MS, 50);
  assert.equal(limits.COLORS, COLORS);
  assert.ok(Object.isFrozen(limits.COLORS));
  assert.ok(Object.isFrozen(limits.OP_UPDATE_OPTS));
});

test("userCooldowns: blocheaza in fereastra, permite dupa si expune marimea", () => {
  const cooldowns = createUserCooldowns({ USER_COMMAND_COOLDOWN_MS: 10_000 });
  assert.deepEqual(cooldowns.checkUserCooldown("u1", "latest").allowed, true);
  const second = cooldowns.checkUserCooldown("u1", "latest");
  assert.equal(second.allowed, false);
  assert.ok((second.remainingMs ?? 0) > 0);
  assert.equal(cooldowns.checkUserCooldown("u2", "latest").allowed, true);
  assert.equal(cooldowns.getUserCooldownsSize(), 2);
});

test("userCooldowns: cu cooldown dezactivat totul e permis si clean goleste map-ul", () => {
  const cooldowns = createUserCooldowns({ USER_COMMAND_COOLDOWN_MS: 0 });
  assert.equal(cooldowns.checkUserCooldown("u1", "latest").allowed, true);
  assert.equal(cooldowns.checkUserCooldown("u1", "latest").allowed, true);
  cooldowns.cleanUserCooldowns();
  assert.equal(cooldowns.getUserCooldownsSize(), 0);
});

test("commandCaches: LRU pe valute respecta limita, iar cleanCache deleaga la cleanUserCooldowns", () => {
  let cleaned = 0;
  const caches = createCommandCaches({
    logger: () => undefined,
    DEFAULT_CURRENCY: "USD",
    DEALS_CURRENCY_CACHE_MAX_SIZE: 2,
    SINGLE_CACHE_MAX_SIZE: 10,
    DLC_CACHE_MAX_SIZE: 10,
    cleanUserCooldowns: () => { cleaned++; },
    getUserCooldownsSize: () => 7
  });
  caches.setDealsCache("USD", []);
  caches.setDealsCache("EUR", []);
  caches.setDealsCache("RON", []);
  assert.equal(caches.cache.dealsByCurrency.size, 2, "evictLRU pastreaza doar ultimele 2 valute");
  assert.equal(caches.getDealsCacheData("USD"), null, "cea mai veche valuta a fost evacuata");
  assert.ok(Array.isArray(caches.getDealsCacheData("RON")));
  caches.cleanCache();
  assert.equal(cleaned, 1, "curatarea cache-ului include cooldown-urile injectate");
  assert.equal(caches.getCacheSizes().userCooldowns, 7, "marimea cooldown-urilor vine din modulul injectat");
});

test("commandCaches: evictLRU exportat elimina cele mai vechi chei pana la limita", () => {
  const map = new Map([["a", 1], ["b", 2], ["c", 3]]);
  evictLRU(map, 1);
  assert.deepEqual(Array.from(map.keys()), ["c"]);
});

test("channelPermissionChecks: canSendEmbeds cere toate flag-urile, iar mesajul de permisiuni enumera lipsurile", () => {
  const flags = { ViewChannel: "V", SendMessages: "S", EmbedLinks: "E" };
  const checks = createChannelPermissionChecks({ PermissionsBitField: { Flags: flags } });
  const channel = {
    isTextBased: () => true,
    permissionsFor: () => ({ has: (perm: unknown) => !Array.isArray(perm) && perm !== "E" })
  };
  assert.equal(checks.canSendEmbeds(channel, "bot"), false);
  assert.deepEqual(checks.listMissingChannelPerms(channel, "bot"), ["Embed Links"]);
  assert.match(checks.missingChannelPermsMessage(["Embed Links"]), /Lipsesc permisiunile: \*\*Embed Links\*\*/);
  assert.match(formatMissingChannelPerms(null), /View Channel.*Send Messages.*Embed Links/);
});

test("userErrorFormatting: include codul de eroare si logheaza doar cand exista eroare", () => {
  const logs: string[] = [];
  const { formatUserError } = createUserErrorFormatting({ logger: (_l, _c, message) => { logs.push(message); } });
  assert.equal(formatUserError(new Error("x"), "Nu am putut", "E42"), "Eroare: Nu am putut `[E42]`");
  assert.equal(logs.length, 1);
  assert.equal(formatUserError(null, "Fara eroare"), "Eroare: Fara eroare");
  assert.equal(logs.length, 1, "fara eroare nu se logheaza");
});

test("createCommandCache compune modulele cu API-ul plat neschimbat", () => {
  const runtime = attachCommandCache.createCommandCache({
    crypto: { randomBytes: () => ({ toString: () => "abcd" }) },
    PermissionsBitField: { Flags: { ViewChannel: "V", SendMessages: "S", EmbedLinks: "E" } },
    logger: () => undefined,
    DEFAULT_CURRENCY: "USD",
    env: makeEnv()
  });
  for (const key of [
    "CACHE_TTL_MS", "COLORS", "OP_UPDATE_OPTS", "setGlobalCacheTtl", "normalizeCurrencyKey", "cache",
    "getUpdatesCacheData", "setUpdatesCache", "getDealsCacheData", "setDealsCache",
    "cacheGetLRU", "evictLRU", "cacheSetLRU", "checkUserCooldown", "cleanUserCooldowns",
    "cleanCache", "getCacheSizes", "smoothTime", "formatUserError", "canSendEmbeds",
    "listMissingChannelPerms", "missingChannelPermsMessage", "makeActivationId", "sleepIfPositive"
  ]) {
    assert.ok(key in runtime, `API-ul plat pastreaza cheia ${key}`);
  }
  assert.equal(runtime.makeActivationId(), "abcd");
  assert.equal(runtime.normalizeCurrencyKey(null), "USD");
});
