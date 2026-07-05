import test from "node:test";
import { installCommandChain, type ChainableCommandModule } from "./commandChainTestKit";
import assert from "node:assert/strict";
import {
  dealPassesFilters,
  mapToObject,
  normalizePendingDiscountArray,
  normalizePendingUpdateArray,
  rotateAfter,
  toEntries
} from "../domain/deals/filtersCore";

process.env.MONGO_URI ||= "mongodb://localhost:27017/discord-patch-bot-test";
process.env.DISCORD_TOKEN ||= "test_discord_token";
process.env.DISCORD_CLIENT_ID ||= "test_discord_client_id";
process.env.METRICS_PUBLIC ||= "true";

type DealDoc = {
  id: string;
  title: string;
  salePrice: string;
  normalPrice: string;
  savings: string;
  store: string;
};
type GuildDoc = Record<string, unknown>;
type MongoFilter = Record<string, unknown>;
type MongoUpdate = Record<string, unknown>;
type SentPayload = { embeds?: Array<Record<string, unknown>>; content?: string };
type DiscountsRuntime = {
  handleStartInteraction: (interaction: unknown, games: unknown[]) => Promise<unknown>;
  checkForDiscounts: (client: unknown) => Promise<unknown>;
};

const attachInteractions = require("../features/command-handlers/subscriptionNotificationHandlers") as ChainableCommandModule;
const attachNotifications = require("../features/notifications") as typeof import("../features/notifications");
import type { NotificationsRuntimeDeps } from "../features/notifications/notificationRuntimeContracts";

function notificationDeps(context: Record<string, unknown>): NotificationsRuntimeDeps {
  return context as Record<string, unknown> & NotificationsRuntimeDeps;
}

const oldDeal: DealDoc = {
  id: "old-deal",
  title: "Old discount",
  salePrice: "9.99",
  normalPrice: "19.99",
  savings: "50",
  store: "Steam"
};

const newDeal: DealDoc = {
  id: "new-deal",
  title: "New discount",
  salePrice: "4.99",
  normalPrice: "29.99",
  savings: "83",
  store: "Steam"
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getPath(target: GuildDoc, path: string): unknown {
  let cursor: unknown = target;
  for (const part of path.split(".")) {
    if (!isPlainRecord(cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function setPath(target: GuildDoc, path: string, value: unknown): void {
  const parts = path.split(".");
  const last = parts[parts.length - 1] as string;
  let cursor: GuildDoc = target;
  for (const part of parts.slice(0, -1)) {
    if (!isPlainRecord(cursor[part])) cursor[part] = {};
    cursor = cursor[part] as GuildDoc;
  }
  cursor[last] = value;
}

function unsetPath(target: GuildDoc, path: string): void {
  const parts = path.split(".");
  const last = parts[parts.length - 1] as string;
  let cursor: unknown = target;
  for (const part of parts.slice(0, -1)) {
    if (!isPlainRecord(cursor)) return;
    if (!isPlainRecord(cursor[part])) return;
    cursor = cursor[part];
  }
  if (isPlainRecord(cursor)) delete cursor[last];
}

function matchesPull(item: unknown, spec: unknown): boolean {
  if (isPlainRecord(spec)) {
    if (!isPlainRecord(item)) return false;
    return Object.entries(spec).every(([key, value]) => item[key] === value);
  }
  return item === spec;
}

function pullPath(target: GuildDoc, path: string, spec: unknown): void {
  const current = getPath(target, path);
  if (!Array.isArray(current)) return;
  setPath(target, path, current.filter(item => !matchesPull(item, spec)));
}

function pushPath(target: GuildDoc, path: string, spec: unknown): void {
  const current = getPath(target, path);
  const next = Array.isArray(current) ? [...current] : [];
  const values = isPlainRecord(spec) && Array.isArray(spec.$each) ? spec.$each : [spec];
  next.push(...values);
  if (isPlainRecord(spec) && typeof spec.$slice === "number") {
    setPath(target, path, spec.$slice < 0 ? next.slice(spec.$slice) : next.slice(0, spec.$slice));
    return;
  }
  setPath(target, path, next);
}

function matchesValue(actual: unknown, condition: unknown): boolean {
  if (isPlainRecord(condition) && Object.prototype.hasOwnProperty.call(condition, "$ne")) {
    const expected = condition.$ne;
    if (Array.isArray(actual)) return !actual.some(item => String(item) === String(expected));
    return actual !== expected;
  }
  return actual === condition;
}

function matchesFilter(guild: GuildDoc, filter: MongoFilter): boolean {
  return Object.entries(filter).every(([path, condition]) => matchesValue(getPath(guild, path), condition));
}

function applyUpdate(guild: GuildDoc, update: MongoUpdate): void {
  const setDoc = update.$set;
  if (isPlainRecord(setDoc)) {
    for (const [path, value] of Object.entries(setDoc)) setPath(guild, path, value);
  }

  const unsetDoc = update.$unset;
  if (isPlainRecord(unsetDoc)) {
    for (const path of Object.keys(unsetDoc)) unsetPath(guild, path);
  }

  const pushDoc = update.$push;
  if (isPlainRecord(pushDoc)) {
    for (const [path, spec] of Object.entries(pushDoc)) pushPath(guild, path, spec);
  }

  const pullDoc = update.$pull;
  if (isPlainRecord(pullDoc)) {
    for (const [path, spec] of Object.entries(pullDoc)) pullPath(guild, path, spec);
  }
}

function cloneGuild(guild: GuildDoc): GuildDoc {
  return JSON.parse(JSON.stringify(guild)) as GuildDoc;
}

function createGuildModel(guild: GuildDoc) {
  return {
    updateOne: async (filter: MongoFilter, update: MongoUpdate, options: Record<string, unknown> = {}) => {
      if (!matchesFilter(guild, filter)) {
        if (!options.upsert || typeof filter._id !== "string") return { matchedCount: 0, modifiedCount: 0 };
        guild._id = filter._id;
      }
      applyUpdate(guild, update);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    find: (filter: MongoFilter) => ({
      lean: async () => matchesFilter(guild, filter) ? [cloneGuild(guild)] : []
    }),
    exists: async (filter: MongoFilter) => matchesFilter(guild, filter) ? { _id: guild._id } : null
  };
}

function makeStartDiscountsInteraction(channel: { id: string }) {
  return {
    guild: { id: "guild-1" },
    channel,
    client: { user: { id: "bot-id" } },
    deferred: false,
    replied: false,
    options: {
      getSubcommand: () => "reduceri"
    }
  };
}

function buildContext(guild: GuildDoc, channel: { id: string; send(payload: SentPayload): Promise<unknown> }) {
  let fetchDealsCallCount = 0;
  const replies: unknown[] = [];
  const dealsCacheWrites: Array<{ currency: string; deals: DealDoc[] }> = [];
  const seenDiscountStore = new Set<string>();
  const GuildSeenDiscountModel = {
    updateOne: async (filter: { guildId: string; dealHash: string }) => {
      const key = `${filter.guildId}|${filter.dealHash}`;
      if (seenDiscountStore.has(key)) return { upsertedCount: 0 };
      seenDiscountStore.add(key);
      return { upsertedCount: 1 };
    },
    deleteOne: async (filter: { guildId: string; dealHash: string }) => {
      seenDiscountStore.delete(`${filter.guildId}|${filter.dealHash}`);
      return { deletedCount: 1 };
    },
    find: (filter: { guildId: string }) => ({
      lean: async () => Array.from(seenDiscountStore)
        .filter(key => key.startsWith(`${filter.guildId}|`))
        .map(key => ({ dealHash: key.slice(filter.guildId.length + 1) }))
    }),
    bulkWrite: async (ops: Array<{ updateOne: { filter: { guildId: string; dealHash: string } } }>) => {
      for (const op of ops) {
        const { guildId, dealHash } = op.updateOne.filter;
        seenDiscountStore.add(`${guildId}|${dealHash}`);
      }
      return { upsertedCount: ops.length };
    }
  };
  const context = {
    GuildModel: createGuildModel(guild),
    GuildSeenDiscountModel,
    logger: (_level: string, _context: string, _message: string, _meta?: unknown) => undefined,
    DEFAULT_CURRENCY: "USD",
    runConcurrent: async (items: unknown[], _limit: number, worker: (item: unknown) => Promise<void>) => {
      let processed = 0;
      const errors: Array<{ error: unknown }> = [];
      for (const item of items) {
        try { await worker(item); processed++; } catch (error) { errors.push({ error }); }
      }
      return { processed, errors };
    },
    validatePendingDiscountSnapshot: (value: unknown) => isPlainRecord(value),
    getLatestForAllGames: async () => [],
    fetchDeals: async () => {
      fetchDealsCallCount += 1;
      return fetchDealsCallCount === 1 ? [oldDeal] : [oldDeal, newDeal];
    },
    enrichDealData: async (deal: DealDoc) => ({ ...deal, enriched: true }),
    dealHash: (deal: DealDoc) => deal.id,
    canSendEmbeds: () => true,
    missingChannelPermsMessage: () => "Missing channel permissions",
    buildUpdateEmbed: () => ({}),
    buildDealEmbed: (deal: DealDoc & { enriched?: boolean }, mode: string, currency: string) => ({
      currency,
      dealId: deal.id,
      enriched: deal.enriched === true,
      mode,
      title: deal.title
    }),
    setUpdatesCache: () => undefined,
    getDealsCacheData: () => null,
    setDealsCache: (currency: string, deals: DealDoc[]) => { dealsCacheWrites.push({ currency, deals }); },
    normalizeCurrencyKey: (currency: unknown) => String(currency || "USD"),
    normalizePendingUpdateArray,
    normalizePendingDiscountArray,
    toEntries,
    rotateAfter,
    mapToObject,
    dealPassesFilters,
    sleepIfPositive: async () => undefined,
    withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
    OP_UPDATE_OPTS: {},
    SEEN_PER_GAME_LIMIT: 50,
    PENDING_UPDATE_MAX_AGE_MS: 24 * 60 * 60 * 1000,
    PENDING_UPDATE_MAX_ATTEMPTS: 3,
    PENDING_UPDATES_PER_GAME_LIMIT: 10,
    MAX_UPDATES_PER_CYCLE: 5,
    DISCORD_SEND_DELAY_MS: 0,
    GUILD_PROCESS_CONCURRENCY: 2,
    DEALS_HISTORY_LIMIT: 50,
    PENDING_DISCOUNT_MAX_ATTEMPTS: 3,
    PENDING_DISCOUNT_GRACE_CYCLES: 1,
    PENDING_DISCOUNTS_LIMIT: 10,
    MAX_DEALS_PER_CYCLE: 5,
    env: {
      NOTIFICATION_OUTBOX_ENABLED: false,
      NOTIFICATION_OUTBOX_DRAIN_LIMIT: 50,
      NOTIFICATION_OUTBOX_MAX_AGE_MS: 6 * 24 * 3600_000,
      NOTIFICATION_OUTBOX_RECOVERY_VERIFY: false,
      NOTIFICATION_OUTBOX_RECOVERY_STRICT: false,
      NOTIFICATION_OUTBOX_RECOVERY_HISTORY_LIMIT: 25,
      DISCORD_SEND_RATE_CAPACITY: 5,
      DISCORD_SEND_RATE_PER_SEC: 5,
      DISCORD_SEND_RATE_MAX_WAIT_MS: 5000
    },
    getGuildSettings: async () => ({ currency: "USD", enabledGames: [] }),
    invalidateGuildCache: () => undefined,
    makeActivationId: () => "discount-activation-1",
    formatUserError: (_err: unknown, fallback: string) => fallback,
    safeDefer: async (interaction: { deferred: boolean }) => { interaction.deferred = true; },
    safeEdit: async (_interaction: unknown, payload: unknown) => {
      replies.push(payload);
      return payload;
    }
  };

  Object.assign(context, attachNotifications.createNotificationRuntime(notificationDeps(context)));
  installCommandChain(context, [attachInteractions]);

  const client = {
    user: { id: "bot-id" },
    channels: {
      fetch: async (channelId: string) => channelId === channel.id ? channel : null
    }
  };

  return { context: context as typeof context & DiscountsRuntime, client, replies, dealsCacheWrites, seenDiscountStore };
}

test("/start reduceri baseline plus cron sends only the next unseen deal", async () => {
  const guild: GuildDoc = {
    _id: "guild-1",
    discountsSubscribed: false,
    discountChannelId: null,
    discountsInitializing: false,
    pendingDiscounts: [],
    seenDiscounts: []
  };
  const sentPayloads: SentPayload[] = [];
  const channel = {
    id: "channel-discounts",
    send: async (payload: SentPayload) => {
      sentPayloads.push(payload);
      return { id: `message-${sentPayloads.length}` };
    }
  };
  const { context, client, replies, dealsCacheWrites, seenDiscountStore } = buildContext(guild, channel);

  await context.handleStartInteraction(makeStartDiscountsInteraction(channel), []);
  await context.checkForDiscounts(client);

  assert.deepEqual(replies, ["OK: Alerte reduceri activate pe acest canal. Valuta: **USD**."]);
  assert.equal(sentPayloads.length, 1);
  assert.equal(sentPayloads[0].embeds?.[0]?.title, "New discount");
  assert.equal(sentPayloads[0].embeds?.[0]?.dealId, "new-deal");
  assert.equal(sentPayloads[0].embeds?.[0]?.enriched, true);
  assert.ok(seenDiscountStore.has("guild-1|old-deal"), "baseline-ul de la /start e seed-uit in colectia dedicata");
  assert.ok(seenDiscountStore.has("guild-1|new-deal"), "deal-ul nou trimis de cron e claim-uit in colectia dedicata");
  assert.deepEqual(guild.pendingDiscounts, []);
  assert.equal(dealsCacheWrites.length, 2, "start reduceri should cache the baseline, then cron should refresh the deals cache");
  assert.deepEqual(
    dealsCacheWrites.map(write => write.deals.map(deal => deal.id)),
    [["old-deal"], ["old-deal", "new-deal"]]
  );
});
