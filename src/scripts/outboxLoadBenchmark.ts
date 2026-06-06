"use strict";

import { createOutboxRuntime, DeliverResult } from "../features/notifications/notificationOutbox";

const mongoose = require("mongoose");
const attachMongoModels = require("../infra/mongo/models");

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/discord-patch-bot-bench";

export interface OutboxLoadModels {
  outboxModel: {
    insertMany(docs: Record<string, unknown>[]): Promise<unknown>;
    findOneAndUpdate(filter: unknown, update: unknown, opts?: unknown): Promise<unknown>;
    find(filter: unknown): unknown;
    deleteOne(filter: unknown): Promise<unknown>;
    deleteMany(filter: unknown): Promise<unknown>;
    updateOne(filter: unknown, update: unknown): Promise<unknown>;
    countDocuments(filter?: unknown): Promise<number>;
  };
  sentModel: {
    exists(filter: unknown): Promise<unknown>;
    updateOne(filter: unknown, update: unknown, opts?: unknown): Promise<unknown>;
    deleteMany(filter: unknown): Promise<unknown>;
  };
}

export interface OutboxLoadResult {
  jobs: number;
  totalMs: number;
  msPerJob: number;
  jobsPerSec: number;
  delivered: number;
}

export interface OutboxPhaseBreakdown {
  jobs: number;
  claimMsPerJob: number;
  dedupeMsPerJob: number;
  markSentMsPerJob: number;
  deleteMsPerJob: number;
  mongoMsPerJob: number;
}

export async function runOutboxPhaseBreakdown(models: OutboxLoadModels, jobs: number, marker: string): Promise<OutboxPhaseBreakdown> {
  const past = new Date(Date.now() - 1000);
  const docs: Record<string, unknown>[] = [];
  for (let i = 0; i < jobs; i++) {
    docs.push({ guildId: marker, channelId: "c1", kind: "update", payload: { i }, attempts: 0, dedupeKey: `${marker}-${i}`, createdAt: past, availableAt: past });
  }
  await models.outboxModel.insertMany(docs);
  const elapsedMs = (from: bigint) => Number(process.hrtime.bigint() - from) / 1e6;

  const claimed: Array<{ _id: unknown; dedupeKey: string }> = [];
  let phaseStart = process.hrtime.bigint();
  for (let i = 0; i < jobs; i++) {
    const now = new Date();
    const job = await models.outboxModel.findOneAndUpdate(
      { guildId: marker, availableAt: { $lte: now }, $or: [{ lockedUntil: { $exists: false } }, { lockedUntil: null }, { lockedUntil: { $lte: now } }] },
      { $set: { lockedUntil: new Date(Date.now() + 60_000), lockedBy: marker }, $inc: { deliveries: 1 } },
      { sort: { availableAt: 1 }, new: true }
    ) as { _id: unknown; dedupeKey: string } | null;
    if (job) claimed.push({ _id: job._id, dedupeKey: job.dedupeKey });
  }
  const claimMs = elapsedMs(phaseStart);

  phaseStart = process.hrtime.bigint();
  for (const job of claimed) await models.sentModel.exists({ dedupeKey: job.dedupeKey });
  const dedupeMs = elapsedMs(phaseStart);

  phaseStart = process.hrtime.bigint();
  for (const job of claimed) {
    await models.sentModel.updateOne({ dedupeKey: job.dedupeKey }, { $setOnInsert: { dedupeKey: job.dedupeKey, sentAt: new Date() } }, { upsert: true });
  }
  const markSentMs = elapsedMs(phaseStart);

  phaseStart = process.hrtime.bigint();
  for (const job of claimed) await models.outboxModel.deleteOne({ _id: job._id });
  const deleteMs = elapsedMs(phaseStart);

  const n = jobs > 0 ? jobs : 1;
  return {
    jobs,
    claimMsPerJob: claimMs / n,
    dedupeMsPerJob: dedupeMs / n,
    markSentMsPerJob: markSentMs / n,
    deleteMsPerJob: deleteMs / n,
    mongoMsPerJob: (claimMs + dedupeMs + markSentMs + deleteMs) / n
  };
}

export async function runOutboxLoad(models: OutboxLoadModels, jobs: number, marker: string): Promise<OutboxLoadResult> {
  const past = new Date(Date.now() - 1000);
  const docs: Record<string, unknown>[] = [];
  for (let i = 0; i < jobs; i++) {
    docs.push({ guildId: marker, channelId: "c1", kind: "update", payload: { i }, attempts: 0, dedupeKey: `${marker}-${i}`, createdAt: past, availableAt: past });
  }
  await models.outboxModel.insertMany(docs);
  const runtime = createOutboxRuntime({
    NotificationOutboxModel: models.outboxModel as never,
    NotificationOutboxSentModel: models.sentModel as never,
    withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
    logger: () => undefined
  });
  let delivered = 0;
  const start = process.hrtime.bigint();
  await runtime.drainOutbox({
    deliver: async (): Promise<DeliverResult> => { delivered++; return { ok: true }; },
    recordDeadLetter: async () => undefined,
    maxAttempts: 5, backoffMs: 1000, limit: jobs
  });
  const totalMs = Number(process.hrtime.bigint() - start) / 1e6;
  return { jobs, totalMs, msPerJob: totalMs / jobs, jobsPerSec: jobs / (totalMs / 1000), delivered };
}

async function main(): Promise<void> {
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 2000 });
  } catch {
    console.log("MongoDB indisponibil; seteaza MONGO_URI catre un Mongo pornit pentru load test.");
    return;
  }
  const target: Record<string, unknown> = { mongoose, SUPPORTED_CURRENCIES: { USD: {} }, DEFAULT_CURRENCY: "USD", ONE_DAY_MS: 86_400_000 };
  try { attachMongoModels(target); } catch {  }
  const models: OutboxLoadModels = {
    outboxModel: (target.NotificationOutboxModel ?? mongoose.model("NotificationOutbox")) as never,
    sentModel: (target.NotificationOutboxSentModel ?? mongoose.model("NotificationOutboxSent")) as never
  };
  const sizes = (process.env.OUTBOX_BENCH_SIZES || "1000,5000,10000").split(",").map(s => Number(s.trim())).filter(n => n > 0);
  const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
  console.log("Outbox load benchmark (drain job-by-job pe Mongo real):");
  for (const jobs of sizes) {
    const marker = `bench-${Date.now()}-${jobs}`;
    try {
      const r = await runOutboxLoad(models, jobs, marker);
      console.log(`- ${fmt(jobs)} joburi: ${r.totalMs.toFixed(0)}ms total, ${r.msPerJob.toFixed(2)}ms/job, ${fmt(r.jobsPerSec)} joburi/s, livrate ${r.delivered}`);
    } finally {
      await models.outboxModel.deleteMany({ guildId: marker }).catch(() => undefined);
      await models.sentModel.deleteMany({ dedupeKey: { $regex: `^${marker}-` } }).catch(() => undefined);
    }
  }
  const breakdownJobs = Number(process.env.OUTBOX_BENCH_BREAKDOWN || 2000) || 2000;
  const breakdownMarker = `bench-phase-${Date.now()}`;
  try {
    const b = await runOutboxPhaseBreakdown(models, breakdownJobs, breakdownMarker);
    const typicalSendMs = Number(process.env.OUTBOX_BENCH_SEND_MS || 100) || 100;
    const mongoFraction = (b.mongoMsPerJob / (b.mongoMsPerJob + typicalSendMs)) * 100;
    console.log(`\nDescompunere pe faze (${fmt(breakdownJobs)} joburi, Mongo real, deliver mock):`);
    console.log(`- claim (findOneAndUpdate): ${b.claimMsPerJob.toFixed(3)}ms/job`);
    console.log(`- dedupe-check (exists):    ${b.dedupeMsPerJob.toFixed(3)}ms/job`);
    console.log(`- markSent (updateOne):     ${b.markSentMsPerJob.toFixed(3)}ms/job`);
    console.log(`- delete (deleteOne):       ${b.deleteMsPerJob.toFixed(3)}ms/job`);
    console.log(`- TOTAL Mongo:              ${b.mongoMsPerJob.toFixed(3)}ms/job`);
    console.log(`- vs trimitere Discord tipica ~${typicalSendMs}ms/job -> Mongo = ${mongoFraction.toFixed(1)}% din timpul real per job`);
  } finally {
    await models.outboxModel.deleteMany({ guildId: breakdownMarker }).catch(() => undefined);
    await models.sentModel.deleteMany({ dedupeKey: { $regex: `^${breakdownMarker}-` } }).catch(() => undefined);
  }
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}

export {};
