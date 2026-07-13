import test from "node:test";
import assert from "node:assert/strict";

const attachCommandCache = require("../features/command-cache/commandCache").default as {
  createCommandCache: (target: Record<string, unknown>) => { canSendEmbeds: (channel: unknown, botId: string) => boolean };
};

const FLAGS = { ViewChannel: 4, SendMessages: 1, EmbedLinks: 2 };

function makeCacheApi() {
  return attachCommandCache.createCommandCache({
    crypto: { randomBytes: () => ({ toString: () => "00" }) },
    PermissionsBitField: { Flags: FLAGS },
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
      USER_COMMAND_COOLDOWN_MS: 0, COLLECTOR_TIMEOUT_MS: 60_000
    }
  });
}

function makeChannel(granted: number[]) {
  return {
    isTextBased: () => true,
    permissionsFor: () => ({
      has: (flags: number | number[]) => (Array.isArray(flags) ? flags : [flags]).every(flag => granted.includes(flag))
    }),
    send: async () => ({ id: "msg" })
  };
}

test("canSendEmbeds: cere View Channel + Send Messages + Embed Links, toate trei", () => {
  const { canSendEmbeds } = makeCacheApi();
  assert.equal(canSendEmbeds(makeChannel([FLAGS.ViewChannel, FLAGS.SendMessages, FLAGS.EmbedLinks]), "bot"), true);
});

test("canSendEmbeds: Send + Embed dar FARA View Channel -> respins (review #13.1)", () => {
  const { canSendEmbeds } = makeCacheApi();
  assert.equal(canSendEmbeds(makeChannel([FLAGS.SendMessages, FLAGS.EmbedLinks]), "bot"), false,
    "un canal pe care botul nu il vede nu e valid pentru notificari, chiar daca are send/embed");
});

test("canSendEmbeds: lipsa Send sau Embed -> respins (paritate cu requiredNotifyPerms)", () => {
  const { canSendEmbeds } = makeCacheApi();
  assert.equal(canSendEmbeds(makeChannel([FLAGS.ViewChannel, FLAGS.EmbedLinks]), "bot"), false);
  assert.equal(canSendEmbeds(makeChannel([FLAGS.ViewChannel, FLAGS.SendMessages]), "bot"), false);
});

test("canSendEmbeds: canal non-text sau fara permissionsFor -> respins", () => {
  const { canSendEmbeds } = makeCacheApi();
  assert.equal(canSendEmbeds({ isTextBased: () => false, permissionsFor: () => null }, "bot"), false);
  assert.equal(canSendEmbeds({}, "bot"), false);
  assert.equal(canSendEmbeds(null, "bot"), false);
});
