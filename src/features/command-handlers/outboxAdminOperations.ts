"use strict";

import type { OutboxDiscordClient } from "../notifications/outboundChannel";
import { clearDeadLetters as clearDeadLetterEntries, countDeadLetters, deleteDeadLettersByDedupeKeys, type DeadLetterModelLike } from "../notifications/deadLetterRepository";
import { isDeliverableOutboxPayload } from "../notifications/outboxTypes";
import type {
  DrainResultLike,
  EnqueueOutbox,
  GuildSettingsLike,
  OutboxAdminInteraction,
  OutboxAdminLogger,
  OutboxModelLike,
  ReplayDeadLetterDoc
} from "./outboxAdminContracts";

import { errorMessage } from "../../shared/errors";

export const REPLAY_PER_RUN_LIMIT = 50;
export const OUTBOX_DRAIN_LOCK_NAME = "outbox_drain";
export const DRAIN_NOW_LOCK_TTL_MS = 120_000;

export interface OutboxAdminOperationsDeps {
  NotificationOutboxModel: Pick<OutboxModelLike, "updateMany">;
  GuildDeadLetterModel: Pick<DeadLetterModelLike, "countDocuments" | "deleteMany">;
  enqueueOutbox?: EnqueueOutbox;
  listReplayableDeadLetters: (guildId: string) => Promise<ReplayDeadLetterDoc[]>;
  deleteReplayedDeadLetters: (guildId: string, ids: unknown[]) => Promise<void>;
  deleteAllReplayPayloads: (guildId: string) => Promise<void>;
  getGuildSettings: (guildId: string) => Promise<GuildSettingsLike | null>;
  getOutboxPaused: () => Promise<boolean>;
  acquireDbLock: (jobName: string, ttlMs: number) => Promise<string | null>;
  releaseDbLock: (jobName: string, token: string) => Promise<unknown>;
  drainOutbox: (client: OutboxDiscordClient) => Promise<DrainResultLike | unknown>;
  logger: OutboxAdminLogger;
  outboxEnabled: boolean;
  outboxGlobalAdminIds: string[];
}

export function createOutboxAdminOperations(deps: OutboxAdminOperationsDeps) {
  const {
    NotificationOutboxModel, GuildDeadLetterModel, enqueueOutbox,
    listReplayableDeadLetters, deleteReplayedDeadLetters, deleteAllReplayPayloads,
    getGuildSettings, getOutboxPaused, acquireDbLock, releaseDbLock, drainOutbox,
    logger, outboxEnabled, outboxGlobalAdminIds
  } = deps;

  async function clearDeadLetters(guildId: string): Promise<string> {
    const count = await countDeadLetters(GuildDeadLetterModel, guildId).catch(() => 0);
    let replayCleanupFailed = false;
    try {
      await deleteAllReplayPayloads(guildId);
    } catch (err: unknown) {
      replayCleanupFailed = true;
      logger("WARN", "OUTBOX_COMMAND", `clear-deadletters: stergerea payload-urilor de replay a esuat pentru guild ${guildId}`, errorMessage(err));
    }
    if (count === 0) {
      return replayCleanupFailed
        ? "Auditul era gol, dar stergerea payload-urilor de replay a esuat — pot ramane payload-uri replayabile. Reincearca."
        : "Nicio livrare in dead-letter de sters pentru acest server.";
    }
    await clearDeadLetterEntries(GuildDeadLetterModel, guildId);
    return replayCleanupFailed
      ? `Atentie: ${count} intrare(i) audit sterse, dar stergerea payload-urilor de replay a esuat — pot ramane payload-uri replayabile. Reincearca clear-deadletters.`
      : `OK: ${count} intrare(i) dead-letter sterse pentru acest server (inclusiv payload-urile de replay).`;
  }

  async function replayDeadLetters(guildId: string): Promise<string> {
    if (!outboxEnabled || typeof enqueueOutbox !== "function") {
      return "Replay indisponibil: outbox-ul e dezactivat (porneste-l cu `NOTIFICATION_OUTBOX_ENABLED=true`). Replay-ul reintroduce livrarile esuate in coada outbox.";
    }
    const allDocs = await listReplayableDeadLetters(guildId).catch(() => [] as ReplayDeadLetterDoc[]);
    const docs = allDocs.filter(doc => {
      if (isDeliverableOutboxPayload(doc.payload)) return true;
      logger("WARN", "OUTBOX_COMMAND", `replay-deadletters: payload nelivrabil pentru intrarea ${String(doc._id)} (guild ${guildId}); o sar la replay ca sa nu reintre in bucla invalid-payload`);
      return false;
    });
    if (!docs.length) {
      return "Nicio livrare dead-letter cu payload stocat pentru replay. (Doar esecurile pe calea outbox - mai putin `delivered-marksent-failed` - pot fi reluate; cele vechi/expirate au fost curatate prin TTL.)";
    }
    const replayedIds: unknown[] = [];
    const dedupeKeys: string[] = [];
    let failed = false;
    for (const doc of docs) {
      try {
        if (!isDeliverableOutboxPayload(doc.payload)) continue;
        await enqueueOutbox({ guildId, channelId: doc.channelId, kind: doc.kind, payload: doc.payload, recoveryVerify: doc.recoveryVerify, history: doc.history });
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
        await deleteDeadLettersByDedupeKeys(GuildDeadLetterModel, guildId, dedupeKeys);
      } catch (err: unknown) {
        cleanupFailed = true;
        logger("WARN", "OUTBOX_COMMAND", `replay-deadletters: curatarea dupa re-enqueue a esuat pentru guild ${guildId} (re-rularea NU re-trimite — dedupe pe dedupeKey; raman intrari dead-letter de curatat)`, errorMessage(err));
      }
    }
    if (failed) {
      const cleanupNote = cleanupFailed ? " (curatarea dead-letter a esuat, dar o re-rulare NU re-trimite — dedupe pe outbox; ruleaza clear-deadletters ca sa cureti intrarile ramase)" : " (curatate din dead-letter)";
      return `Replay partial: ${replayedIds.length} livrare(i) reintroduse in coada outbox${cleanupNote}; restul au esuat si raman in dead-letter — reincearca dupa ce verifici cauza.`;
    }
    if (cleanupFailed) {
      return `Atentie: ${replayedIds.length} livrare(i) reintroduse in coada outbox, dar curatarea din dead-letter a esuat. O re-rulare NU le re-trimite (dedupe pe dedupeKey: index unique pe outbox + colectia Sent); ruleaza \`/outbox clear-deadletters\` ca sa cureti intrarile dead-letter ramase.`;
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

  function globalOperationRefusal(interaction: OutboxAdminInteraction, operation: string): string | null {
    if (outboxGlobalAdminIds.length === 0) {
      return `Operatie globala indisponibila: \`/outbox ${operation}\` afecteaza drenarea pentru TOATE serverele, deci e rezervata operatorilor botului. Seteaza \`NOTIFICATION_OUTBOX_GLOBAL_ADMIN_IDS\` cu ID-urile lor ca sa o activezi.`;
    }
    const userId = interaction.user?.id;
    if (!userId || !outboxGlobalAdminIds.includes(userId)) {
      return `Eroare: \`/outbox ${operation}\` e o operatie globala (afecteaza toate serverele) si e permisa doar operatorilor botului din \`NOTIFICATION_OUTBOX_GLOBAL_ADMIN_IDS\`.`;
    }
    return null;
  }

  async function drainNow(interaction: OutboxAdminInteraction): Promise<string> {
    const refusal = globalOperationRefusal(interaction, "drain-now");
    if (refusal) return refusal;
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

  return { clearDeadLetters, replayDeadLetters, retryQueued, globalOperationRefusal, drainNow };
}
