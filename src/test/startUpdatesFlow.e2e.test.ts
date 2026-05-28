import test from "node:test";
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

type Game = { key: string; name: string };
type UpdateDoc = {
  id: string;
  title: string;
  link: string;
  excerpt: string;
  timestamp: string;
};
type GuildDoc = Record<string, unknown>;
type MongoFilter = Record<string, unknown>;
type MongoUpdate = Record<string, unknown>;
type SentPayload = { embeds?: Array<Record<string, unknown>>; content?: string };
type UpdatesRuntime = {
  handleStartInteraction: (interaction: unknown, games: Game[]) => Promise<unknown>;
  checkForUpdates: (client: unknown, games: Game[]) => Promise<unknown>;
};

const attachInteractions = require("../features/command-handlers/subscriptionNotificationHandlers") as (context: Record<string, unknown>) => void;
const attachNotifications = require("../features/notifications") as (context: Record<string, unknown>) => void;

const games: Game[] = [
  { key: "cs2", name: "Counter-Strike 2" },
  { key: "fortnite", name: "Fortnite" }
];

const oldUpdate: UpdateDoc = {
  id: "old-update",
  title: "Old patch",
  link: "https://example.test/old",
  excerpt: "Initial baseline",
  timestamp: "2026-05-20T10:00:00.000Z"
};

const newUpdate: UpdateDoc = {
  id: "new-update",
  title: "New patch",
  link: "https://example.test/new",
  excerpt: "Fresh cron update",
  timestamp: "2026-05-21T10:00:00.000Z"
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
    })
  };
}

function makeStartUpdatesInteraction(channel: { id: string }) {
  return {
    guild: { id: "guild-1" },
    channel,
    client: { user: { id: "bot-id" } },
    deferred: false,
    replied: false,
    options: {
      getSubcommand: () => "updates"
    }
  };
}

function buildContext(guild: GuildDoc, channel: { id: string; send(payload: SentPayload): Promise<unknown> }) {
  let latestCallCount = 0;
  const replies: unknown[] = [];
  const updatesCache: unknown[] = [];
  const context = {
    GuildModel: createGuildModel(guild),
    logger: (_level: string, _context: string, _message: string, _meta?: unknown) => undefined,
    DEFAULT_CURRENCY: "USD",
    runConcurrent: async (items: unknown[], _limit: number, worker: (item: unknown) => Promise<void>) => {
      for (const item of items) await worker(item);
    },
    validatePendingDiscountSnapshot: () => true,
    getLatestForAllGames: async () => {
      latestCallCount += 1;
      return [{ game: games[0], latest: latestCallCount === 1 ? oldUpdate : newUpdate }];
    },
    fetchDeals: async () => [],
    enrichDealData: async (deal: unknown) => deal,
    dealHash: (deal: unknown) => JSON.stringify(deal),
    canSendEmbeds: () => true,
    missingChannelPermsMessage: () => "Missing channel permissions",
    buildUpdateEmbed: (gameName: string, update: UpdateDoc, mode: string) => ({
      gameName,
      mode,
      title: update.title,
      updateId: update.id
    }),
    buildDealEmbed: (deal: unknown) => ({ deal }),
    setUpdatesCache: (data: unknown) => { updatesCache.push(data); },
    getDealsCacheData: () => null,
    setDealsCache: () => undefined,
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
    getGuildSettings: async () => ({ enabledGames: [] }),
    invalidateGuildCache: () => undefined,
    makeActivationId: () => "activation-1",
    formatUserError: (_err: unknown, fallback: string) => fallback,
    safeDefer: async (interaction: { deferred: boolean }) => { interaction.deferred = true; },
    safeEdit: async (_interaction: unknown, payload: unknown) => {
      replies.push(payload);
      return payload;
    }
  };

  attachInteractions(context);
  attachNotifications(context);

  const client = {
    user: { id: "bot-id" },
    channels: {
      fetch: async (channelId: string) => channelId === channel.id ? channel : null
    }
  };

  return { context: context as typeof context & UpdatesRuntime, client, replies, updatesCache };
}

test("/start updates baseline plus cron sends only the next unseen update", async () => {
  const guild: GuildDoc = {
    _id: "guild-1",
    subscribed: false,
    notificationChannelId: null,
    updatesInitializing: false,
    pendingUpdates: {},
    seen: {}
  };
  const sentPayloads: SentPayload[] = [];
  const channel = {
    id: "channel-updates",
    send: async (payload: SentPayload) => {
      sentPayloads.push(payload);
      return { id: `message-${sentPayloads.length}` };
    }
  };
  const { context, client, replies, updatesCache } = buildContext(guild, channel);

  await context.handleStartInteraction(makeStartUpdatesInteraction(channel), games);
  await context.checkForUpdates(client, games);

  assert.deepEqual(replies, ["OK: Update-uri automate activate."]);
  assert.equal(sentPayloads.length, 1);
  assert.equal(sentPayloads[0].embeds?.[0]?.title, "New patch");
  assert.equal(sentPayloads[0].embeds?.[0]?.updateId, "new-update");
  assert.deepEqual((guild.seen as Record<string, string[]>).cs2, ["old-update", "new-update"]);
  assert.deepEqual(guild.pendingUpdates, {});
  assert.equal(guild.lastProcessedGameKey, "cs2");
  assert.equal(updatesCache.length, 1, "cron should refresh the updates cache once");
});
