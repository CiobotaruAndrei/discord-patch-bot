import type { OperationJournalDoc } from "../../shared/operationJournalEngine.js";

export type JournalFilter = Record<string, unknown>;
export type JournalUpdate = Record<string, unknown>;

type Filter = JournalFilter;
type Update = JournalUpdate;

export function valueMatches(value: unknown, condition: unknown): boolean {
  if (!condition || typeof condition !== "object" || Array.isArray(condition)) return value === condition;
  const operators = condition as Record<string, unknown>;
  if ("$ne" in operators && value === operators.$ne) return false;
  if ("$lte" in operators) {
    if (!(value instanceof Date) || !(operators.$lte instanceof Date) || value > operators.$lte) return false;
  }
  if ("$lt" in operators && !(typeof value === "number" && typeof operators.$lt === "number" && value < operators.$lt)) return false;
  if ("$gt" in operators && !(typeof value === "string" && typeof operators.$gt === "string" && value > operators.$gt)) return false;
  if ("$in" in operators && !(Array.isArray(operators.$in) && operators.$in.includes(value))) return false;
  return true;
}

function matches(doc: OperationJournalDoc, filter: Filter): boolean {
  for (const [key, condition] of Object.entries(filter)) {
    if (key === "$or") {
      const alternatives = Array.isArray(condition) ? condition as Filter[] : [];
      if (!alternatives.some(alternative => matches(doc, alternative))) return false;
      continue;
    }
    if (!valueMatches(doc[key as keyof OperationJournalDoc], condition)) return false;
  }
  return true;
}

function applyUpdate(doc: OperationJournalDoc, update: Update, inserted: boolean): OperationJournalDoc {
  const set = (update.$set ?? {}) as Partial<OperationJournalDoc>;
  const setOnInsert = inserted ? (update.$setOnInsert ?? {}) as Partial<OperationJournalDoc> : {};
  const inc = (update.$inc ?? {}) as { attempts?: number; leaseVersion?: number };
  return {
    ...doc,
    ...setOnInsert,
    ...set,
    attempts: (doc.attempts ?? 0) + (inc.attempts ?? 0),
    leaseVersion: (doc.leaseVersion ?? 0) + (inc.leaseVersion ?? 0)
  };
}

function baseDoc(id: string): OperationJournalDoc {
  return {
    _id: id,
    kind: "",
    payload: null,
    schemaVersion: 1,
    resourceKey: id,
    resourceVersion: "00000000000000000001",
    status: "pending",
    attempts: 0,
    leaseVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

export function fakeJournalModel(seed: OperationJournalDoc[] = []) {
  const docs = new Map<string, OperationJournalDoc>(seed.map(doc => [doc._id, { ...doc }]));
  const writes: Array<{ filter: Filter; update: Update }> = [];
  return {
    writes,
    docs,
    findOne: (filter: Filter) => ({
      lean: async () => Array.from(docs.values()).find(doc => matches(doc, filter)) ?? null
    }),
    findOneAndUpdate: (filter: Filter, update: Update) => ({
      lean: async () => {
        const existing = Array.from(docs.values()).find(doc => matches(doc, filter));
        if (!existing) return null;
        const updated = applyUpdate(existing, update, false);
        docs.set(updated._id, updated);
        writes.push({ filter, update });
        return { ...updated };
      }
    }),
    updateOne: async (filter: Filter, update: Update, options?: Filter) => {
      writes.push({ filter, update });
      const existing = Array.from(docs.values()).find(doc => matches(doc, filter));
      if (!existing && options?.upsert === true && typeof filter._id === "string") {
        const inserted = applyUpdate(baseDoc(filter._id), update, true);
        docs.set(inserted._id, inserted);
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }
      if (!existing) return { matchedCount: 0, modifiedCount: 0 };
      const updated = applyUpdate(existing, update, false);
      docs.set(updated._id, updated);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    find: (filter: Filter) => ({
      sort: () => ({
        limit: (count: number) => ({
          lean: async () => Array.from(docs.values()).filter(doc => matches(doc, filter)).slice(0, count)
        })
      })
    })
  };
}

export function journalDoc(input: Partial<OperationJournalDoc> & Pick<OperationJournalDoc, "_id" | "kind">): OperationJournalDoc {
  return {
    ...baseDoc(input._id),
    ...input
  };
}
