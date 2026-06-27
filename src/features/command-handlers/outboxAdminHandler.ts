"use strict";

import type { OutboxDiscordClient } from "../notifications/outboundChannel";
import type { RuntimeEnv } from "../../types";
import type { CommandHandler } from "../command-registry/commandHandler";
import { clampJoinedList } from "../command-presentation/discordListLimit";

const { errorDetail, errorMessage } = require("../../shared/errors");

type MaybePromise<T> = T | Promise<T>;
type GameConfig = { key: string; name: string } & Record<string, unknown>;
type DiscordInteraction = {
  commandName?: string;
  guild?: { id: string } | null;
  client?: OutboxDiscordClient;
  deferred?: boolean;
  replied?: boolean;
  options: {
    getSubcommandGroup(required: false): string | null;
    getSubcommand(): string;
  };
  isChatInputCommand?: () => boolean;
  reply: (payload: unknown) => Promise<unknown>;
  followUp?: (payload: unknown) => Promise<unknown>;
};

interface DrainResultLike {
  sent?: number;
  retried?: number;
  deadLettered?: number;
  expired?: number;
  queued?: number;
}
type NextInteractionHandler = (interaction: DiscordInteraction, games: GameConfig[]) => MaybePromise<unknown>;

interface OutboxModelLike {
  countDocuments(filter?: unknown): Promise<number>;
  updateMany(filter: unknown, update: unknown): Promise<{ modifiedCount?: number; matchedCount?: number }>;
}

interface DeadLetterEntryLike {
  kind?: string;
  itemId?: string;
  title?: string;
  channelId?: string;
  dedupeKey?: string;
  reason?: string;
  attempts?: number;
  failedAt?: Date | string;
}

interface GuildSettingsLike {
  outboxRecoveryVerify?: boolean;
  notificationDeadLetter?: DeadLetterEntryLike[];
  notificationChannelId?: string | null;
  discountChannelId?: string | null;
}

interface ChannelPermissions {
  sendMessages: boolean;
  embedLinks: boolean;
  readMessageHistory: boolean;
}

type Logger = (level: string, context: string, msg: string, meta?: unknown) => void;

interface ReplayDeadLetterDoc {
  _id: unknown;
  kind: "update" | "discount" | "youtube";
  channelId: string;
  payload: unknown;
  dedupeKey: string;
  recoveryVerify: boolean;
}

type EnqueueOutbox = (job: { guildId: string; channelId: string; kind: "update" | "discount" | "youtube"; payload: unknown; recoveryVerify?: boolean }) => Promise<void>;

type OutboxAdminDeps = {
  NotificationOutboxModel: OutboxModelLike;
  GuildModel: { updateOne(filter: unknown, update: unknown): Promise<{ modifiedCount?: number; matchedCount?: number }> };
  invalidateGuildCache: (guildId: string) => void;
  enqueueOutbox?: EnqueueOutbox;
  listReplayableDeadLetters: (guildId: string) => Promise<ReplayDeadLetterDoc[]>;
  deleteReplayedDeadLetters: (guildId: string, ids: unknown[]) => Promise<void>;
  deleteAllReplayPayloads: (guildId: string) => Promise<void>;
  getGuildSettings: (guildId: string) => Promise<GuildSettingsLike | null>;
  getOutboxPaused: () => Promise<boolean>;
  setOutboxPaused: (paused: boolean) => Promise<void>;
  checkChannelPermissions: (interaction: DiscordInteraction, channelId: string) => Promise<ChannelPermissions | null>;
  acquireDbLock: (jobName: string, ttlMs: number) => Promise<string | null>;
  releaseDbLock: (jobName: string, token: string) => Promise<unknown>;
  drainOutbox: (client: OutboxDiscordClient) => Promise<DrainResultLike | unknown>;
  safeDefer: (interaction: DiscordInteraction, ephemeral?: boolean) => Promise<void>;
  safeEdit: (interaction: DiscordInteraction, content: string) => Promise<unknown>;
  formatUserError: (err: unknown, fallback: string, code?: string) => string;
  logger: Logger;
  outboxEnabled: boolean;
  recoveryVerifyGlobal: boolean;
  recoveryStrict: boolean;
  deadLetterPreviewLimit?: number;
};

type OutboxAdminContext = Omit<OutboxAdminDeps, "outboxEnabled" | "recoveryVerifyGlobal" | "recoveryStrict"> & {
  MessageFlags: { Ephemeral: number };
  handleInteraction?: NextInteractionHandler;
  env: RuntimeEnv;
};

const DEFAULT_DEAD_LETTER_PREVIEW = 10;
const REPLAY_PER_RUN_LIMIT = 50;
const OUTBOX_DRAIN_LOCK_NAME = "outbox_drain";
const DRAIN_NOW_LOCK_TTL_MS = 120_000;

function onOff(value: boolean): string {
  return value ? "ON" : "OFF";
}

function formatDeadLetterEntry(entry: DeadLetterEntryLike): string {
  const kind = entry.kind === "discount" ? "reducere" : entry.kind === "youtube" ? "youtube" : "update";
  const title = entry.title && entry.title.trim() ? entry.title.trim() : (entry.itemId || "(necunoscut)");
  const when = entry.failedAt ? new Date(entry.failedAt).toISOString() : "necunoscut";
  const channel = entry.channelId ? `, canal: <#${entry.channelId}>` : "";
  const dedupe = entry.dedupeKey ? `, dedupe: ${String(entry.dedupeKey).slice(0, 12)}` : "";
  return `- [${kind}] ${title} - motiv: ${entry.reason || "necunoscut"}, incercari: ${entry.attempts ?? 0}${channel}${dedupe}, la: ${when}`;
}

function createOutboxAdminHandler(deps: OutboxAdminDeps) {
  const {
    NotificationOutboxModel, GuildModel, invalidateGuildCache, enqueueOutbox, listReplayableDeadLetters, deleteReplayedDeadLetters, deleteAllReplayPayloads,
    getGuildSettings, getOutboxPaused, setOutboxPaused, checkChannelPermissions,
    acquireDbLock, releaseDbLock, drainOutbox,
    safeDefer, safeEdit, formatUserError, logger,
    outboxEnabled, recoveryVerifyGlobal, recoveryStrict
  } = deps;
  const previewLimit = deps.deadLetterPreviewLimit ?? DEFAULT_DEAD_LETTER_PREVIEW;

  async function renderStatus(guildId: string): Promise<string> {
    const [guildQueued, totalQueued, settings, paused] = await Promise.all([
      NotificationOutboxModel.countDocuments({ guildId }).catch(() => 0),
      NotificationOutboxModel.countDocuments({}).catch(() => 0),
      getGuildSettings(guildId).catch(() => null),
      getOutboxPaused().catch(() => false)
    ]);
    const deadLetters = settings?.notificationDeadLetter?.length ?? 0;
    const perGuildVerify = settings?.outboxRecoveryVerify === true;
    return [
      "**Status outbox**",
      `- Outbox activat (global): **${onOff(outboxEnabled)}**`,
      `- Drenare: **${paused ? "PE PAUZA" : "ACTIVA"}**`,
      `- Joburi in coada (acest server): **${guildQueued}**`,
      `- Joburi in coada (global): **${totalQueued}**`,
      `- Dead-letter (acest server): **${deadLetters}**`,
      `- Recovery-verify acest server: **${onOff(perGuildVerify)}**`,
      `- Recovery-verify global: **${onOff(recoveryVerifyGlobal)}** | strict: **${onOff(recoveryStrict)}**`
    ].join("\n");
  }

  async function renderDeadLetters(guildId: string): Promise<string> {
    const settings = await getGuildSettings(guildId).catch(() => null);
    const list = Array.isArray(settings?.notificationDeadLetter) ? settings!.notificationDeadLetter! : [];
    if (!list.length) return "Nicio livrare in dead-letter pentru acest server.";
    const recent = list.slice(-previewLimit).reverse();
    const header = `**Dead-letter (ultimele ${recent.length} din ${list.length})**\n`;
    return `${header}${clampJoinedList(recent.map(formatDeadLetterEntry), 2000 - header.length)}`;
  }

  async function clearDeadLetters(guildId: string): Promise<string> {
    const settings = await getGuildSettings(guildId).catch(() => null);
    const count = Array.isArray(settings?.notificationDeadLetter) ? settings!.notificationDeadLetter!.length : 0;
    let replayCleanupFailed = false;
    try {
      await deleteAllReplayPayloads(guildId);
    } catch (err: unknown) {
      replayCleanupFailed = true;
      logger("WARN", "OUTBOX_COMMAND", `clear-deadletters: stergerea payload-urilor de replay a esuat pentru guild ${guildId}`, errorMessage(err));
    }
    if (count === 0) {
      invalidateGuildCache(guildId);
      return replayCleanupFailed
        ? "Auditul era gol, dar stergerea payload-urilor de replay a esuat — pot ramane payload-uri replayabile. Reincearca."
        : "Nicio livrare in dead-letter de sters pentru acest server.";
    }
    await GuildModel.updateOne({ _id: guildId }, { $set: { notificationDeadLetter: [] } });
    invalidateGuildCache(guildId);
    return replayCleanupFailed
      ? `Atentie: ${count} intrare(i) audit sterse, dar stergerea payload-urilor de replay a esuat — pot ramane payload-uri replayabile. Reincearca clear-deadletters.`
      : `OK: ${count} intrare(i) dead-letter sterse pentru acest server (inclusiv payload-urile de replay).`;
  }

  async function replayDeadLetters(guildId: string): Promise<string> {
    if (!outboxEnabled || typeof enqueueOutbox !== "function") {
      return "Replay indisponibil: outbox-ul e dezactivat (porneste-l cu `NOTIFICATION_OUTBOX_ENABLED=true`). Replay-ul reintroduce livrarile esuate in coada outbox.";
    }
    const docs = await listReplayableDeadLetters(guildId).catch(() => [] as ReplayDeadLetterDoc[]);
    if (!docs.length) {
      return "Nicio livrare dead-letter cu payload stocat pentru replay. (Doar esecurile pe calea outbox - mai putin `delivered-marksent-failed` - pot fi reluate; cele vechi/expirate au fost curatate prin TTL.)";
    }
    const replayedIds: unknown[] = [];
    const dedupeKeys: string[] = [];
    let failed = false;
    for (const doc of docs) {
      try {
        await enqueueOutbox({ guildId, channelId: doc.channelId, kind: doc.kind, payload: doc.payload, recoveryVerify: doc.recoveryVerify });
      } catch (err: unknown) {
        logger("WARN", "OUTBOX_COMMAND", `Replay dead-letter intrerupt dupa ${replayedIds.length} reusite`, errorMessage(err));
        failed = true;
        break;
      }
      replayedIds.push(doc._id);
      if (doc.dedupeKey) dedupeKeys.push(doc.dedupeKey);
    }
    let cleanupFailed = false;
    if (replayedIds.length) {
      try {
        await deleteReplayedDeadLetters(guildId, replayedIds);
        if (dedupeKeys.length) {
          await GuildModel.updateOne({ _id: guildId }, { $pull: { notificationDeadLetter: { dedupeKey: { $in: dedupeKeys } } } });
        }
      } catch (err: unknown) {
        cleanupFailed = true;
        logger("WARN", "OUTBOX_COMMAND", `replay-deadletters: curatarea dupa re-enqueue a esuat pentru guild ${guildId} (risc de duplicat la o noua rulare)`, errorMessage(err));
      }
      invalidateGuildCache(guildId);
    }
    if (failed) {
      const cleanupNote = cleanupFailed ? " (ATENTIE: curatarea a esuat — risc de duplicat la o noua rulare)" : " (curatate din dead-letter)";
      return `Replay partial: ${replayedIds.length} livrare(i) reintroduse in coada outbox${cleanupNote}; restul au esuat si raman in dead-letter — reincearca dupa ce verifici cauza.`;
    }
    if (cleanupFailed) {
      return `Atentie: ${replayedIds.length} livrare(i) reintroduse in coada outbox, dar curatarea din dead-letter a esuat — la o noua rulare s-ar putea re-trimite (duplicat). Verifica si reincearca clear-deadletters.`;
    }
    const moreHint = docs.length >= REPLAY_PER_RUN_LIMIT ? ` (s-a atins limita de ${REPLAY_PER_RUN_LIMIT} per rulare — pot exista mai multe; ruleaza din nou)` : "";
    return `OK: ${replayedIds.length} livrare(i) dead-letter reintroduse in coada outbox pentru re-trimitere${moreHint}.`;
  }

  async function retryQueued(guildId: string): Promise<string> {
    const res = await NotificationOutboxModel.updateMany(
      { guildId },
      { $set: { availableAt: new Date() }, $unset: { lockedUntil: "", lockedBy: "" } }
    );
    const count = res.modifiedCount ?? res.matchedCount ?? 0;
    return count > 0
      ? `OK: ${count} joburi din coada au fost reprogramate pentru livrare imediata.`
      : "Nu exista joburi in coada pentru acest server.";
  }

  async function renderRecoveryVerifyStatus(guildId: string): Promise<string> {
    const settings = await getGuildSettings(guildId).catch(() => null);
    const perGuildVerify = settings?.outboxRecoveryVerify === true;
    return [
      "**Recovery-verify**",
      `- Acest server: **${onOff(perGuildVerify)}** (seteaza cu \`/set outbox-recovery-verify on|off\`)`,
      `- Global: **${onOff(recoveryVerifyGlobal)}** | strict: **${onOff(recoveryStrict)}**`
    ].join("\n");
  }

  async function renderPermissions(interaction: DiscordInteraction, guildId: string): Promise<string> {
    const settings = await getGuildSettings(guildId).catch(() => null);
    const channels = [
      { label: "Update-uri", id: settings?.notificationChannelId },
      { label: "Reduceri", id: settings?.discountChannelId }
    ].filter((c): c is { label: string; id: string } => typeof c.id === "string" && c.id.length > 0);
    if (!channels.length) {
      return "Niciun canal de notificari configurat. Foloseste `/start updates` / `/start reduceri`.";
    }
    const mark = (ok: boolean) => (ok ? "OK" : "LIPSA");
    const lines: string[] = ["**Permisiuni bot pe canale (audit)**"];
    for (const channel of channels) {
      const perms = await checkChannelPermissions(interaction, channel.id).catch(() => null);
      if (!perms) {
        lines.push(`- ${channel.label} (<#${channel.id}>): necunoscut (canal inaccesibil sau sters?)`);
        continue;
      }
      lines.push(`- ${channel.label} (<#${channel.id}>): Send Messages **${mark(perms.sendMessages)}** | Embed Links **${mark(perms.embedLinks)}** | Read Message History **${mark(perms.readMessageHistory)}**`);
      if (!perms.readMessageHistory) {
        lines.push("  :warning: fara Read Message History, recovery-verify nu poate citi istoricul canalului");
      }
    }
    return lines.join("\n");
  }

  async function drainNow(interaction: DiscordInteraction): Promise<string> {
    if (!interaction.client) {
      return "Interactiunea nu are clientul Discord atasat, nu pot drena.";
    }
    if (!outboxEnabled) {
      return "Outbox-ul nu este activat (`NOTIFICATION_OUTBOX_ENABLED=false`), nu exista ce drena.";
    }
    let paused: boolean;
    try {
      paused = await getOutboxPaused();
    } catch (err: unknown) {
      logger("WARN", "OUTBOX_COMMAND", "Nu pot confirma starea de pauza inainte de drain-now", errorMessage(err));
      return "Nu pot confirma daca outbox-ul este pe pauza, deci nu pornesc drenarea manuala.";
    }
    if (paused) {
      return "Drenarea outbox-ului este pe pauza. Ruleaza `/outbox resume` inainte de `/outbox drain-now`.";
    }
    const token = await acquireDbLock(OUTBOX_DRAIN_LOCK_NAME, DRAIN_NOW_LOCK_TTL_MS);
    if (!token) {
      return "Lock-ul `outbox_drain` e detinut de o alta drenare (worker sau alta instanta). Reincearca peste putin.";
    }
    try {
      const result = (await drainOutbox(interaction.client)) as DrainResultLike;
      const r = result && typeof result === "object" ? result : {};
      return `OK: drenare imediata - trimise **${r.sent ?? 0}**, reincercate **${r.retried ?? 0}**, dead-letter **${r.deadLettered ?? 0}**, expirate **${r.expired ?? 0}**, ramase in coada **${r.queued ?? 0}**.`;
    } finally {
      await releaseDbLock(OUTBOX_DRAIN_LOCK_NAME, token).catch(() => undefined);
    }
  }

  async function handleOutboxInteraction(interaction: DiscordInteraction): Promise<unknown> {
    if (!interaction.guild) return undefined;
    const guildId = interaction.guild.id;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    await safeDefer(interaction);

    try {
      if (group === "recovery-verify" && sub === "status") {
        return safeEdit(interaction, await renderRecoveryVerifyStatus(guildId));
      }
      if (!group) {
        if (sub === "status") return safeEdit(interaction, await renderStatus(guildId));
        if (sub === "deadletters") return safeEdit(interaction, await renderDeadLetters(guildId));
        if (sub === "clear-deadletters") return safeEdit(interaction, await clearDeadLetters(guildId));
        if (sub === "replay-deadletters") return safeEdit(interaction, await replayDeadLetters(guildId));
        if (sub === "retry") return safeEdit(interaction, await retryQueued(guildId));
        if (sub === "pause") {
          await setOutboxPaused(true);
          return safeEdit(interaction, "OK: Drenarea outbox-ului a fost pusa pe pauza (global). Joburile raman in coada pana la `/outbox resume`.");
        }
        if (sub === "resume") {
          await setOutboxPaused(false);
          return safeEdit(interaction, "OK: Drenarea outbox-ului a fost reluata (global).");
        }
        if (sub === "permissions") return safeEdit(interaction, await renderPermissions(interaction, guildId));
        if (sub === "drain-now") return safeEdit(interaction, await drainNow(interaction));
      }
      logger("WARN", "OUTBOX_COMMAND", `Subcomanda /outbox necunoscuta: ${group ? `${group} ` : ""}${sub}`);
      return safeEdit(interaction, `Eroare: Subcomanda \`/outbox ${group ? `${group} ` : ""}${sub}\` nu este recunoscuta.`);
    } catch (err: unknown) {
      logger("WARN", "OUTBOX_COMMAND", `Eroare la /outbox ${sub}`, errorMessage(err));
      return safeEdit(interaction, formatUserError(err, "Eroare la procesarea comenzii /outbox."));
    }
  }

  return { handleOutboxInteraction };
}

function isDirectOutboxCommand(interaction: DiscordInteraction): boolean {
  return interaction?.isChatInputCommand?.() === true
    && Boolean(interaction.guild)
    && interaction.commandName === "outbox";
}

function buildOutboxAdminCommandHandler(target: OutboxAdminContext) {
  const handlers = createOutboxAdminHandler({
    NotificationOutboxModel: target.NotificationOutboxModel,
    GuildModel: target.GuildModel,
    invalidateGuildCache: target.invalidateGuildCache,
    enqueueOutbox: target.enqueueOutbox as EnqueueOutbox | undefined,
    listReplayableDeadLetters: target.listReplayableDeadLetters as (guildId: string) => Promise<ReplayDeadLetterDoc[]>,
    deleteReplayedDeadLetters: target.deleteReplayedDeadLetters as (guildId: string, ids: unknown[]) => Promise<void>,
    deleteAllReplayPayloads: target.deleteAllReplayPayloads as (guildId: string) => Promise<void>,
    getGuildSettings: target.getGuildSettings,
    getOutboxPaused: target.getOutboxPaused,
    setOutboxPaused: target.setOutboxPaused,
    checkChannelPermissions: target.checkChannelPermissions,
    acquireDbLock: target.acquireDbLock,
    releaseDbLock: target.releaseDbLock,
    drainOutbox: target.drainOutbox,
    safeDefer: target.safeDefer,
    safeEdit: target.safeEdit,
    formatUserError: target.formatUserError,
    logger: target.logger,
    outboxEnabled: target.env.NOTIFICATION_OUTBOX_ENABLED,
    recoveryVerifyGlobal: target.env.NOTIFICATION_OUTBOX_RECOVERY_VERIFY,
    recoveryStrict: target.env.NOTIFICATION_OUTBOX_RECOVERY_STRICT
  });

  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => Boolean(isDirectOutboxCommand(interaction as DiscordInteraction)),
    handle: async (interaction) => {
      const di = interaction;
      try {
        return await handlers.handleOutboxInteraction(di);
      } catch (err: unknown) {
        target.logger?.("ERROR", "OUTBOX_INTERACTION", "Eroare in handler-ul /outbox", errorDetail(err));
        const payload = { content: "Eroare: Eroare neasteptata la procesarea comenzii.", flags: target.MessageFlags.Ephemeral };
        try {
          if ((di.deferred || di.replied) && typeof di.followUp === "function") {
            await di.followUp(payload);
          } else {
            await di.reply(payload);
          }
        } catch {  }
        return undefined;
      }
    }
  };
  return { handlers, ...command };
}

function installOutboxAdminHandler(target: OutboxAdminContext): void {
  const previousHandleInteraction = target.handleInteraction;
  const { handlers, canHandle, handle } = buildOutboxAdminCommandHandler(target);

  async function handleInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    if (!canHandle(interaction)) {
      if (typeof previousHandleInteraction === "function") return previousHandleInteraction(interaction, games);
      return undefined;
    }
    return handle(interaction, games);
  }

  Object.assign(target, handlers, { handleInteraction });
}

export = Object.assign(installOutboxAdminHandler, { createOutboxAdminHandler, isDirectOutboxCommand, buildCommandHandler: buildOutboxAdminCommandHandler });
