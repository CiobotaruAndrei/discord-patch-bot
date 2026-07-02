"use strict";

const { createHash } = require("crypto");
const { errorMessage } = require("../../shared/errors") as typeof import("../../shared/errors");

export type OutboxKind = "update" | "discount" | "youtube";

export interface OutboxHistoryEntry {
  kind: OutboxKind;
  gameKey?: string;
  title?: string;
  link?: string;
  itemId?: string;
}

interface OutboxJobBase {
  _id?: unknown;
  guildId: string;
  channelId: string;
  payload: unknown;
  attempts: number;
  deliveries?: number;
  dedupeKey?: string;
  recoveryVerify?: boolean;
  manual?: boolean;
  history?: OutboxHistoryEntry[];
  createdAt?: Date;
  availableAt?: Date;
}

export interface UpdateOutboxJob extends OutboxJobBase { kind: "update" }
export interface DiscountOutboxJob extends OutboxJobBase { kind: "discount" }
export interface YouTubeOutboxJob extends OutboxJobBase { kind: "youtube" }

export type OutboxJob = UpdateOutboxJob | DiscountOutboxJob | YouTubeOutboxJob;

export interface OutboxMessagePayload {
  content?: string;
  embeds?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export function isDeliverableOutboxPayload(payload: unknown): payload is OutboxMessagePayload {
  return Boolean(payload) && typeof payload === "object" && !Array.isArray(payload);
}

interface OutboxModelLike {
  create(doc: Record<string, unknown>): Promise<unknown>;
  find(filter: unknown): { sort(spec: unknown): { limit(count: number): { lean(): Promise<OutboxJob[]> } } };
  findOneAndUpdate(filter: unknown, update: unknown, opts?: unknown): Promise<OutboxJob | null>;
  deleteOne(filter: unknown): Promise<unknown>;
  updateOne(filter: unknown, update: unknown): Promise<unknown>;
  countDocuments(filter?: unknown): Promise<number>;
}

interface OutboxSentModelLike {
  exists(filter: unknown): Promise<unknown>;
  updateOne(filter: unknown, update: unknown, opts?: unknown): Promise<unknown>;
}

type WithMongoRetry = <T>(fn: () => Promise<T>, opts?: { label?: string; retries?: number }) => Promise<T>;
type Logger = (level: string, context: string, msg: string, meta?: unknown) => void;

export interface OutboxRuntimeDeps {
  NotificationOutboxModel: OutboxModelLike;
  NotificationOutboxSentModel: OutboxSentModelLike;
  withMongoRetry: WithMongoRetry;
  logger: Logger;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
}

function dedupeKeyFor(job: { guildId: string; channelId: string; kind: OutboxKind; payload: unknown }): string {
  const source = `${job.guildId}|${job.channelId}|${job.kind}|${stableStringify(job.payload)}`;
  return createHash("sha256").update(source).digest("hex");
}

function outboxDedupeMarker(dedupeKey: string): string {
  return `id:${dedupeKey.slice(0, 16)}`;
}

function applyDedupeMarker(payload: unknown, dedupeKey: string | undefined): unknown {
  if (!dedupeKey || !payload || typeof payload !== "object") return payload;
  const record = payload as Record<string, unknown>;
  const embeds = Array.isArray(record.embeds) ? record.embeds : null;
  if (!embeds || !embeds.length) return payload;
  const marker = outboxDedupeMarker(dedupeKey);
  const last = (embeds[embeds.length - 1] && typeof embeds[embeds.length - 1] === "object")
    ? { ...embeds[embeds.length - 1] as Record<string, unknown> } : {};
  const footer = (last.footer && typeof last.footer === "object")
    ? { ...last.footer as Record<string, unknown> } : {};
  const existing = typeof footer.text === "string" ? footer.text : "";
  if (existing.includes(marker)) return payload;
  footer.text = existing ? `${existing} · ${marker}` : marker;
  last.footer = footer;
  const nextEmbeds = embeds.slice();
  nextEmbeds[nextEmbeds.length - 1] = last;
  return { ...record, embeds: nextEmbeds };
}

function messageHasDedupeMarker(message: unknown, marker: string): boolean {
  const embeds = (message && typeof message === "object" && Array.isArray((message as { embeds?: unknown[] }).embeds))
    ? (message as { embeds: Array<{ footer?: { text?: unknown } }> }).embeds : [];
  return embeds.some(embed => typeof embed?.footer?.text === "string" && embed.footer.text.includes(marker));
}

export type DeliverResult =
  | { ok: true; recoveryFetched?: boolean; recoveryDuplicate?: boolean; recoveryFailed?: boolean; recoveryMarkerMissing?: boolean }
  | { ok: false; permanent: boolean; recoveryFailed?: boolean };

export interface DrainOutboxOptions {
  deliver: (job: OutboxJob) => Promise<DeliverResult>;
  isStillSubscribed?: (job: OutboxJob) => Promise<boolean>;
  recordDeadLetter: (job: OutboxJob, reason: string) => Promise<void>;
  recordSentHistory?: (guildId: string, entries: OutboxHistoryEntry[]) => Promise<void>;
  maxAttempts: number;
  backoffMs: number;
  limit: number;
  leaseMs?: number;
  workerId?: string;
  now?: Date;
  maxAgeMs?: number;
}

export interface DrainOutboxResult {
  sent: number;
  deadLettered: number;
  retried: number;
  expired: number;
  total: number;
  queued: number;
  deliveryMsTotal: number;
  oldestJobAgeMs: number;
  futureScheduledCount: number;
  recoveryDuplicates: number;
  recoveryFetches: number;
  recoveryFailures: number;
  recoveryMarkerMissing: number;
  markSentFailures: number;
  deleteFailures: number;
  deadLetterFailures: number;
  historyWriteFailures: number;
  droppedUnsubscribed: number;
}

export interface OutboxRuntime {
  enqueueOutbox(job: { guildId: string; channelId: string; kind: OutboxKind; payload: unknown; recoveryVerify?: boolean; manual?: boolean; history?: OutboxHistoryEntry[]; availableAt?: Date }): Promise<void>;
  drainOutbox(options: DrainOutboxOptions): Promise<DrainOutboxResult>;
}

const DEFAULT_LEASE_MS = 60_000;
const MAX_BACKOFF_MS = 30 * 60 * 1000;

function backoffWithJitter(baseMs: number, attempts: number): number {
  const capped = Math.min(baseMs * attempts, MAX_BACKOFF_MS);
  return Math.round(capped * (0.5 + Math.random()));
}

export function createOutboxRuntime({ NotificationOutboxModel, NotificationOutboxSentModel, withMongoRetry, logger }: OutboxRuntimeDeps): OutboxRuntime {
  async function enqueueOutbox(job: { guildId: string; channelId: string; kind: OutboxKind; payload: unknown; recoveryVerify?: boolean; manual?: boolean; history?: OutboxHistoryEntry[]; availableAt?: Date }): Promise<void> {
    const dedupeKey = dedupeKeyFor(job);
    const alreadySent = await NotificationOutboxSentModel.exists({ dedupeKey }).catch(() => null);
    if (alreadySent) return;
    const at = new Date();
    try {
      await withMongoRetry(() => NotificationOutboxModel.create({
        guildId: job.guildId,
        channelId: job.channelId,
        kind: job.kind,
        payload: job.payload,
        attempts: 0,
        dedupeKey,
        recoveryVerify: job.recoveryVerify,
        manual: job.manual === true,
        history: job.history || [],
        createdAt: at,
        availableAt: job.availableAt && job.availableAt.getTime() > at.getTime() ? job.availableAt : at
      }), { label: "enqueueOutbox" });
    } catch (err) {
      if ((err as { code?: number } | null)?.code === 11000) return;
      throw err;
    }
  }

  async function markSent(dedupeKey: string | undefined): Promise<boolean> {
    if (!dedupeKey) return true;
    try {
      await withMongoRetry(
        () => NotificationOutboxSentModel.updateOne(
          { dedupeKey },
          { $setOnInsert: { dedupeKey, sentAt: new Date() } },
          { upsert: true }
        ),
        { label: "outboxMarkSent" }
      );
      return true;
    } catch {
      return false;
    }
  }

  function claimNextJob(now: Date, leaseMs: number, workerId: string): Promise<OutboxJob | null> {
    return NotificationOutboxModel.findOneAndUpdate(
      {
        availableAt: { $lte: now },
        $or: [{ lockedUntil: { $exists: false } }, { lockedUntil: null }, { lockedUntil: { $lte: now } }]
      },
      { $set: { lockedUntil: new Date(now.getTime() + leaseMs), lockedBy: workerId }, $inc: { deliveries: 1 } },
      { sort: { availableAt: 1 }, new: true }
    );
  }

  async function oldestJobAgeMs(now: Date): Promise<number> {
    const rows = await NotificationOutboxModel.find({ availableAt: { $lte: now } }).sort({ availableAt: 1 }).limit(1).lean().catch(() => [] as OutboxJob[]);
    const oldest = Array.isArray(rows) ? rows[0] : undefined;
    const stamp = oldest?.availableAt ?? oldest?.createdAt;
    if (!stamp) return 0;
    return Math.max(0, now.getTime() - new Date(stamp).getTime());
  }

  async function futureScheduledCount(now: Date): Promise<number> {
    return NotificationOutboxModel.countDocuments({ availableAt: { $gt: now } }).catch(() => 0);
  }

  async function drainOutbox(options: DrainOutboxOptions): Promise<DrainOutboxResult> {
    const nowFn = (): Date => options.now || new Date();
    const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    const workerId = options.workerId ?? "outbox-worker";

    let sent = 0;
    let deadLettered = 0;
    let retried = 0;
    let processed = 0;
    let deliveryMsTotal = 0;
    let recoveryDuplicates = 0;
    let recoveryFetches = 0;
    let recoveryFailures = 0;
    let recoveryMarkerMissing = 0;
    let markSentFailures = 0;
    let deliverErrors = 0;
    let expired = 0;
    let deleteFailures = 0;
    let deadLetterFailures = 0;
    let historyWriteFailures = 0;
    let droppedUnsubscribed = 0;
    const maxAgeMs = options.maxAgeMs ?? 0;

    const deleteJob = async (id: unknown): Promise<boolean> => {
      try {
        await NotificationOutboxModel.deleteOne({ _id: id });
        return true;
      } catch (err) {
        deleteFailures++;
        logger("WARN", "OUTBOX",
          `Stergerea jobului ${String(id)} a esuat dupa procesare (ramane in coada, va fi dedus/reluat la urmatorul ciclu)`,
          err instanceof Error ? err.message : String(err));
        return false;
      }
    };

    const recordDeadLetterOrKeep = async (job: OutboxJob, reason: string): Promise<boolean> => {
      const recorded = await options.recordDeadLetter(job, reason).then(() => true).catch(() => false);
      if (!recorded) {
        deadLetterFailures++;
        logger("WARN", "OUTBOX",
          `Audit-ul dead-letter (${reason}) pentru jobul ${String(job._id)} a esuat; NU sterg jobul (ramane in coada, reluat la urmatorul ciclu) ca sa nu pierd payload-ul de replay`);
      }
      return recorded;
    };

    const recordDeadLetterBeforeDelete = async (job: OutboxJob, reason: string): Promise<void> => {
      const recorded = await options.recordDeadLetter(job, reason).then(() => true).catch(() => false);
      if (!recorded) {
        deadLetterFailures++;
        logger("WARN", "OUTBOX",
          `Audit-ul dead-letter (${reason}) pentru jobul ${String(job._id)} a esuat; jobul a fost totusi sters fiindca mesajul era deja livrat (risc de dedupe degradat fara audit) - verifica disponibilitatea Mongo`);
      }
    };

    const retryOrDeadLetter = async (job: OutboxJob, reason: string, permanent: boolean): Promise<void> => {
      const attempts = (job.attempts || 0) + 1;
      if (permanent || attempts >= options.maxAttempts) {
        if (!(await recordDeadLetterOrKeep(job, permanent ? reason : "max-attempts"))) return;
        await deleteJob(job._id);
        deadLettered++;
        return;
      }
      await NotificationOutboxModel.updateOne(
        { _id: job._id },
        {
          $set: { attempts, availableAt: new Date(nowFn().getTime() + backoffWithJitter(options.backoffMs, attempts)) },
          $unset: { lockedUntil: "", lockedBy: "" }
        }
      );
      retried++;
    };

    const validateClaimedJob = async (job: OutboxJob): Promise<
      | { step: "deliver" }
      | { step: "drop-duplicate" }
      | { step: "expire" }
      | { step: "drop-unsubscribed" }
      | { step: "retry"; reason: string }
      | { step: "dead-letter"; reason: string }
    > => {
      if (job.dedupeKey && await NotificationOutboxSentModel.exists({ dedupeKey: job.dedupeKey }).catch(() => null)) {
        return { step: "drop-duplicate" };
      }
      if (maxAgeMs > 0 && job.createdAt && new Date(job.createdAt).getTime() <= nowFn().getTime() - maxAgeMs) {
        return { step: "expire" };
      }
      if (options.isStillSubscribed) {
        let stillSubscribed: boolean;
        try {
          stillSubscribed = await options.isStillSubscribed(job);
        } catch (err) {
          logger("WARN", "OUTBOX",
            `Verificarea abonarii pentru jobul ${String(job._id)} a esuat; aman livrarea ca sa nu trimit intr-un canal dezabonat`,
            err instanceof Error ? err.message : String(err));
          return { step: "retry", reason: "subscription-check-failed" };
        }
        if (!stillSubscribed) return { step: "drop-unsubscribed" };
      }
      if (!isDeliverableOutboxPayload(job.payload)) {
        logger("WARN", "OUTBOX",
          `Payload-ul jobului ${String(job._id)} nu e livrabil (fara content/embeds valide); il mut in dead-letter ca sa nu ocupe coada`);
        return { step: "dead-letter", reason: "invalid-payload" };
      }
      return { step: "deliver" };
    };

    const deliverClaimedJob = async (job: OutboxJob): Promise<DeliverResult> => {
      const startedAt = Date.now();
      let result: DeliverResult;
      try {
        result = await options.deliver(job);
      } catch (err) {
        logger("WARN", "OUTBOX",
          `Livrarea jobului ${String(job._id)} a aruncat o exceptie (tratata ca esec tranzitoriu)`,
          err instanceof Error ? err.message : String(err));
        deliverErrors++;
        result = { ok: false, permanent: false };
      }
      deliveryMsTotal += Math.max(0, Date.now() - startedAt);
      return result;
    };

    const finalizeDeliveredJob = async (
      job: OutboxJob,
      result: Extract<DeliverResult, { ok: true }>
    ): Promise<{ stopDrain: boolean }> => {
      if (result.recoveryFetched) recoveryFetches++;
      if (result.recoveryDuplicate) recoveryDuplicates++;
      if (result.recoveryFailed) recoveryFailures++;
      if (result.recoveryMarkerMissing) recoveryMarkerMissing++;
      if (options.recordSentHistory && Array.isArray(job.history) && job.history.length) {
        await options.recordSentHistory(job.guildId, job.history).catch((err: unknown) => {
          historyWriteFailures++;
          logger("WARN", "OUTBOX", `Scrierea istoricului /history a esuat pentru un job livrat (guild ${job.guildId}); livrarea a reusit, dar /history poate fi incomplet`, errorMessage(err));
        });
      }
      const markSentFailed = job.dedupeKey ? !(await markSent(job.dedupeKey)) : false;
      if (markSentFailed) {
        markSentFailures++;
        await recordDeadLetterBeforeDelete(job, "delivered-marksent-failed");
      }
      await deleteJob(job._id);
      sent++;
      return { stopDrain: markSentFailed };
    };

    for (let i = 0; i < options.limit; i++) {
      const job = await claimNextJob(nowFn(), leaseMs, workerId);
      if (!job) break;
      processed++;

      const verdict = await validateClaimedJob(job);
      if (verdict.step === "drop-duplicate") {
        await deleteJob(job._id);
        continue;
      }
      if (verdict.step === "expire") {
        if (!(await recordDeadLetterOrKeep(job, "expired-near-ttl"))) continue;
        await deleteJob(job._id);
        expired++;
        continue;
      }
      if (verdict.step === "drop-unsubscribed") {
        await deleteJob(job._id);
        droppedUnsubscribed++;
        continue;
      }
      if (verdict.step === "retry") {
        await retryOrDeadLetter(job, verdict.reason, false);
        continue;
      }
      if (verdict.step === "dead-letter") {
        await retryOrDeadLetter(job, verdict.reason, true);
        continue;
      }

      const result = await deliverClaimedJob(job);
      if (result.ok) {
        const { stopDrain } = await finalizeDeliveredJob(job, result);
        if (stopDrain) break;
        continue;
      }
      if (result.recoveryFailed) recoveryFailures++;
      await retryOrDeadLetter(job, "permanent", result.permanent);
    }

    if (maxAgeMs > 0) {
      const sweepNow = nowFn();
      const cutoff = new Date(sweepNow.getTime() - maxAgeMs);
      const leaseFree = { $or: [{ lockedUntil: null }, { lockedUntil: { $lte: sweepNow } }] };
      const staleJobs = await NotificationOutboxModel.find({ createdAt: { $lte: cutoff }, ...leaseFree }).sort({ createdAt: 1 }).limit(options.limit).lean().catch(() => [] as OutboxJob[]);
      for (const job of (Array.isArray(staleJobs) ? staleJobs : [])) {
        if (!(await recordDeadLetterOrKeep(job, "expired-near-ttl"))) continue;
        let del: unknown;
        try {
          del = await NotificationOutboxModel.deleteOne({ _id: job._id, ...leaseFree });
        } catch (err) {
          deleteFailures++;
          logger("WARN", "OUTBOX",
            `Stergerea (sweep TTL) jobului ${String(job._id)} a esuat (ramane in coada pana se reia; audit-ul dead-letter e deja scris)`,
            err instanceof Error ? err.message : String(err));
          continue;
        }
        if (((del as { deletedCount?: number })?.deletedCount ?? 0) > 0) expired++;
      }
    }
    if (expired > 0) {
      logger("WARN", "OUTBOX", `Drain outbox: ${expired} job(uri) prea vechi mutate in dead-letter inainte de expirarea TTL (nelivrate dupa ${Math.round(maxAgeMs / 3600000)}h)`);
    }

    const queued = await NotificationOutboxModel.countDocuments({}).catch(() => 0);
    const oldestAgeMs = await oldestJobAgeMs(nowFn());
    const futureScheduled = await futureScheduledCount(nowFn());

    if (sent || deadLettered || retried) {
      const errSuffix = deliverErrors > 0 ? `, ${deliverErrors} exceptii de livrare` : "";
      logger("INFO", "OUTBOX", `Drain outbox: ${sent} trimise, ${retried} reincercate, ${deadLettered} dead-letter, ${queued} ramase in coada${errSuffix}`);
    }
    if (deleteFailures > 0) {
      logger("WARN", "OUTBOX", `Drain outbox: ${deleteFailures} stergere(i) de job esuate (job-urile raman in coada si vor fi deduse/reluate)`);
    }
    if (deadLetterFailures > 0) {
      logger("WARN", "OUTBOX", `Drain outbox: ${deadLetterFailures} audit(uri) dead-letter esuate (job-urile terminale raman in coada pentru reluare; un job deja livrat e sters chiar fara audit - vezi log-urile WARN per job; verifica disponibilitatea Mongo)`);
    }
    return { sent, deadLettered, retried, expired, total: processed, queued, deliveryMsTotal, oldestJobAgeMs: oldestAgeMs, futureScheduledCount: futureScheduled, recoveryDuplicates, recoveryFetches, recoveryFailures, recoveryMarkerMissing, markSentFailures, deleteFailures, deadLetterFailures, historyWriteFailures, droppedUnsubscribed };
  }

  return { enqueueOutbox, drainOutbox };
}

export { applyDedupeMarker, messageHasDedupeMarker, outboxDedupeMarker };
