import test from "node:test";
import assert from "node:assert/strict";
import { createReportRepository } from "../../features/feedback/reportRepository.js";

function memoryModel() {
  const docs: Array<Record<string, unknown>> = [];
  return {
    docs,
    create: async (doc: Record<string, unknown>) => {
      const saved = { ...doc, _id: `id-${docs.length + 1}` };
      docs.push(saved);
      return saved;
    },
    findOne: (filter: Record<string, unknown>) => ({
      lean: async () => docs.find(doc => Object.entries(filter).every(([key, value]) => doc[key] === value)) ?? null
    }),
    find: (filter: Record<string, unknown>) => ({
      sort: () => ({
        limit: () => ({ lean: async () => docs.filter(doc => Object.entries(filter).every(([key, value]) => doc[key] === value)) })
      })
    }),
    deleteOne: async (filter: Record<string, unknown>) => {
      const index = docs.findIndex(doc => Object.entries(filter).every(([key, value]) => doc[key] === value));
      if (index < 0) return { deletedCount: 0 };
      docs.splice(index, 1);
      return { deletedCount: 1 };
    }
  };
}

test("repository-ul deduplica bugurile si izoleaza colectiile la listare si stergere", async () => {
  const bugs = memoryModel();
  const complaints = memoryModel();
  const repository = createReportRepository({
    BugReportModel: bugs,
    UserComplaintModel: complaints,
    withMongoRetry: async fn => fn()
  });
  const first = await repository.saveBug({ guildId: "g1", reportType: "source", gameKey: "cs2", description: "Nu merge", authorId: "u1" });
  const duplicate = await repository.saveBug({ guildId: "g1", reportType: "SOURCE", gameKey: "CS2", description: "nu   merge", authorId: "u2" });
  await repository.saveComplaint({ guildId: "g1", reporterId: "u1", targetId: "u3", reason: "spam" });
  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal((await repository.listBugs("g1")).length, 1);
  assert.equal((await repository.listComplaints("g1")).length, 1);
  assert.equal(await repository.removeBug("g1", first.record.id), true);
  assert.equal((await repository.listComplaints("g1")).length, 1);
});
