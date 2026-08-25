import type { PermissionRequestModelLike } from "../../features/command-security/permissionRequestRepository.js";

type Doc = Record<string, unknown>;

function matches(record: Doc, filter: Doc): boolean {
  for (const [key, expected] of Object.entries(filter)) {
    const actual = record[key];
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      const clause = expected as Doc;
      if ("$in" in clause && !(clause.$in as unknown[]).includes(actual)) return false;
      if ("$gt" in clause && !(actual instanceof Date && actual.getTime() > (clause.$gt as Date).getTime())) return false;
      if ("$lte" in clause && !(actual instanceof Date && actual.getTime() <= (clause.$lte as Date).getTime())) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

export interface PermissionRequestStore extends PermissionRequestModelLike {
  records: Doc[];
}

export function permissionRequestStore(records: Doc[] = []): PermissionRequestStore {
  return {
    records,
    findOne(filter: Doc) {
      const found = records.find(record => matches(record, filter)) ?? null;
      return { lean: async (): Promise<Doc | null> => (found ? { ...found } : null) };
    },
    find(filter: Doc) {
      const found = records.filter(record => matches(record, filter));
      return { sort: () => ({ limit: () => ({ lean: async (): Promise<Doc[]> => found.map(record => ({ ...record })) }) }) };
    },
    async updateOne(filter: Doc, update: Doc, options?: Doc) {
      const existing = records.find(record => matches(record, filter));
      if (!existing) {
        if (options?.upsert && update.$setOnInsert) {
          records.push(update.$setOnInsert as Doc);
          return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
        }
        return { matchedCount: 0, modifiedCount: 0 };
      }
      if (update.$set) Object.assign(existing, update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async updateMany(filter: Doc, update: Doc) {
      const affected = records.filter(entry => matches(entry, filter));
      for (const record of affected) {
        if (update.$set) Object.assign(record, update.$set);
        for (const field of Object.keys((update.$unset ?? {}) as Record<string, unknown>)) delete record[field];
      }
      return { matchedCount: affected.length, modifiedCount: affected.length };
    }
  };
}
