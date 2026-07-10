"use strict";

export interface DeclaredIndex {
  model: string;
  collection: string;
  key: Record<string, number | string>;
  fields: string[];
  unknownFields: string[];
  unique: boolean;
  sparse: boolean;
  ttlSeconds?: number;
}

export interface DbIndexReport {
  indexes: DeclaredIndex[];
  duplicates: string[];
  unknownFieldIndexes: string[];
  undocumented: string[];
  pass: boolean;
}

interface IndexSchema {
  indexes(): Array<[Record<string, number | string>, Record<string, unknown> | undefined]>;
  pathType(path: string): string;
}

interface IndexModel {
  collection: { collectionName: string };
  schema: IndexSchema;
  syncIndexes(): Promise<unknown>;
}

interface MongooseLike {
  modelNames(): string[];
  model(name: string): IndexModel;
}

export function collectDeclaredIndexes(mongoose: MongooseLike, attachMongoModels: { buildFrom: (target: Record<string, unknown>) => Record<string, unknown> }): DeclaredIndex[] {
  try {
    attachMongoModels.buildFrom({ mongoose, SUPPORTED_CURRENCIES: { USD: {} }, DEFAULT_CURRENCY: "USD", ONE_DAY_MS: 86_400_000, env: { GUILD_SEEN_DISCOUNT_TTL_DAYS: 60, GUILD_AUDIT_LOG_TTL_DAYS: 180, NOTIFICATION_OUTBOX_SENT_TTL_HOURS: 24, NOTIFICATION_HISTORY_TTL_DAYS: 30, FEEDBACK_REPORT_TTL_DAYS: 90, NOTIFICATION_DEAD_LETTER_REPLAY_TTL_DAYS: 7 } });
  } catch {
    void 0;
  }
  const out: DeclaredIndex[] = [];
  for (const name of mongoose.modelNames()) {
    const model = mongoose.model(name);
    const collection = model.collection.collectionName;
    for (const [key, options] of model.schema.indexes()) {
      const opts = options || {};
      const fields = Object.keys(key);
      const unknownFields = fields.filter(field => model.schema.pathType(field) === "adhocOrUndefined");
      out.push({
        model: name,
        collection,
        key,
        fields,
        unknownFields,
        unique: opts.unique === true,
        sparse: opts.sparse === true,
        ttlSeconds: typeof opts.expireAfterSeconds === "number" ? opts.expireAfterSeconds : undefined
      });
    }
  }
  return out;
}

export function analyzeIndexes(indexes: DeclaredIndex[], operationsText: string): DbIndexReport {
  const signatureCount = new Map<string, number>();
  for (const idx of indexes) {
    const signature = `${idx.collection}::${JSON.stringify(idx.key)}`;
    signatureCount.set(signature, (signatureCount.get(signature) || 0) + 1);
  }
  const duplicates = Array.from(signatureCount.entries()).filter(([, count]) => count > 1).map(([signature]) => signature);

  const unknownFieldIndexes = indexes
    .filter(idx => idx.unknownFields.length > 0)
    .map(idx => `${idx.collection} ${JSON.stringify(idx.key)} -> camp inexistent in schema: ${idx.unknownFields.join(", ")}`);

  const undocumented: string[] = [];
  const collections = Array.from(new Set(indexes.map(idx => idx.collection)));
  for (const collection of collections) {
    if (!operationsText.includes(collection)) undocumented.push(`colectia "${collection}"`);
  }
  for (const idx of indexes) {
    if (idx.ttlSeconds === undefined) continue;
    for (const field of idx.fields) {
      if (!operationsText.includes(field)) undocumented.push(`TTL ${idx.collection}.${field}`);
    }
  }
  const undocumentedUnique = Array.from(new Set(undocumented));

  const pass = duplicates.length === 0 && unknownFieldIndexes.length === 0 && undocumentedUnique.length === 0;
  return { indexes, duplicates, unknownFieldIndexes, undocumented: undocumentedUnique, pass };
}

async function main(): Promise<void> {
  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");
  const mongoose = require("mongoose") as MongooseLike & {
    connect(uri: string, opts: Record<string, unknown>): Promise<unknown>;
    disconnect(): Promise<unknown>;
  };
  const attachMongoModels = require("../infra/mongo/models") as { buildFrom: (target: Record<string, unknown>) => Record<string, unknown> };

  const srcRoot = process.cwd();
  const repoRoot = path.resolve(srcRoot, "..");
  const operationsText = fs.readFileSync(path.join(repoRoot, "OPERATIONS.md"), "utf8");

  const indexes = collectDeclaredIndexes(mongoose, attachMongoModels);
  const report = analyzeIndexes(indexes, operationsText);

  console.log(`Index-uri MongoDB declarate (in afara de _id): ${indexes.length}`);
  for (const idx of indexes) {
    const tags = [
      idx.unique ? "unique" : "",
      idx.sparse ? "sparse" : "",
      idx.ttlSeconds !== undefined ? `TTL=${idx.ttlSeconds}s` : ""
    ].filter(Boolean).join(", ");
    console.log(`- ${idx.collection} ${JSON.stringify(idx.key)}${tags ? `  [${tags}]` : ""}`);
  }

  let liveError = "";
  const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/discord-patch-bot-indexcheck";
  let connected = false;
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 1500 });
    connected = true;
  } catch {
    console.log("[INDEXCHECK] MongoDB indisponibil; sar peste verificarea live syncIndexes (verificarea statica ramane valida).");
  }
  if (connected) {
    try {
      for (const name of mongoose.modelNames()) {
        await mongoose.model(name).syncIndexes();
      }
      console.log(`[INDEXCHECK] live OK: syncIndexes a reusit pe ${mongoose.modelNames().length} colectii (toate index-urile sunt construibile).`);
    } catch (err) {
      liveError = (err as Error).message;
      console.error(`::error::[check-db-indexes] syncIndexes a esuat (index conflictual/invalid): ${liveError}`);
    }
    await mongoose.disconnect().catch(() => undefined);
  }

  for (const duplicate of report.duplicates) {
    console.error(`::error::[check-db-indexes] index duplicat declarat: ${duplicate}`);
  }
  for (const unknown of report.unknownFieldIndexes) {
    console.error(`::error::[check-db-indexes] ${unknown}`);
  }
  for (const undoc of report.undocumented) {
    console.error(`::error::[check-db-indexes] index/colectie nedocumentat(a) in OPERATIONS.md: ${undoc}`);
  }

  if (!report.pass || liveError) {
    console.error("check-db-indexes: index-urile declarate au probleme (vezi mai sus).");
    process.exit(1);
  }
  console.log("check-db-indexes OK: index-uri valide, fara duplicate, toate documentate in OPERATIONS.md.");
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}

export {};
