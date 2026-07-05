import type { ChainableCommandModule } from "./commandChainTestKit";
export const installOutboxAdmin = require("../features/command-handlers/outboxAdminHandler") as
  ChainableCommandModule & {
    createOutboxAdminHandler: (deps: Record<string, unknown>) => { handleOutboxInteraction: (interaction: unknown) => Promise<unknown> };
    isDirectOutboxCommand: (interaction: unknown) => boolean;
  };

export type DeadLetterEntry = { kind?: string; itemId?: string; title?: string; reason?: string; attempts?: number; failedAt?: Date };

export function makeInteraction(group: string | null, sub: string, userId = "user-1") {
  return {
    commandName: "outbox",
    guild: { id: "guild-1" },
    user: { id: userId },
    client: { user: { id: "bot-1" }, channels: { fetch: async () => null } },
    options: { getSubcommandGroup: () => group, getSubcommand: () => sub },
    isChatInputCommand: () => true,
    deferred: false,
    replied: false,
    reply: async () => undefined,
    followUp: async () => undefined
  };
}


export function makeDeps(opts: {
  guildQueued?: number;
  totalQueued?: number;
  perGuildVerify?: boolean;
  deadLetters?: DeadLetterEntry[];
  outboxEnabled?: boolean;
  recoveryVerifyGlobal?: boolean;
  recoveryStrict?: boolean;
  paused?: boolean;
  updateManyResult?: { modifiedCount?: number; matchedCount?: number };
  notificationChannelId?: string | null;
  discountChannelId?: string | null;
  youtubeNotificationChannelId?: string | null;
  dlcChannelId?: string | null;
  futureReleaseChannelId?: string | null;
  youtubeChannelRoutes?: Array<{ channelId?: string; discordChannelIds?: string[] }>;
  channelPermissions?: (channelId: string) => { viewChannel: boolean; sendMessages: boolean; embedLinks: boolean; readMessageHistory: boolean } | null;
  lockToken?: string | null;
  drainResult?: { sent?: number; retried?: number; deadLettered?: number; queued?: number };
  replayDocs?: Array<{ _id: unknown; kind: "update" | "discount"; channelId: string; payload: unknown; dedupeKey: string; recoveryVerify: boolean }>;
  enqueueFailAt?: number;
  replayDeleteAllFails?: boolean;
  replayDeleteFails?: boolean;
  outboxGlobalAdminIds?: string[];
  pausedReadFails?: boolean;
} = {}) {
  const replies: string[] = [];
  const updateManyCalls: Array<{ filter: unknown; update: unknown }> = [];
  const guildUpdateCalls: Array<{ filter: unknown; update: unknown }> = [];
  const invalidatedGuilds: string[] = [];
  const enqueueCalls: Array<Record<string, unknown>> = [];
  const replayDeleteCalls: Array<{ guildId: string; ids: unknown[] }> = [];
  const replayDeleteAllCalls: string[] = [];
  const pauseCalls: boolean[] = [];
  const permissionChecks: string[] = [];
  const lockCalls: Array<{ name: string; ttl: number }> = [];
  const releaseCalls: string[] = [];
  let drainCalls = 0;
  const deps = {
    NotificationOutboxModel: {
      countDocuments: async (filter: { guildId?: string } = {}) => (filter && filter.guildId ? (opts.guildQueued ?? 0) : (opts.totalQueued ?? 0)),
      updateMany: async (filter: unknown, update: unknown) => {
        updateManyCalls.push({ filter, update });
        return opts.updateManyResult ?? { modifiedCount: opts.guildQueued ?? 0 };
      }
    },
    GuildModel: {
      updateOne: async (filter: unknown, update: unknown) => { guildUpdateCalls.push({ filter, update }); return { modifiedCount: 1 }; }
    },
    invalidateGuildCache: (guildId: string) => { invalidatedGuilds.push(guildId); },
    enqueueOutbox: async (job: Record<string, unknown>) => {
      if (opts.enqueueFailAt !== undefined && enqueueCalls.length === opts.enqueueFailAt) throw new Error("enqueue boom");
      enqueueCalls.push(job);
    },
    listReplayableDeadLetters: async () => opts.replayDocs ?? [],
    deleteReplayedDeadLetters: async (guildId: string, ids: unknown[]) => { if (opts.replayDeleteFails) throw new Error("delete boom"); replayDeleteCalls.push({ guildId, ids }); },
    deleteAllReplayPayloads: async (guildId: string) => { if (opts.replayDeleteAllFails) throw new Error("deleteAll boom"); replayDeleteAllCalls.push(guildId); },
    getGuildSettings: async () => ({
      outboxRecoveryVerify: opts.perGuildVerify ?? false,
      notificationDeadLetter: opts.deadLetters ?? [],
      notificationChannelId: opts.notificationChannelId ?? null,
      discountChannelId: opts.discountChannelId ?? null,
      youtubeNotificationChannelId: opts.youtubeNotificationChannelId ?? null,
      dlcChannelId: opts.dlcChannelId ?? null,
      futureReleaseChannelId: opts.futureReleaseChannelId ?? null,
      youtubeChannelRoutes: opts.youtubeChannelRoutes ?? []
    }),
    getOutboxPaused: async () => {
      if (opts.pausedReadFails) throw new Error("citire pauza esuata");
      return opts.paused ?? false;
    },
    setOutboxPaused: async (paused: boolean) => { pauseCalls.push(paused); },
    checkChannelPermissions: async (_interaction: unknown, channelId: string) => {
      permissionChecks.push(channelId);
      return opts.channelPermissions ? opts.channelPermissions(channelId) : null;
    },
    acquireDbLock: async (name: string, ttl: number) => {
      lockCalls.push({ name, ttl });
      return opts.lockToken === undefined ? "lock-token" : opts.lockToken;
    },
    releaseDbLock: async (_name: string, token: string) => { releaseCalls.push(token); },
    drainOutbox: async () => {
      drainCalls++;
      return opts.drainResult ?? { sent: 0, retried: 0, deadLettered: 0, queued: 0 };
    },
    safeDefer: async () => undefined,
    safeEdit: async (_interaction: unknown, content: string) => { replies.push(content); return content; },
    formatUserError: (_err: unknown, fallback: string) => fallback,
    logger: () => undefined,
    outboxEnabled: opts.outboxEnabled ?? true,
    recoveryVerifyGlobal: opts.recoveryVerifyGlobal ?? false,
    recoveryStrict: opts.recoveryStrict ?? false,
    outboxGlobalAdminIds: opts.outboxGlobalAdminIds ?? []
  };
  return { deps, replies, updateManyCalls, guildUpdateCalls, invalidatedGuilds, enqueueCalls, replayDeleteCalls, replayDeleteAllCalls, pauseCalls, permissionChecks, lockCalls, releaseCalls, getDrainCalls: () => drainCalls };
}

