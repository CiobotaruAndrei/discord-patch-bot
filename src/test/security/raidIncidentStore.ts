import type { RaidIncidentModelLike } from "../../features/command-security/antiRaidIncidentRepository.js";

type Doc = Record<string, unknown>;

export interface RaidIncidentStore extends RaidIncidentModelLike {
  records: Doc[];
}

function pathValue(record: Doc, path: string): unknown {
  if (!path.includes(".")) return record[path];
  const [head, ...rest] = path.split(".");
  const branch = record[head];
  if (!Array.isArray(branch)) return undefined;
  const tail = rest.join(".");
  if (/^\d+$/.test(tail)) return branch[Number(tail)];
  return branch.map(entry => (entry as Doc)[tail]);
}

function elemMatches(actual: unknown, clause: Doc): boolean {
  if (!Array.isArray(actual)) return false;
  return actual.some(item => matches(item as Doc, clause));
}

function clauseMatches(actual: unknown, clause: Doc): boolean {
  if ("$elemMatch" in clause) return elemMatches(actual, clause.$elemMatch as Doc);
  if ("$ne" in clause) {
    const expected = clause.$ne;
    if (Array.isArray(actual)) return !actual.includes(expected);
    return actual !== expected;
  }
  if ("$exists" in clause) return (actual !== undefined) === clause.$exists;
  return false;
}

function matches(record: Doc, filter: Doc): boolean {
  for (const [key, expected] of Object.entries(filter)) {
    const actual = pathValue(record, key);
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      if (!clauseMatches(actual, expected as Doc)) return false;
      continue;
    }
    if (Array.isArray(actual)) {
      if (!actual.includes(expected)) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

function positionalIndex(record: Doc, filter: Doc): number {
  for (const [key, expected] of Object.entries(filter)) {
    const branch = record[key];
    if (!Array.isArray(branch)) continue;
    const clause = expected as Doc | undefined;
    if (!clause || typeof clause !== "object" || !("$elemMatch" in clause)) continue;
    return branch.findIndex(item => matches(item as Doc, clause.$elemMatch as Doc));
  }
  return -1;
}

function applySet(record: Doc, set: Doc): void {
  for (const [key, value] of Object.entries(set)) {
    if (!key.includes(".$.")) {
      record[key] = value;
      continue;
    }
    const [head, , field] = key.split(".");
    const branch = record[head];
    if (!Array.isArray(branch)) continue;
    const index = Number(record.__positional ?? -1);
    if (index >= 0 && branch[index]) (branch[index] as Doc)[field] = value;
  }
}

function applyPush(record: Doc, push: Doc): void {
  for (const [key, value] of Object.entries(push)) {
    if (key.includes(".$.")) {
      const [head, , field] = key.split(".");
      const branch = record[head];
      const index = Number(record.__positional ?? -1);
      if (Array.isArray(branch) && index >= 0 && branch[index]) {
        const target = (branch[index] as Doc)[field];
        if (Array.isArray(target)) target.push(value);
      }
      continue;
    }
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

export function raidIncidentStore(records: Doc[] = []): RaidIncidentStore {
  function sortedCopy(found: Doc[]): Doc[] {
    return [...found].sort((left, right) => {
      const leftStart = left.startedAt instanceof Date ? left.startedAt.getTime() : 0;
      const rightStart = right.startedAt instanceof Date ? right.startedAt.getTime() : 0;
      return rightStart - leftStart;
    });
  }

  return {
    records,
    findOne(filter: Doc) {
      const found = sortedCopy(records.filter(record => matches(record, filter)));
      const lean = async (): Promise<Doc | null> => (found[0] ? structuredClone(found[0]) : null);
      return { sort: () => ({ lean }), lean };
    },
    find(filter: Doc) {
      const found = sortedCopy(records.filter(record => matches(record, filter)));
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
      existing.__positional = positionalIndex(existing, filter);
      if (update.$push) applyPush(existing, update.$push as Doc);
      if (update.$set) applySet(existing, update.$set as Doc);
      if (update.$pull) {
        for (const [key, value] of Object.entries(update.$pull as Doc)) {
          const list = existing[key];
          if (Array.isArray(list)) existing[key] = list.filter(item => !matches(item as Doc, value as Doc));
        }
      }
      delete existing.__positional;
      return { matchedCount: 1, modifiedCount: 1 };
    }
  };
}
