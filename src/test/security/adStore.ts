import type { AdRequestModelLike } from "../../features/command-security/adProtectionRepository.js";

type Doc = Record<string, unknown>;

export interface AdStore extends AdRequestModelLike {
  records: Doc[];
}

function clauseMatches(actual: unknown, clause: Doc): boolean {
  if ("$in" in clause) return (clause.$in as unknown[]).includes(actual);
  if ("$gt" in clause) return actual instanceof Date && actual.getTime() > (clause.$gt as Date).getTime();
  if ("$lte" in clause) return actual instanceof Date && actual.getTime() <= (clause.$lte as Date).getTime();
  if ("$lt" in clause) return typeof actual === "number" && actual < (clause.$lt as number);
  return false;
}

function matches(record: Doc, filter: Doc): boolean {
  for (const [key, expected] of Object.entries(filter)) {
    const actual = record[key];
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      if (!clauseMatches(actual, expected as Doc)) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

function applyPush(record: Doc, push: Doc): void {
  for (const [key, value] of Object.entries(push)) {
    const list = record[key];
    if (!Array.isArray(list)) continue;
    if (value && typeof value === "object" && "$each" in (value as Doc)) {
      list.push(...((value as Doc).$each as unknown[]));
      const slice = (value as Doc).$slice;
      if (typeof slice === "number" && slice < 0) record[key] = list.slice(slice);
      continue;
    }
    list.push(value);
  }
}

export function adStore(records: Doc[] = []): AdStore {
  return {
    records,
    findOne(filter: Doc) {
      const found = records.find(record => matches(record, filter)) ?? null;
      return { lean: async (): Promise<Doc | null> => (found ? structuredClone(found) : null) };
    },
    find(filter: Doc) {
      const found = records.filter(record => matches(record, filter));
      return {
        sort: () => ({
          limit: (count: number) => ({ lean: async (): Promise<Doc[]> => found.slice(0, count).map(record => structuredClone(record)) })
        })
      };
    },
    async updateOne(filter: Doc, update: Doc, options?: Doc) {
      const existing = records.find(record => matches(record, filter));
      if (!existing) {
        if (options?.upsert && update.$setOnInsert) {
          records.push(structuredClone(update.$setOnInsert as Doc));
          return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
        }
        return { matchedCount: 0, modifiedCount: 0 };
      }
      if (update.$inc) {
        for (const [key, delta] of Object.entries(update.$inc as Doc)) {
          const current = typeof existing[key] === "number" ? (existing[key] as number) : 0;
          existing[key] = current + (delta as number);
        }
      }
      if (update.$push) applyPush(existing, update.$push as Doc);
      if (update.$set) Object.assign(existing, update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async updateMany(filter: Doc, update: Doc) {
      for (const record of records.filter(entry => matches(entry, filter))) Object.assign(record, update.$set);
      return undefined;
    }
  };
}
