import type { ProtectedResourceModelLike } from "../../features/command-security/protectedResourceRepository.js";

type Doc = Record<string, unknown>;

export interface ProtectedResourceStore extends ProtectedResourceModelLike {
  records: Doc[];
}

function matches(record: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, expected]) => record[key] === expected);
}

export function protectedResourceStore(records: Doc[] = []): ProtectedResourceStore {
  return {
    records,
    findOne(filter: Doc) {
      const found = records.find(record => matches(record, filter)) ?? null;
      return { lean: async (): Promise<Doc | null> => (found ? { ...found } : null) };
    },
    find(filter: Doc) {
      const found = records.filter(record => matches(record, filter));
      return { sort: () => ({ limit: (count: number) => ({ lean: async (): Promise<Doc[]> => found.slice(0, count).map(record => ({ ...record })) }) }) };
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
    async deleteOne(filter: Doc) {
      const index = records.findIndex(record => matches(record, filter));
      if (index < 0) return { deletedCount: 0 };
      records.splice(index, 1);
      return { deletedCount: 1 };
    }
  };
}
