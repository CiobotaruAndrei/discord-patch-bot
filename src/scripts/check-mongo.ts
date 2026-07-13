import { pathToFileURL as __pathToFileURL } from "node:url";
"use strict";

import mongoose from "mongoose";

export interface MongoConnectionProbe {
  connect(uri: string, timeoutMs: number): Promise<void>;
  ping(): Promise<void>;
  databaseName(): string;
  disconnect(): Promise<void>;
}

const mongooseProbe: MongoConnectionProbe = {
  connect: async (uri, timeoutMs) => {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: timeoutMs });
  },
  ping: async () => {
    const database = mongoose.connection.db;
    if (!database) throw new Error("Conexiunea MongoDB nu are o baza de date activa");
    await database.admin().ping();
  },
  databaseName: () => mongoose.connection.name,
  disconnect: async () => {
    await mongoose.disconnect();
  }
};

export async function runMongoConnectivityCheck(
  uri: string,
  probe: MongoConnectionProbe = mongooseProbe,
  timeoutMs = 3000
): Promise<string> {
  if (!uri.trim()) throw new Error("MONGO_URI lipseste");
  try {
    await probe.connect(uri, timeoutMs);
    await probe.ping();
    return probe.databaseName();
  } finally {
    await probe.disconnect();
  }
}

async function main(): Promise<void> {
  const databaseName = await runMongoConnectivityCheck(process.env.MONGO_URI || "");
  console.log(`MongoDB OK: ping reusit pentru baza ${databaseName}`);
}

if (process.argv[1] !== undefined && __pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(error => {
    console.error(`MongoDB: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}

export {};
