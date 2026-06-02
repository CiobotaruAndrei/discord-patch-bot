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
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}

export {};
