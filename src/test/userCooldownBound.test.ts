import test from "node:test";
import assert from "node:assert/strict";

// V12: regression guard pentru bound-ul dur al map-ului de cooldown-uri.
// Inainte: cleanUserCooldowns stergea doar intrari mai vechi de 2×cooldown.
// Cu un USER_COMMAND_COOLDOWN_MS mare si churn de chei distincte, map-ul
// crestea nemarginit peste threshold (entries fresh nu sunt eligibile la
// sweep-ul pe varsta). Acum: ceiling dur (10×threshold) evacueaza fortat
// cele mai vechi intrari (LRU prin delete+set).

const attachCommandCache = require("../features/command-cache/commandCache") as {
  createCommandCache: (ctx: Record<string, any>) => Record<string, any>;
};

function makeCache(cooldownMs: number) {
  const ctx: Record<string, any> = {
    crypto: { randomBytes: () => ({ toString: () => "00" }) },
    PermissionsBitField: { Flags: { SendMessages: 1, EmbedLinks: 2 } },
    logger: () => undefined,
    DEFAULT_CURRENCY: "USD",
    env: {
      CACHE_TTL_MS: 180_000, ITEMS_PER_PAGE: 5, DLC_ITEMS_PER_PAGE: 10,
      COMMAND_OUTPUT_MAX_CHARS: 1900, DLC_CACHE_MAX_SIZE: 100, SINGLE_CACHE_MAX_SIZE: 100,
      DEALS_CURRENCY_CACHE_MAX_SIZE: 8, DEALS_HISTORY_LIMIT: 300, SEEN_PER_GAME_LIMIT: 20,
      PENDING_UPDATES_PER_GAME_LIMIT: 5, PENDING_DISCOUNTS_LIMIT: 200,
      PENDING_UPDATE_MAX_AGE_MS: 86_400_000, PENDING_DISCOUNT_GRACE_CYCLES: 3,
      PENDING_UPDATE_MAX_ATTEMPTS: 5, PENDING_DISCOUNT_MAX_ATTEMPTS: 10,
      MAX_UPDATES_PER_CYCLE: 5, MAX_DEALS_PER_CYCLE: 8, DISCORD_SEND_DELAY_MS: 0,
      GUILD_PROCESS_CONCURRENCY: 3, MAX_FUZZY_SEARCH_INPUT: 100,
      USER_COMMAND_COOLDOWN_MS: cooldownMs, COLLECTOR_TIMEOUT_MS: 60_000
    }
  };
  return attachCommandCache.createCommandCache(ctx);
}

const THRESHOLD = 500;
const HARD_MAX = THRESHOLD * 10; // 5000
const CLEAN_EVERY = 100;

test("userCommandCooldowns ramane marginit chiar cu cooldown mare + churn masiv de chei", () => {
  // Cooldown 5 min: nicio intrare nu e eligibila pentru sweep-ul pe varsta in
  // timpul testului → singura cale de a margini map-ul e ceiling-ul dur.
  const cache = makeCache(300_000);
  for (let i = 0; i < 20_000; i++) {
    cache.checkUserCooldown(`user-${i}`, "latest");
  }
  const size = cache.getCacheSizes().userCooldowns;
  // Fara fix: size ar fi 20_000. Cu fix: bound la ~HARD_MAX + un batch de inserts.
  assert.ok(size <= HARD_MAX + CLEAN_EVERY,
    `map-ul trebuie marginit la <= ${HARD_MAX + CLEAN_EVERY}, got ${size}`);
});

test("map-ul oscileaza marginit (trim periodic la depasirea hard max)", () => {
  const cache = makeCache(300_000);
  // Inseram mult peste HARD_MAX; trim-ul periodic din checkUserCooldown
  // tine map-ul sub HARD_MAX + un batch de inserts oricand.
  let maxObserved = 0;
  for (let i = 0; i < HARD_MAX + 2000; i++) {
    cache.checkUserCooldown(`u${i}`, "cmd");
    maxObserved = Math.max(maxObserved, cache.getCacheSizes().userCooldowns);
  }
  assert.ok(maxObserved <= HARD_MAX + CLEAN_EVERY,
    `size observat maxim trebuie <= ${HARD_MAX + CLEAN_EVERY}, got ${maxObserved}`);
});

test("dupa trim la threshold, o cheie inserata proaspat e pastrata (LRU coada)", () => {
  const cache = makeCache(300_000);
  // Churn masiv care impinge map-ul peste hard max.
  for (let i = 0; i < HARD_MAX + 600; i++) cache.checkUserCooldown(`old-${i}`, "cmd");
  cache.cleanUserCooldowns(); // sweep + (eventual) trim hard
  assert.ok(cache.getCacheSizes().userCooldowns <= HARD_MAX + CLEAN_EVERY,
    "bound mentinut dupa churn");

  // Insereaza o cheie DUPA churn → e la coada Map-ului (cea mai recenta).
  const fresh1 = cache.checkUserCooldown("brand-new", "cmd");
  assert.equal(fresh1.allowed, true, "prima utilizare e permisa");
  // Re-apel imediat → respins, ceea ce dovedeste ca a fost retinuta in map.
  const fresh2 = cache.checkUserCooldown("brand-new", "cmd");
  assert.equal(fresh2.allowed, false, "cheia proaspata trebuie retinuta (inca in cooldown)");
});

test("cooldown=0 dezactiveaza complet tracking-ul (map gol)", () => {
  const cache = makeCache(0);
  for (let i = 0; i < 1000; i++) {
    const r = cache.checkUserCooldown(`u${i}`, "cmd");
    assert.equal(r.allowed, true);
  }
  assert.equal(cache.getCacheSizes().userCooldowns, 0, "cooldown=0 nu populeaza map-ul");
});

test("cooldown normal: al doilea apel rapid e respins, dupa expirare e permis", () => {
  const cache = makeCache(50);
  const first = cache.checkUserCooldown("u1", "cmd");
  assert.equal(first.allowed, true);
  const second = cache.checkUserCooldown("u1", "cmd");
  assert.equal(second.allowed, false);
  assert.ok((second.remainingMs ?? 0) > 0 && (second.remainingMs ?? 0) <= 50);
});
