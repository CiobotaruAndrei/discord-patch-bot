import type { OperationJournalDoc, OperationJournalModelLike } from "../infra/mongo/operationJournal.js";

function clone(doc: OperationJournalDoc | null): OperationJournalDoc | null {
  return doc ? { ...doc } : null;
}

export function createOperationJournalTestModel(): OperationJournalModelLike {
  const rows = new Map<string, OperationJournalDoc>();
  return {
    findOne(filter) {
      return { lean: async () => {
        if (filter._id !== undefined) return clone(rows.get(String(filter._id)) ?? null);
        const resourceKey = filter.resourceKey;
        const version = filter.resourceVersion as { $gt?: string } | undefined;
        return clone(Array.from(rows.values()).find(row => row.resourceKey === resourceKey && typeof version?.$gt === "string" && row.resourceVersion > version.$gt) ?? null);
      } };
    },
    findOneAndUpdate(filter, update) {
      return {
        lean: async () => {
          const key = String(filter._id);
          const current = rows.get(key);
          if (!current || current.status === "done") return null;
          const set = update.$set && typeof update.$set === "object" ? Object.fromEntries(Object.entries(update.$set)) : {};
          const increment = update.$inc && typeof update.$inc === "object" ? Object.fromEntries(Object.entries(update.$inc)) : {};
          const next: OperationJournalDoc = {
            ...current,
            ...set,
            attempts: current.attempts + Number(increment.attempts ?? 0),
            leaseVersion: current.leaseVersion + Number(increment.leaseVersion ?? 0)
          };
          rows.set(key, next);
          return clone(next);
        }
      };
    },
    async updateOne(filter, update, options) {
      const key = String(filter._id);
      const current = rows.get(key);
      const insert = update.$setOnInsert && typeof update.$setOnInsert === "object" ? Object.fromEntries(Object.entries(update.$setOnInsert)) : null;
      if (!current && options?.upsert === true && insert) {
        rows.set(key, { _id: key, ...insert } as OperationJournalDoc);
        return { matchedCount: 0, modifiedCount: 0 };
      }
      if (!current) return { matchedCount: 0, modifiedCount: 0 };
      if (filter.status && filter.status !== current.status) return { matchedCount: 0, modifiedCount: 0 };
      if (filter.lockedBy && filter.lockedBy !== current.lockedBy) return { matchedCount: 0, modifiedCount: 0 };
      if (filter.leaseVersion && filter.leaseVersion !== current.leaseVersion) return { matchedCount: 0, modifiedCount: 0 };
      const set = update.$set && typeof update.$set === "object" ? Object.fromEntries(Object.entries(update.$set)) : {};
      rows.set(key, { ...current, ...set });
      return { matchedCount: 1, modifiedCount: 1 };
    },
    find() {
      return { sort: () => ({ limit: () => ({ lean: async () => [] }) }) };
    }
  };
}
