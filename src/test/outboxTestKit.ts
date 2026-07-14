import { createOutboxRuntime, OutboxJob } from "../features/notifications/notificationOutbox.js";

export type OutboxRuntimeDeps = Parameters<typeof createOutboxRuntime>[0];
export type OutboxModelMock = OutboxRuntimeDeps["NotificationOutboxModel"];
export type OutboxSentModelMock = OutboxRuntimeDeps["NotificationOutboxSentModel"];

export function makeFakeModel(jobs: OutboxJob[], initialSent: string[] = [], enforceUniqueDedupe = false) {
  const created: Record<string, unknown>[] = [];
  const deleted: unknown[] = [];
  const updated: Array<{ filter: unknown; update: unknown }> = [];
  const claims: Array<{ filter: unknown; update: unknown; options: unknown }> = [];
  const finds: unknown[] = [];
  const sentKeys = new Set<string>(initialSent);
  const pending = [...jobs];
  const model: OutboxModelMock = {
    create: async (doc: Record<string, unknown>) => {
      if (enforceUniqueDedupe && doc.dedupeKey && created.some(existing => existing.dedupeKey === doc.dedupeKey)) {
        throw Object.assign(new Error("E11000 duplicate key error"), { code: 11000 });
      }
      created.push(doc);
      return doc;
    },
    findOneAndUpdate: async (filter: unknown, update: unknown, options?: unknown) => {
      claims.push({ filter, update, options });
      const job = pending.shift();
      if (!job) return null;
      const set = (update as { $set?: { lockedBy?: string; status?: string; lockedUntil?: Date } }).$set || {};
      return { ...job, lockedBy: set.lockedBy, status: set.status, lockedUntil: set.lockedUntil, leaseVersion: (job.leaseVersion ?? 0) + 1 };
    },
    find: (filter: unknown) => {
      finds.push(filter);
      return {
      sort: (_spec: unknown) => ({
        limit: (_count: number) => ({
          lean: async () => jobs.slice(0, 1)
        })
      })
    }; },
    deleteOne: async (filter: unknown) => { deleted.push(filter); return { deletedCount: 1 }; },
    updateOne: async (filter: unknown, update: unknown) => { updated.push({ filter, update }); return { matchedCount: 1, modifiedCount: 1 }; },
    countDocuments: async () => {
      const terminal = new Set(updated
        .filter(u => {
          const status = (u.update as { $set?: { status?: string } }).$set?.status;
          return typeof status === "string" && ["delivered", "dead-lettered", "dropped"].includes(status);
        })
        .map(u => (u.filter as { _id?: unknown })._id));
      return jobs.length - deleted.length - terminal.size;
    }
  };
  const sentModel: OutboxSentModelMock = {
    exists: async (filter: { dedupeKey: string }) => (sentKeys.has(filter.dedupeKey) ? { _id: filter.dedupeKey } : null),
    updateOne: async (filter: { dedupeKey: string }) => { sentKeys.add(filter.dedupeKey); return { upsertedCount: 1 }; }
  };
  const finalized = (): Array<{ id: unknown; status: string }> => updated
    .map(u => ({ u, set: (u.update as { $set?: { status?: string } }).$set }))
    .filter(x => typeof x.set?.status === "string" && ["delivered", "dead-lettered", "dropped"].includes(String(x.set.status)))
    .map(x => ({ id: (x.u.filter as { _id?: unknown })._id, status: String(x.set?.status) }));
  return { model, sentModel, created, deleted, updated, claims, finds, sentKeys, finalized };
}

export function makeRuntime(jobs: OutboxJob[], initialSent: string[] = [], enforceUniqueDedupe = false) {
  const fake = makeFakeModel(jobs, initialSent, enforceUniqueDedupe);
  const runtime = createOutboxRuntime({
    NotificationOutboxModel: fake.model,
    NotificationOutboxSentModel: fake.sentModel,
    withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
    logger: () => undefined
  });
  return { runtime, ...fake };
}

export function leaseFreeMatches(filter: { $or?: Array<{ lockedUntil: unknown }>; $and?: Array<{ $or?: Array<{ lockedUntil: unknown }> }> }, job: { lockedUntil?: Date | null }): boolean {
  if (filter && Array.isArray(filter.$and)) {
    const leaseClause = filter.$and.find(part => Array.isArray(part.$or) && part.$or.some(c => "lockedUntil" in c));
    if (leaseClause) return leaseFreeMatches(leaseClause as { $or: Array<{ lockedUntil: unknown }> }, job);
  }
  if (!filter || !Array.isArray(filter.$or)) return true;
  return filter.$or.some(clause => {
    if (clause.lockedUntil === null) return job.lockedUntil == null;
    const lte = (clause.lockedUntil as { $lte?: Date } | undefined)?.$lte;
    return lte ? Boolean(job.lockedUntil && job.lockedUntil <= lte) : false;
  });
}

export function makeSweepRuntime(job: OutboxJob & { lockedUntil?: Date | null }) {
  const deleted: unknown[] = [];
  const deadLettered: unknown[] = [];
  const model: OutboxModelMock = {
    create: async (doc: Record<string, unknown>) => doc,
    findOneAndUpdate: async () => null,
    find: (filter: { $or?: Array<{ lockedUntil: unknown }> }) => ({
      sort: () => ({ limit: () => ({ lean: async () => (leaseFreeMatches(filter, job) ? [job] : []) }) })
    }),
    deleteOne: async (filter: { _id: string; $or?: Array<{ lockedUntil: unknown }> }) => {
      const ok = filter._id === job._id && leaseFreeMatches(filter, job);
      if (ok) deleted.push(filter);
      return { deletedCount: ok ? 1 : 0 };
    },
    updateOne: async () => ({ matchedCount: 1 }),
    countDocuments: async () => 1
  };
  const sentModel: OutboxSentModelMock = { exists: async () => null, updateOne: async () => ({ upsertedCount: 1 }) };
  const runtime = createOutboxRuntime({
    NotificationOutboxModel: model,
    NotificationOutboxSentModel: sentModel,
    withMongoRetry: async <T>(fn: () => Promise<T>) => fn(),
    logger: () => undefined
  });
  return { runtime, deleted, deadLettered };
}

export function makeMetricsModel(jobs: OutboxJob[]): OutboxModelMock {
  return {
    create: async (doc: Record<string, unknown>) => doc,
    findOneAndUpdate: async () => null,
    find: (filter: { availableAt?: { $lte?: Date } }) => {
      const lte = filter?.availableAt?.$lte;
      const due = lte
        ? jobs.filter(j => j.availableAt && new Date(j.availableAt).getTime() <= lte.getTime())
        : jobs.slice();
      const sorted = due.slice().sort((a, b) => new Date(a.availableAt as Date).getTime() - new Date(b.availableAt as Date).getTime());
      return { sort: () => ({ limit: () => ({ lean: async () => sorted.slice(0, 1) }) }) };
    },
    deleteOne: async () => ({ deletedCount: 0 }),
    updateOne: async () => ({ matchedCount: 0 }),
    countDocuments: async (filter?: { availableAt?: { $gt?: Date } }) => {
      const gt = filter?.availableAt?.$gt;
      if (gt) return jobs.filter(j => j.availableAt && new Date(j.availableAt).getTime() > gt.getTime()).length;
      return jobs.length;
    }
  } as OutboxModelMock;
}
